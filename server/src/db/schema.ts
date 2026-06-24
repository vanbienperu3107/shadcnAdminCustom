import {
  pgTable,
  integer,
  text,
  boolean,
  real,
  timestamp,
  serial,
  primaryKey,
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
  enabled:     boolean('enabled').notNull().default(true),      // ON/OFF
  paused:      boolean('paused').notNull().default(false),      // tạm dừng (ẩn khỏi DERPMap)
  maintenance: boolean('maintenance').notNull().default(false), // bảo trì (score=9999, client tự chuyển)
  embedded:    boolean('embedded').notNull().default(false),    // region 999, read-only
  priority: integer('priority').notNull().default(100), // số nhỏ = ưu tiên cao
  // SSH để quản lý firewall (Feature C)
  sshUser: text('ssh_user').default('root'),
  sshPort: integer('ssh_port').default(22),
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

/** Latency reports từ metrics-report.ps1 chạy trên client (mỗi 60s).
 *  UPSERT theo (src_hostname, dst_hostname) — chỉ giữ bản mới nhất, không tích lũy vô hạn. */
export const latencySamples = pgTable(
  'latency_samples',
  {
    srcHostname: text('src_hostname').notNull(),
    dstHostname: text('dst_hostname').notNull(),
    srcIp:       text('src_ip'),
    mac:         text('mac'),
    rttMs:       real('rtt_ms'),
    path:        text('path'),          // 'direct' | 'derp:regionName'
    ok:          boolean('ok').notNull().default(true),
    lossPct:     integer('loss_pct'),
    reportedAt:  timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.srcHostname, t.dstHostname] })]
)

/** Danh sách IP client bị ép đi qua một DERP cụ thể (quản lý iptables DERP-FORCE). */
export const derpForceRoutes = pgTable('derp_force_routes', {
  id:        serial('id').primaryKey(),
  regionId:  integer('region_id').notNull().references(() => derpServers.regionId, { onDelete: 'cascade' }),
  clientIp:  text('client_ip').notNull(),
  label:     text('label'),   // tên máy / ghi chú
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Per-node DERP region assignments (Feature B).
 *  Mỗi dòng gán một node (theo node_key Tailscale) vào một DERP region.
 *  headscale patch gọi GET /api/internal/derp-map/:nodeKey → trả DERPMap chỉ gồm các region này. */
export const derpNodeAssignments = pgTable('derp_node_assignments', {
  nodeKey:  text('node_key').notNull(),
  regionId: integer('region_id').notNull().references(() => derpServers.regionId, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.nodeKey, t.regionId] })])

export const clientConfig = pgTable('client_config', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  note:      text('note'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const clientNetcheck = pgTable('client_netcheck', {
  client:     text('client').primaryKey(),
  portSocks5: integer('port_socks5'),
  portHttp:   integer('port_http'),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
})

export type DerpServer = typeof derpServers.$inferSelect
export type NewDerpServer = typeof derpServers.$inferInsert
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type HeadscaleApiKey = typeof headscaleApiKey.$inferSelect
export type LatencySample = typeof latencySamples.$inferSelect
export type DerpForceRoute = typeof derpForceRoutes.$inferSelect
export type DerpNodeAssignment = typeof derpNodeAssignments.$inferSelect
export type ClientConfig = typeof clientConfig.$inferSelect
export type ClientNetcheck = typeof clientNetcheck.$inferSelect
