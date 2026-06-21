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

  // Feature A: cột maintenance cho DERP nodes
  await db.execute(sql`
    ALTER TABLE derp_servers ADD COLUMN IF NOT EXISTS maintenance BOOLEAN NOT NULL DEFAULT false
  `)
}
