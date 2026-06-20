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
}
