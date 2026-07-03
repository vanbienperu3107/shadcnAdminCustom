import { sql } from 'drizzle-orm'
import { db } from './client.js'

/**
 * Migration idempotent chạy lúc boot (CREATE TABLE IF NOT EXISTS).
 * Đơn giản & an toàn cho Neon — không cần drizzle-kit trong runtime image.
 */
export async function migrate(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS derp_servers (
      region_id   INTEGER PRIMARY KEY,
      code        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      node_name   TEXT NOT NULL UNIQUE,
      hostname    TEXT NOT NULL,
      ipv4        TEXT,
      ipv6        TEXT,
      derp_port   INTEGER NOT NULL DEFAULT 443,
      stun_port   INTEGER NOT NULL DEFAULT 3478,
      can_port80  BOOLEAN NOT NULL DEFAULT false,
      stun_only   BOOLEAN NOT NULL DEFAULT false,
      latitude    REAL,
      longitude   REAL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      paused      BOOLEAN NOT NULL DEFAULT false,
      embedded    BOOLEAN NOT NULL DEFAULT false,
      priority    INTEGER NOT NULL DEFAULT 100,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      google_sub  TEXT NOT NULL UNIQUE,
      email       TEXT NOT NULL,
      name        TEXT,
      picture     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token  TEXT,
      refresh_token TEXT,
      id_token      TEXT,
      token_expiry  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at    TIMESTAMPTZ NOT NULL
    )
  `)

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`
  )

  // Bảng đơn dòng lưu Headscale API key (auto-refresh 24h).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS headscale_api_keys (
      id          INTEGER PRIMARY KEY,
      api_key     TEXT NOT NULL,
      prefix      TEXT,
      seeded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      refreshed_at TIMESTAMPTZ
    )
  `)

  // Latency từ metrics-report.ps1 — UPSERT theo (src_hostname, dst_hostname), không tích lũy.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS latency_samples (
      src_hostname  TEXT NOT NULL,
      dst_hostname  TEXT NOT NULL,
      src_ip        TEXT,
      mac           TEXT,
      rtt_ms        REAL,
      path          TEXT,
      ok            BOOLEAN NOT NULL DEFAULT true,
      reported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (src_hostname, dst_hostname)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_latency_src ON latency_samples(src_hostname)
  `)

  // loss_pct — sync với api-center (cùng DB hoặc DB riêng đều an toàn)
  await db.execute(sql`
    ALTER TABLE latency_samples ADD COLUMN IF NOT EXISTS loss_pct INTEGER
  `)

  // Feature A: cột maintenance cho DERP nodes
  await db.execute(sql`
    ALTER TABLE derp_servers ADD COLUMN IF NOT EXISTS maintenance BOOLEAN NOT NULL DEFAULT false
  `)

  // Feature C: SSH credentials cho DERP nodes + bảng force routes
  await db.execute(sql`
    ALTER TABLE derp_servers ADD COLUMN IF NOT EXISTS ssh_user TEXT DEFAULT 'root'
  `)
  await db.execute(sql`
    ALTER TABLE derp_servers ADD COLUMN IF NOT EXISTS ssh_port INTEGER DEFAULT 22
  `)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS derp_force_routes (
      id          SERIAL PRIMARY KEY,
      region_id   INTEGER NOT NULL REFERENCES derp_servers(region_id) ON DELETE CASCADE,
      client_ip   TEXT NOT NULL,
      label       TEXT,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_force_routes_region ON derp_force_routes(region_id)
  `)

  // Feature B: per-node DERP region assignments
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS derp_node_assignments (
      node_key   TEXT NOT NULL,
      region_id  INTEGER NOT NULL REFERENCES derp_servers(region_id) ON DELETE CASCADE,
      PRIMARY KEY (node_key, region_id)
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_node_assignments_node ON derp_node_assignments(node_key)
  `)

  // Co "khoa cung 1 DERP" theo node — tach bang rieng (thuoc tinh cua ca node,
  // khong phai tung dong gan). exclusive=true -> DERPMap CHI gom region duoc
  // gan (loai han, khong phai chi phat priority).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS derp_node_options (
      node_key  TEXT PRIMARY KEY,
      exclusive BOOLEAN NOT NULL DEFAULT false
    )
  `)

  // Trang thai suc khoe region dang khoa cung cho 1 node — cap nhat boi tien
  // trinh nen (khong probe trong request GET /api/internal/derp-map).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS derp_node_health (
      node_key        TEXT PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'ok',
      last_healthy_at TIMESTAMPTZ,
      down_since      TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Danh tinh thiet bi theo MAC — "ten chuan" on dinh qua nhieu lan cai lai
  // (khac nodeKey, doi moi lan cai lai). Xem POST /api/internal/device-register.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS device_identity (
      mac        TEXT PRIMARY KEY,
      hostname   TEXT NOT NULL,
      node_key   TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Client config — shared with api-center (cùng DB hoặc tạo lại nếu DB riêng)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_config (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      note        TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Seed default config keys (idempotent — DO NOTHING nếu đã có)
  await db.execute(sql`
    INSERT INTO client_config (key, value, note) VALUES
      ('lan_routes',        '10.0.0.0/8,192.168.0.0/16', 'Dải IP LAN itop advertise qua tailscale'),
      ('itop_lan_prefix',   '10.',                        'Prefix nhận diện itop node (kiểm tra IP local)'),
      ('pac_extra_subnets', '',                           'Subnet bổ sung vào PAC, phân cách dấu phẩy'),
      ('pac_extra_domains', '',                           'Domain bổ sung vào PAC, phân cách dấu phẩy'),
      ('gost_fallback',     'false',                      'Bật gost HTTP proxy khi không có proxy_rank HTTP'),
      ('metrics_interval',  '60',                         'Chu kỳ gửi metrics (giây)'),
      ('proxy_rank',        'socks5:7654',                'Thứ tự proxy trong PAC, vd: socks5:7654,http:18888'),
      ('gost_listen_port',  '18888',                      'Port gost HTTP proxy lắng nghe'),
      ('gost_itop_port',    '18889',                      'Port gost upstream cho itop'),
      ('gost_itop_addr',    '',                           'IP itop upstream cho gost'),
      ('squid_proxy_addr',  '',                           'IP Squid HTTP proxy (bỏ trống = tắt)'),
      ('squid_proxy_port',  '3128',                       'Port Squid HTTP proxy'),
      ('ping_count',        '2',                          'Số lần ping mỗi peer khi đo latency'),
      ('ping_timeout',      '3s',                         'Timeout mỗi lần ping (vd: 3s, 5s)')
    ON CONFLICT (key) DO NOTHING
  `)

  // Client netcheck — active_ports reported by client-agent at startup
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_netcheck (
      client      TEXT PRIMARY KEY,
      port_socks5 INTEGER,
      port_http   INTEGER,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    ALTER TABLE client_netcheck ADD COLUMN IF NOT EXISTS mode TEXT
  `)
  await db.execute(sql`
    ALTER TABLE client_netcheck ADD COLUMN IF NOT EXISTS advertised_routes TEXT
  `)

  // Cấu hình runtime per-node (load từ dashboard lúc client boot). Key = MAC.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS node_runtime_config (
      mac                 TEXT PRIMARY KEY,
      hostname            TEXT,
      mode                TEXT,
      login_server        TEXT,
      always_use_derp     BOOLEAN,
      derp_keepalive_secs INTEGER,
      peer_http_proxy     TEXT,
      socks_addr          TEXT,
      advertise_routes    TEXT,
      lan_routes          TEXT,
      pac_server_port     INTEGER,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_node_runtime_hostname ON node_runtime_config(hostname)
  `)

  // "Bấm Reload" cho 1 client — node launcher poll thấy requested_at moi hon
  // lan ap dung gan nhat thi tu ap lai cau hinh, khong can restart node.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS node_reload_requests (
      mac          TEXT PRIMARY KEY,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Luật PAC động — render thành file PAC qua /api/client/pac.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pac_rules (
      id           SERIAL PRIMARY KEY,
      scope        TEXT NOT NULL DEFAULT 'global',
      mac          TEXT,
      kind         TEXT NOT NULL,
      pattern      TEXT NOT NULL,
      proxy_target TEXT NOT NULL,
      priority     INTEGER NOT NULL DEFAULT 100,
      enabled      BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_pac_rules_scope_mac ON pac_rules(scope, mac)`
  )

  // Seed pac_rules từ PAC tĩnh hiện tại (chỉ khi bảng rỗng) — bitel/viettel + dải LAN.
  await db.execute(sql`
    INSERT INTO pac_rules (scope, kind, pattern, proxy_target, priority)
    SELECT * FROM (VALUES
      ('global', 'domain', 'bitel.com.pe',   'PROXY 127.0.0.1:8888', 100),
      ('global', 'domain', 'viettel.com.vn', 'PROXY 127.0.0.1:8888', 100),
      ('global', 'subnet', '10.0.0.0/8',     'PROXY 127.0.0.1:8888', 200),
      ('global', 'subnet', '172.16.0.0/12',  'PROXY 127.0.0.1:8888', 200),
      ('global', 'subnet', '192.168.0.0/16', 'PROXY 127.0.0.1:8888', 200)
    ) AS v(scope, kind, pattern, proxy_target, priority)
    WHERE NOT EXISTS (SELECT 1 FROM pac_rules)
  `)

  // Split-DNS: domain nội bộ -> nameserver nội bộ. headscale (Feature D) gọi
  // GET /api/internal/dns-split, merge vào tailcfg.DNSConfig.Routes cho mọi
  // node — sửa domain/nameserver ở đây, không cần sửa config.yaml + restart.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dns_split_rules (
      id           SERIAL PRIMARY KEY,
      domain       TEXT NOT NULL UNIQUE,
      nameservers  TEXT NOT NULL,
      note         TEXT,
      enabled      BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}
