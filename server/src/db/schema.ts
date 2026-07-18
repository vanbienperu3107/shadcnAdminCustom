import {
  pgTable,
  integer,
  bigint,
  bigserial,
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
  enabled: boolean('enabled').notNull().default(true), // ON/OFF
  paused: boolean('paused').notNull().default(false), // tạm dừng (ẩn khỏi DERPMap)
  maintenance: boolean('maintenance').notNull().default(false), // bảo trì (score=9999, client tự chuyển)
  embedded: boolean('embedded').notNull().default(false), // region 999, read-only
  priority: integer('priority').notNull().default(100), // số nhỏ = ưu tiên cao
  // SSH để quản lý firewall (Feature C)
  sshUser: text('ssh_user').default('root'),
  sshPort: integer('ssh_port').default(22),
  // nodeKey của máy Tailscale sidecar chạy trên chính host DERP này (khác
  // node_name — đó chỉ là label hiển thị trong DERPMap, không phải given-name
  // thật). Dùng để đồng bộ bảng `device_identity` (device_type='derp_infra')
  // thay vì đoán qua chuỗi tên — xem devices.ts.
  tsNodeKey: text('ts_node_key'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  // googleSub nullable: user đăng nhập bằng username/password không có google_sub.
  googleSub: text('google_sub').unique(),
  email: text('email').notNull(),
  name: text('name'),
  picture: text('picture'),
  // Đăng nhập nội bộ bằng username + mật khẩu (tùy chọn, song song Google).
  username: text('username').unique(),
  passwordHash: text('password_hash'),
  // 2FA TOTP: secret (base32) + cờ đã bật. totpSecret có thể tồn tại ở trạng
  // thái "đang cài đặt, chưa xác minh" — chỉ coi là bật khi totpEnabled=true.
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  // Counter TOTP đã dùng gần nhất — chống replay: từ chối mã có counter <= giá trị này.
  totpLastCounter: integer('totp_last_counter'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  // Session đang chờ bước 2FA: đã xác thực mật khẩu nhưng CHƯA qua TOTP.
  // getSessionUser/requireAuth coi như chưa đăng nhập cho tới khi promote.
  pending2fa: boolean('pending_2fa').notNull().default(false),
  // Số lần nhập sai mã 2FA cho session pending này — khóa khi vượt ngưỡng.
  mfaAttempts: integer('mfa_attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/** Bảng đơn dòng (id=1 luôn) lưu Headscale API key hiện hành. */
export const headscaleApiKey = pgTable('headscale_api_keys', {
  id: integer('id').primaryKey(), // always 1
  apiKey: text('api_key').notNull(),
  prefix: text('prefix'), // phần prefix trước dấu "." dùng để expire key cũ
  seededAt: timestamp('seeded_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
})

/** Latency reports từ metrics-report.ps1 chạy trên client (mỗi 60s).
 *  UPSERT theo (src_hostname, dst_hostname) — chỉ giữ bản mới nhất, không tích lũy vô hạn. */
export const latencySamples = pgTable(
  'latency_samples',
  {
    srcHostname: text('src_hostname').notNull(),
    dstHostname: text('dst_hostname').notNull(),
    srcIp: text('src_ip'),
    mac: text('mac'),
    rttMs: real('rtt_ms'),
    path: text('path'), // 'direct' | 'derp:regionName'
    ok: boolean('ok').notNull().default(true),
    lossPct: integer('loss_pct'),
    reportedAt: timestamp('reported_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.srcHostname, t.dstHostname] })]
)

/** Home DERP hiện tại của từng client — client mod tự báo cáo mỗi 3s.
 *  UPSERT theo mac, chỉ giữ bản mới nhất (không tích lũy lịch sử). */
export const clientHomeDerp = pgTable('client_home_derp', {
  mac: text('mac').primaryKey(),
  hostname: text('hostname').notNull(),
  homeRegionId: integer('home_region_id'),
  homeRegionCode: text('home_region_code'),
  controllerLatencyMs: real('controller_latency_ms'),
  reportedAt: timestamp('reported_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Ping từ 1 client tới TỪNG DERP region — client mod tự báo cáo mỗi 30s.
 *  UPSERT theo (client, region_id), chỉ giữ bản mới nhất mỗi cặp. */
export const clientDerpPing = pgTable(
  'client_derp_ping',
  {
    client: text('client').notNull(), // mac
    regionId: integer('region_id').notNull(),
    regionCode: text('region_code'),
    rttMs: real('rtt_ms'),
    ok: boolean('ok').notNull().default(true),
    reportedAt: timestamp('reported_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.client, t.regionId] })]
)

/** Danh sách IP client bị ép đi qua một DERP cụ thể (quản lý iptables DERP-FORCE). */
export const derpForceRoutes = pgTable('derp_force_routes', {
  id: serial('id').primaryKey(),
  regionId: integer('region_id')
    .notNull()
    .references(() => derpServers.regionId, { onDelete: 'cascade' }),
  clientIp: text('client_ip').notNull(),
  label: text('label'), // tên máy / ghi chú
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Per-node DERP region assignments (Feature B).
 *  Mỗi dòng gán một node (theo node_key Tailscale) vào một DERP region.
 *  headscale patch gọi GET /api/internal/derp-map/:nodeKey → trả DERPMap chỉ gồm các region này. */
export const derpNodeAssignments = pgTable(
  'derp_node_assignments',
  {
    nodeKey: text('node_key').notNull(),
    regionId: integer('region_id')
      .notNull()
      .references(() => derpServers.regionId, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.nodeKey, t.regionId] })]
)

/** Cờ "khóa cứng 1 DERP" theo node (tách bảng riêng vì exclusive là thuộc
 *  tính của CẢ NODE, không phải của từng dòng gán — tránh phải đồng bộ N dòng
 *  derp_node_assignments mỗi lần bật/tắt). exclusive=true → GET
 *  /api/internal/derp-map/:nodeKey trả DERPMap CHỈ gồm region được gán (loại
 *  hẳn, không phải chỉ phạt priority) — client không còn gì khác để tự chọn. */
export const derpNodeOptions = pgTable('derp_node_options', {
  nodeKey: text('node_key').primaryKey(),
  exclusive: boolean('exclusive').notNull().default(false),
})

/** Trạng thái sức khỏe của region đang bị "khóa cứng" cho 1 node — cập nhật
 *  bởi 1 tiến trình nền probe TLS định kỳ (KHÔNG probe trực tiếp trong request
 *  GET /api/internal/derp-map, vì probe TLS có thể mất tới ~8s trong khi
 *  headscale chỉ chờ 500ms rồi fail-open). status:
 *   'ok'       — region khóa đang sống, phục vụ map exclusive bình thường.
 *   'grace'    — region chết nhưng CHƯA quá 10 phút, vẫn phục vụ exclusive
 *                (chờ xem có hồi phục không, tránh flap qua lại).
 *   'fallback' — chết LIÊN TỤC ≥10 phút → van an toàn: tạm phục vụ map UNION
 *                (như node bình thường) để client không bị kẹt cứng. Tự khóa
 *                lại 'ok' ngay khi region sống trở lại. */
export const derpNodeHealth = pgTable('derp_node_health', {
  nodeKey:       text('node_key').primaryKey(),
  status:        text('status').notNull().default('ok'),
  lastHealthyAt: timestamp('last_healthy_at', { withTimezone: true }),
  downSince:     timestamp('down_since', { withTimezone: true }),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Danh tính thiết bị theo MAC — "tên chuẩn" của 1 phần cứng, ổn định qua
 * nhiều lần cài lại (nodeKey đổi mỗi lần cài lại, MAC thì không). Lần đầu
 * thấy 1 MAC → hostname báo về trở thành tên chuẩn. Lần sau nếu node báo tên
 * khác (rebuild/rename hệ điều hành) → tự đổi node hiện tại về ĐÚNG tên
 * chuẩn này (không tạo tên mới) — xem POST /api/internal/device-register.
 *
 * Đây cũng là bảng "device registry" hợp nhất: mọi thiết bị (client thật lẫn
 * hạ tầng DERP) đều có 1 dòng, phân biệt bằng `deviceType` — KHÔNG đoán qua
 * tên/hostname (xem lịch sử bug PR #16/#17). `deviceType='derp_infra'` được
 * đồng bộ từ `derp_servers.ts_node_key` (routes/derp.ts); `deviceType='client'`
 * được đồng bộ từ POST /api/internal/device-register. Xóa machine hay xóa
 * DERP region đều phải xóa dòng tương ứng ở đây (xem node-cascade-delete.ts).
 */
/**
 * Zero-touch enrollment — 1 dòng / thiết bị, khoá tự nhiên (mac, salt).
 *
 * salt = serial ổ đĩa đã chuẩn hoá, CŨNG CHÍNH LÀ seed machine key của client
 * (cmd/tailscaled/hwid.go). Ai biết salt suy được private machine key ⇒ coi cột
 * này là nhạy cảm: UI mask, không log.
 *
 * Vòng đời: pending -(admin duyệt)-> approved -(admin thu hồi)-> revoked.
 * deviceTokenHash chỉ set ở lần enroll THÀNH CÔNG ĐẦU TIÊN (first-enroll-wins);
 * từ đó client phải chìa token khớp mới xin được authKey.
 */
export const deviceEnrollment = pgTable('device_enrollment', {
  id:              serial('id').primaryKey(),
  mac:             text('mac').notNull(),
  salt:            text('salt').notNull(),
  status:          text('status').notNull().default('pending'), // pending | approved | revoked
  deviceTokenHash: text('device_token_hash'), // sha256(token); null = chưa ai claim
  pinnedIpv4:      text('pinned_ipv4'),       // IP ghim (admin chọn lúc duyệt)
  note:            text('note'),              // tên/ghi chú admin đặt
  hostname:        text('hostname'),          // client tự báo, giúp nhận diện lúc duyệt
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt:      timestamp('approved_at', { withTimezone: true }),
  approvedBy:      text('approved_by'),
  enrolledAt:      timestamp('enrolled_at', { withTimezone: true }),
  lastEnrollAt:    timestamp('last_enroll_at', { withTimezone: true }),
})

export const deviceIdentity = pgTable('device_identity', {
  // id tự sinh — KHÔNG dùng mac làm PK vì hạ tầng DERP (deviceType='derp_infra')
  // không có MAC (không phải client của ta, không gọi device-register); khóa
  // tự nhiên khác nhau theo loại: client neo theo `mac` (nodeKey đổi mỗi lần
  // cài lại), derp_infra neo theo `nodeKey` (ổn định, admin gán tay 1 lần).
  id:           serial('id').primaryKey(),
  mac:          text('mac').unique(),      // null với derp_infra
  hostname:     text('hostname').notNull(),
  nodeKey:      text('node_key').unique(), // null cho tới khi biết (client) / luôn có (derp_infra)
  managedUser:  text('managed_user'), // user quản lý (headscale user name/email)
  deviceType:   text('device_type').notNull().default('client'), // 'client' | 'derp_infra'
  deviceToken:  text('device_token'), // token riêng cho thiết bị, sinh lúc đăng ký lần đầu
  lastIpv4:     text('last_ipv4'),    // IP tailnet gần nhất được báo cáo (tự động)
  staticIpv4:   text('static_ipv4'),  // IP admin ép cố định (ưu tiên hơn lastIpv4)
  clientVersion: text('client_version'), // version client tự báo (device-register)
  clientBuild:  integer('client_build'), // build number tăng đơn điệu (so sánh update)
  clientVariant: text('client_variant'), // 'portable' | 'proxy' | 'vpn' | 'linux-amd64'
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Định danh thiết bị theo salt (plan device_id — F0 nền móng).
//
// `salt` = serial ổ cứng đã chuẩn hoá = SEED sinh private machine key phía client
// (cmd/tailscaled/hwid.go). KHÔNG BAO GIỜ lưu salt thô — chỉ lưu `salt_hmac` =
// HMAC-SHA256(salt, PEPPER) (PEPPER là secret env, tách kênh khỏi DATABASE_URL):
// lộ DB đơn thuần không đảo ngược được salt → không tái tạo được machine key.
//
// `device.id` là surrogate NỘI BỘ, KHÔNG lộ ra client (client chỉ gửi salt/key).
// MAC tụt xuống ALIAS (1 device nhiều MAC) — xem `deviceMac`. Các bảng nghiệp vụ
// (folder_shares, pac_rules, ...) sẽ trỏ vào `device.id` bằng FK (F5/F6/F7), thay
// cho việc khoá theo MAC vốn không ổn định (đổi card mạng → token_mismatch).
//
// Vòng đời: pending -(admin duyệt)-> approved -(admin thu hồi)-> revoked.
// Bootstrap key #1: máy đã approved chìa salt → cấp key; salt lạ → pending chờ
// admin. Chi tiết: docs/plan-device-id.md.
export const device = pgTable('device', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  saltHmac:      text('salt_hmac').notNull().unique(), // HMAC-SHA256(salt, PEPPER); KHÔNG lưu salt thô
  status:        text('status').notNull().default('pending'), // pending | approved | revoked
  hostname:      text('hostname'),
  note:          text('note'),
  srcIpFirst:    text('src_ip_first'),   // IP lần liên lạc đầu — giúp admin xét salt lạ
  staticIpv4:    text('static_ipv4'),    // IP admin ép cố định (ưu tiên hơn lastIpv4)
  lastIpv4:      text('last_ipv4'),      // IP tailnet gần nhất được báo cáo (tự động)
  nodeKey:       text('node_key').unique(), // headscale nodeKey (biết sau khi đăng ký)
  keySeenAt:     timestamp('key_seen_at', { withTimezone: true }), // đã trình key lần đầu — cổng F1c
  isPreapprove:  boolean('is_preapprove').notNull().default(false), // pre-approve MIỄN cửa sổ 15'
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt:    timestamp('approved_at', { withTimezone: true }),
  approvedBy:    text('approved_by'),
})

/** Nhiều MAC / 1 thiết bị. MAC lạ của device đã approved → tạo dòng pending, chờ
 *  admin duyệt (chống fake salt mượn MAC máy khác). mac = normalizeMac (lowercase). */
export const deviceMac = pgTable('device_mac', {
  mac:        text('mac').primaryKey(),
  deviceId:   bigint('device_id', { mode: 'number' })
    .notNull()
    .references(() => device.id, { onDelete: 'cascade' }),
  status:     text('status').notNull().default('pending'), // pending | approved
  firstSeen:  timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
})

/** Credential Bearer xoay vòng ≤24h. key_prev_hash = cửa grace (mất response
 *  refresh). Daemon client sở hữu key trong node-key.json; server chỉ lưu hash. */
export const deviceKey = pgTable('device_key', {
  deviceId:    bigint('device_id', { mode: 'number' })
    .primaryKey()
    .references(() => device.id, { onDelete: 'cascade' }),
  keyHash:     text('key_hash').notNull(),      // sha256(key)
  keyPrevHash: text('key_prev_hash'),           // sha256(key trước) — cửa grace
  expiresAt:   timestamp('expires_at', { withTimezone: true }).notNull(),
  rotatedAt:   timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Nhật ký cấp phát / xoay / thu hồi key — nguồn cho UI + phát hiện bản sao. */
export const deviceKeyAudit = pgTable('device_key_audit', {
  id:       serial('id').primaryKey(),
  deviceId: bigint('device_id', { mode: 'number' }).notNull(),
  event:    text('event').notNull(), // issued|rotated|grace|reuse_detected|revoked|expired|window_expired|dup_enroll
  at:       timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  srcIp:    text('src_ip'),
  keyFp:    text('key_fp'),           // 8 ký tự đầu sha256(key) — KHÔNG bao giờ key thô
})

/** Xung đột cần admin xử lý tay (thay cho "dừng migration"). kind:
 *  salt_dup | mac_case | orphan_mac | share_dup | mac_stolen | dup_enroll | identity_dup */
export const deviceConflict = pgTable('device_conflict', {
  id:         serial('id').primaryKey(),
  kind:       text('kind').notNull(),
  key:        text('key'),            // salt_hmac / mac / ... tuỳ kind
  rowIds:     text('row_ids'),        // JSON các id liên quan
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

/** Cấu hình auto-update client (singleton id=1). enabled=false = kill-switch;
 *  pinnedBuild != null = đóng băng fleet ở build đó thay vì theo release mới. */
export const clientUpdate = pgTable('client_update', {
  id:          integer('id').primaryKey().default(1),
  enabled:     boolean('enabled').notNull().default(false),
  pinnedBuild: integer('pinned_build'),
  // "Cập nhật ngay": touch = now() → client thấy qua /api/client/runtime (poll
  // 20s) và chạy self-update check liền thay vì chờ chu kỳ 6h.
  updateCheckAt: timestamp('update_check_at', { withTimezone: true }),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Lịch sử đổi build của client (nâng cấp/hạ cấp/lần đầu). Ghi mỗi khi
 *  device-register báo client_build khác giá trị đang lưu. direction:
 *  'initial' (lần đầu có build) | 'upgrade' (build tăng) | 'downgrade' (giảm). */
export const clientVersionHistory = pgTable('client_version_history', {
  id:          serial('id').primaryKey(),
  mac:         text('mac'),
  hostname:    text('hostname'),
  fromBuild:   integer('from_build'),
  toBuild:     integer('to_build'),
  fromVersion: text('from_version'),
  toVersion:   text('to_version'),
  direction:   text('direction').notNull(),
  changedAt:   timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
})

export const clientConfig = pgTable('client_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const clientNetcheck = pgTable('client_netcheck', {
  client: text('client').primaryKey(),
  portSocks5: integer('port_socks5'),
  portHttp: integer('port_http'),
  mode: text('mode'), // 'portable' | 'proxy' | 'vpn' (node-build variant)
  advertisedRoutes: text('advertised_routes'), // vd "10.0.0.0/8" (chỉ node proxy)
  reportedAt: timestamp('reported_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Cấu hình runtime per-node (load từ dashboard lúc client khởi động).
 *  Key = MAC (chính); hostname là cột phụ để tra cứu fallback.
 *  Cột null = không override (client dùng global/default). */
export const nodeRuntimeConfig = pgTable('node_runtime_config', {
  mac: text('mac').primaryKey(),
  hostname: text('hostname'),
  mode: text('mode'),
  loginServer: text('login_server'),
  alwaysUseDerp: boolean('always_use_derp'), // "fix UDP": true=ép DERP/TCP, false=cho UDP
  derpKeepaliveSecs: integer('derp_keepalive_secs'),
  peerHttpProxy: text('peer_http_proxy'),
  socksAddr: text('socks_addr'),
  advertiseRoutes: text('advertise_routes'),
  lanRoutes: text('lan_routes'),
  pacServerPort: integer('pac_server_port'),
  // null = theo cấu hình auto-update toàn cục (client_update.enabled); true/false
  // = ép riêng máy này, bất kể cấu hình toàn cục — xem GET /api/client/latest.
  autoUpdateEnabled: boolean('auto_update_enabled'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** "Bấm Reload" cho 1 client cụ thể (theo MAC). Node launcher poll định kỳ
 *  GET /api/client/runtime, so requested_at với lần áp dụng gần nhất — khác
 *  thì tự áp lại cấu hình ngay (không cần khởi động lại node). Không cần dòng
 *  node_runtime_config tồn tại — reload áp dụng được cho cả node đang dùng
 *  default/global. */
export const nodeReloadRequests = pgTable('node_reload_requests', {
  mac: text('mac').primaryKey(),
  requestedAt: timestamp('requested_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** "Cập nhật ngay" nhắm vào 1 client cụ thể (theo MAC) — cùng cơ chế với
 *  nodeReloadRequests ở trên, nhưng riêng cho self-update: GET
 *  /api/client/runtime trả update_check_at = MAX(dòng này theo mac, cột
 *  toàn cục client_update.update_check_at), để admin chọn đẩy update cho
 *  1 máy mà không cần bump toàn fleet. */
export const nodeUpdateRequests = pgTable('node_update_requests', {
  mac: text('mac').primaryKey(),
  requestedAt: timestamp('requested_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Luật PAC động (render thành file PAC qua /api/client/pac).
 *  scope='global' áp cho mọi node; scope='node' chỉ áp cho node có mac trùng. */
export const pacRules = pgTable('pac_rules', {
  id: serial('id').primaryKey(),
  scope: text('scope').notNull().default('global'), // 'global' | 'node'
  mac: text('mac'),
  kind: text('kind').notNull(), // 'domain' | 'subnet'
  pattern: text('pattern').notNull(),
  proxyTarget: text('proxy_target').notNull(), // vd "PROXY 127.0.0.1:18888"
  priority: integer('priority').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Split-DNS: domain nội bộ (bitel.com.pe, viettelperu.com, ...) -> nameserver
 *  nội bộ (DC Peru). headscale gọi GET /api/internal/dns-split (Feature D,
 *  cùng dashboard/secret với Feature B per-node DERPMap) mỗi khi build
 *  MapResponse, merge vào tailcfg.DNSConfig.Routes cho MỌI node — không cần
 *  sửa config.yaml + restart headscale khi thêm/sửa domain. */
export const dnsSplitRules = pgTable('dns_split_rules', {
  id: serial('id').primaryKey(),
  domain: text('domain').notNull().unique(), // vd "bitel.com.pe" (không cần dấu chấm cuối)
  nameservers: text('nameservers').notNull(), // CSV, vd "10.121.127.193,10.121.127.194"
  note: text('note'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Thư mục 1 PC (owner) chia sẻ ra tailnet qua Taildrive. Key theo MAC owner
 *  (ổn định qua cài lại); share_name = tên Taildrive đã chuẩn hoá.
 *  UNIQUE(owner_mac, share_name) đặt ở migrate.ts. */
export const folderShares = pgTable('folder_shares', {
  id: serial('id').primaryKey(),
  ownerMac: text('owner_mac').notNull(),
  ownerHostname: text('owner_hostname'),
  shareName: text('share_name').notNull(),
  localPath: text('local_path').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Ai (grantee PC) được truy cập 1 share, quyền gì, có auto-mount ổ đĩa không.
 *  share_id -> folder_shares(id) ON DELETE CASCADE (ở migrate.ts).
 *  UNIQUE(share_id, grantee_mac) ở migrate.ts. access = 'ro' | 'rw'. */
export const folderShareAccess = pgTable('folder_share_access', {
  id: serial('id').primaryKey(),
  shareId: integer('share_id').notNull(),
  granteeMac: text('grantee_mac').notNull(),
  granteeHostname: text('grantee_hostname'),
  access: text('access').notNull().default('rw'),
  autoMount: boolean('auto_mount').notNull().default(false),
  mountDrive: text('mount_drive'), // vd 'Z:'; null = auto chọn ổ trống
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Trạng thái áp folder-share do CHÍNH client báo về sau mỗi vòng reconcile
 *  (theo MAC). payload = JSON { shares:[{name,path,ok,error}],
 *  mounts:[{share,machine,drive,ok,error}] } — dashboard đọc để hiển thị máy
 *  nào serve/mount được, lỗi gì (vd "System error 67"). 1 dòng/mac (bản mới
 *  đè bản cũ). */
export const folderShareStatus = pgTable('folder_share_status', {
  mac: text('mac').primaryKey(),
  hostname: text('hostname'),
  payload: text('payload'), // JSON: { shares:[...], mounts:[...] }
  reportedAt: timestamp('reported_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Phiên "duyệt cây thư mục" của 1 PC (theo MAC). Admin đặt req_path; client
 *  poll GET /api/client/browse-request, liệt kê rồi POST kết quả về entries. */
export const folderBrowse = pgTable('folder_browse', {
  mac: text('mac').primaryKey(),
  reqPath: text('req_path'),
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  resPath: text('res_path'),
  entries: text('entries'), // JSON: [{ name, is_dir }]
  resultAt: timestamp('result_at', { withTimezone: true }),
})

export type DerpServer = typeof derpServers.$inferSelect
export type NewDerpServer = typeof derpServers.$inferInsert
export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type HeadscaleApiKey = typeof headscaleApiKey.$inferSelect
export type LatencySample = typeof latencySamples.$inferSelect
export type DerpForceRoute = typeof derpForceRoutes.$inferSelect
export type DerpNodeAssignment = typeof derpNodeAssignments.$inferSelect
export type DerpNodeOptions = typeof derpNodeOptions.$inferSelect
export type DerpNodeHealth = typeof derpNodeHealth.$inferSelect
export type DeviceIdentity = typeof deviceIdentity.$inferSelect
export type ClientConfig = typeof clientConfig.$inferSelect
export type ClientNetcheck = typeof clientNetcheck.$inferSelect
export type NodeRuntimeConfig = typeof nodeRuntimeConfig.$inferSelect
export type NodeReloadRequest = typeof nodeReloadRequests.$inferSelect
export type PacRule = typeof pacRules.$inferSelect
export type DnsSplitRule = typeof dnsSplitRules.$inferSelect
export type ClientHomeDerp = typeof clientHomeDerp.$inferSelect
export type FolderShare = typeof folderShares.$inferSelect
export type FolderShareAccess = typeof folderShareAccess.$inferSelect
export type FolderShareStatus = typeof folderShareStatus.$inferSelect
export type FolderBrowse = typeof folderBrowse.$inferSelect
export type ClientDerpPing = typeof clientDerpPing.$inferSelect
