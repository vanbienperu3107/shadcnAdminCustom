/**
 * Hợp nhất cấu hình runtime client theo thứ tự: per-node ⊃ global(client_config) ⊃ default.
 *
 * default = giá trị baked-in (khớp hardcode hiện tại trong start-tailscale.bat) → client
 * luôn boot được dù dashboard chết. global = bảng client_config (key-value dùng chung).
 * node = bảng node_runtime_config (theo MAC, fallback hostname) — cột nào null thì bỏ qua.
 *
 * Hàm thuần, không chạm DB → unit-test được trong CI không cần Neon.
 */

export type RuntimeConfig = {
  mode: string                 // '' = client tự nhận diện (itop/votam)
  login_server: string
  always_use_derp: boolean     // <-- "fix UDP": true=ép DERP/TCP, false=cho phép UDP/direct
  derp_keepalive_secs: number
  peer_http_proxy: string      // port HTTP proxy tích hợp (TS_PEER_HTTP_PROXY); '' = tắt
  socks_addr: string
  advertise_routes: string     // '' = không advertise
  lan_routes: string
  pac_server_port: number
}

/** Khớp đúng giá trị hardcode trong start-tailscale.bat hiện tại. */
export const RUNTIME_DEFAULTS: RuntimeConfig = {
  mode: '',
  login_server: 'https://vpn2.hangocthanh.io.vn',
  always_use_derp: true,
  derp_keepalive_secs: 25,
  peer_http_proxy: '7655',
  socks_addr: '127.0.0.1:7654',
  advertise_routes: '',
  lan_routes: '10.0.0.0/8',
  pac_server_port: 7658,
}

/** Hình dạng 1 dòng node_runtime_config (cột null = không override). */
export type NodeRuntimeRow = {
  mac?: string | null
  hostname?: string | null
  mode?: string | null
  loginServer?: string | null
  alwaysUseDerp?: boolean | null
  derpKeepaliveSecs?: number | null
  peerHttpProxy?: string | null
  socksAddr?: string | null
  advertiseRoutes?: string | null
  lanRoutes?: string | null
  pacServerPort?: number | null
}

function num(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : def
}

export function resolveRuntimeConfig(
  globalKV: Record<string, string> = {},
  node: NodeRuntimeRow | null = null,
): RuntimeConfig {
  // 1) bắt đầu từ default
  const out: RuntimeConfig = { ...RUNTIME_DEFAULTS }

  // 2) global (client_config) — chỉ map các key liên quan runtime
  if (globalKV.lan_routes) out.lan_routes = globalKV.lan_routes

  // 3) per-node — cột nào khác null/undefined thì override
  if (node) {
    if (node.mode != null) out.mode = node.mode
    if (node.loginServer != null && node.loginServer !== '') out.login_server = node.loginServer
    if (node.alwaysUseDerp != null) out.always_use_derp = !!node.alwaysUseDerp
    if (node.derpKeepaliveSecs != null) out.derp_keepalive_secs = num(node.derpKeepaliveSecs, out.derp_keepalive_secs)
    if (node.peerHttpProxy != null) out.peer_http_proxy = node.peerHttpProxy
    if (node.socksAddr != null && node.socksAddr !== '') out.socks_addr = node.socksAddr
    if (node.advertiseRoutes != null) out.advertise_routes = node.advertiseRoutes
    if (node.lanRoutes != null && node.lanRoutes !== '') out.lan_routes = node.lanRoutes
    if (node.pacServerPort != null) out.pac_server_port = num(node.pacServerPort, out.pac_server_port)
  }

  return out
}
