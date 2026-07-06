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

  // Đăng nhập nội bộ username/password + 2FA TOTP (song song Google OAuth).
  // google_sub phải nullable vì user nội bộ không có; giữ UNIQUE cho phép nhiều NULL.
  await db.execute(sql`ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL`)
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`)
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`)
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`)
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false`
  )
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_counter INTEGER`
  )
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
      END IF;
    END $$;
  `)

  // Session chờ bước 2FA (đã qua mật khẩu, chưa qua TOTP).
  await db.execute(
    sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pending_2fa BOOLEAN NOT NULL DEFAULT false`
  )
  await db.execute(
    sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_attempts INTEGER NOT NULL DEFAULT 0`
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

  // nodeKey cua may Tailscale sidecar tren host DERP nay — dong bo vao
  // device_identity (device_type='derp_infra'), xem routes/derp.ts + devices.ts.
  await db.execute(sql`
    ALTER TABLE derp_servers ADD COLUMN IF NOT EXISTS ts_node_key TEXT
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

  // Nang cap device_identity thanh "device registry" hop nhat (client + derp
  // infra, phan biet boi device_type) — mac khong the tiep tuc la PK vi
  // derp_infra khong co MAC. Doi PK sang id serial, mac/node_key thanh UNIQUE
  // rieng (cho phep null). Boc trong kiem tra idempotent vi PK chi doi 1 lan.
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS id SERIAL
  `)
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS managed_user TEXT
  `)
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'client'
  `)
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS device_token TEXT
  `)
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS last_ipv4 TEXT
  `)
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS static_ipv4 TEXT
  `)
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'device_identity_id_pkey'
      ) THEN
        ALTER TABLE device_identity DROP CONSTRAINT device_identity_pkey;
        ALTER TABLE device_identity ALTER COLUMN mac DROP NOT NULL;
        ALTER TABLE device_identity ADD CONSTRAINT device_identity_mac_unique UNIQUE (mac);
        ALTER TABLE device_identity ADD CONSTRAINT device_identity_id_pkey PRIMARY KEY (id);
        ALTER TABLE device_identity ADD CONSTRAINT device_identity_node_key_unique UNIQUE (node_key);
      END IF;
    END $$;
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
  // Home DERP hien tai cua tung client — client mod tu bao cao moi 3s.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_home_derp (
      mac                    TEXT PRIMARY KEY,
      hostname               TEXT NOT NULL,
      home_region_id         INTEGER,
      home_region_code       TEXT,
      controller_latency_ms  REAL,
      reported_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Ping tu 1 client toi tung DERP region — client mod tu bao cao moi 30s.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_derp_ping (
      client       TEXT NOT NULL,
      region_id    INTEGER NOT NULL,
      region_code  TEXT,
      rtt_ms       REAL,
      ok           BOOLEAN NOT NULL DEFAULT true,
      reported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (client, region_id)
    )
  `)

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

  // Auto-update client: 1 dòng cấu hình toàn cục (id=1). enabled=false = tắt
  // hẳn (kill-switch). pinned_build != null = đóng băng fleet ở build đó thay
  // vì luôn theo release mới nhất.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_update (
      id           INTEGER PRIMARY KEY DEFAULT 1,
      enabled      BOOLEAN NOT NULL DEFAULT false,
      pinned_build INTEGER,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT client_update_singleton CHECK (id = 1)
    )
  `)
  await db.execute(sql`
    INSERT INTO client_update (id, enabled) VALUES (1, false)
    ON CONFLICT (id) DO NOTHING
  `)

  // Version client tự báo về (device-register) để tab Thiết bị hiển thị + so
  // sánh với release mới nhất.
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS client_version TEXT
  `)
  await db.execute(sql`
    ALTER TABLE device_identity ADD COLUMN IF NOT EXISTS client_build INTEGER
  `)
  // "Cập nhật ngay" — timestamp toàn cục; client poll runtime thấy đổi thì chạy
  // self-update check ngay (không chờ chu kỳ 6h).
  await db.execute(sql`
    ALTER TABLE client_update ADD COLUMN IF NOT EXISTS update_check_at TIMESTAMPTZ
  `)

  // Lịch sử nâng/hạ cấp build client (ghi khi device-register báo build khác).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_version_history (
      id           SERIAL PRIMARY KEY,
      mac          TEXT,
      hostname     TEXT,
      from_build   INTEGER,
      to_build     INTEGER,
      from_version TEXT,
      to_version   TEXT,
      direction    TEXT NOT NULL,
      changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS client_version_history_changed_at_idx
      ON client_version_history (changed_at DESC)
  `)

  // Chia sẻ thư mục theo từng PC qua Taildrive. folder_shares = thư mục 1 PC
  // (owner_mac) xuất ra; folder_share_access = ai được truy cập + quyền +
  // auto-mount. headscale gọi GET /api/internal/taildrive/:nodeKey để lấy
  // node-attr + CapGrant tương ứng (Feature: Taildrive per-PC).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS folder_shares (
      id             SERIAL PRIMARY KEY,
      owner_mac      TEXT NOT NULL,
      owner_hostname TEXT,
      share_name     TEXT NOT NULL,
      local_path     TEXT NOT NULL,
      enabled        BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_shares_owner_name ON folder_shares(owner_mac, share_name)`
  )
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_folder_shares_owner ON folder_shares(owner_mac)`
  )

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS folder_share_access (
      id               SERIAL PRIMARY KEY,
      share_id         INTEGER NOT NULL REFERENCES folder_shares(id) ON DELETE CASCADE,
      grantee_mac      TEXT NOT NULL,
      grantee_hostname TEXT,
      access           TEXT NOT NULL DEFAULT 'rw',
      auto_mount       BOOLEAN NOT NULL DEFAULT false,
      mount_drive      TEXT,
      enabled          BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_access_share_grantee ON folder_share_access(share_id, grantee_mac)`
  )
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_folder_access_grantee ON folder_share_access(grantee_mac)`
  )

  // Phiên duyệt cây thư mục (folder picker): admin đặt req_path, client liệt kê
  // rồi ghi entries (JSON) về đây; admin UI poll đọc kết quả.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS folder_browse (
      mac          TEXT PRIMARY KEY,
      req_path     TEXT,
      requested_at TIMESTAMPTZ,
      res_path     TEXT,
      entries      TEXT,
      result_at    TIMESTAMPTZ
    )
  `)
}
