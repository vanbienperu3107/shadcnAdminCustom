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

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`)

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
      ('squid_proxy_port',  '3128',                       'Port Squid HTTP proxy')
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
}
