/**
 * Probe health THẬT của 1 DERP node: gọi HTTPS endpoint probe và VERIFY TLS
 * (như client Tailscale) — nên cert lỗi/self-signed sẽ ra "chết".
 * Thử lần lượt /derp/probe (derper chuẩn) rồi /relay/probe (relay lai vpn5/vpn6).
 */
export type ProbeResult = {
  up: boolean
  latencyMs: number | null
  path: string | null
  error: string | null
}

const PROBE_PATHS = ['/derp/probe', '/relay/probe']
const TIMEOUT_MS = 4000

function errCode(e: unknown): string {
  const err = e as { cause?: { code?: string }; name?: string; message?: string }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout'
  return err?.cause?.code ?? err?.message ?? 'error'
}

export async function probeHost(hostname: string, derpPort: number): Promise<ProbeResult> {
  const portPart = derpPort && derpPort !== 443 ? `:${derpPort}` : ''
  const base = `https://${hostname}${portPart}`
  let lastErr = 'unreachable'

  for (const path of PROBE_PATHS) {
    const start = Date.now()
    try {
      const res = await fetch(base + path, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) {
        return { up: true, latencyMs: Date.now() - start, path, error: null }
      }
      lastErr = `HTTP ${res.status}`
    } catch (e) {
      lastErr = errCode(e)
    }
  }
  return { up: false, latencyMs: null, path: null, error: lastErr }
}
