import {
  pgTable,
  integer,
  text,
  boolean,
  real,
  timestamp,
  serial,
} from 'drizzle-orm/pg-core'

/** 1 region = 1 node (theo yêu cầu). region_id do backend tự cấp, 999 reserved cho embedded. */
export const derpServers = pgTable('derp_servers', {
  regionId: integer('region_id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  nodeName: text('node_name').notNull().unique(),
  hostname: text('hostname').notNull(),
  ipv4: text('ipv4'),
  ipv6: text('ipv6'),
  derpPort: integer('derp_port').notNull().default(443),
  stunPort: integer('stun_port').notNull().default(3478),
  canPort80: boolean('can_port80').notNull().default(false),
  stunOnly: boolean('stun_only').notNull().default(false),
  latitude: real('latitude'),
  longitude: real('longitude'),
  enabled: boolean('enabled').notNull().default(true), // ON/OFF
  paused: boolean('paused').notNull().default(false), // tạm dừng
  embedded: boolean('embedded').notNull().default(false), // region 999, read-only
  priority: integer('priority').notNull().default(100), // số nhỏ = ưu tiên cao
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  picture: text('picture'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  tokenExpiry: timestamp('token_expiry', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/** Bảng đơn dòng (id=1 luôn) lưu Headscale API key hiện hành. */
export const headscaleApiKey = pgTable('headscale_api_keys', {
  id: integer('id').primaryKey(), // always 1
  apiKey: text('api_key').notNull(),
  prefix: text('prefix'), // phần prefix trước dấu "." dùng để expire key cũ
  seededAt: timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

export type DerpServer = typeof derpServers.$inferSelect
export type NewDerpServer = typeof derpServers.$inferInsert
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type HeadscaleApiKey = typeof headscaleApiKey.$inferSelect
