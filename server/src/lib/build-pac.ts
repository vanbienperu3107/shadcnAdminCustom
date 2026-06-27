/**
 * Dựng nội dung PAC (proxy auto-config) từ các dòng `pac_rules` trong DB.
 *
 * Quy tắc:
 *  - Chỉ lấy rule enabled=true.
 *  - kind='domain': khớp host theo pattern. Nếu pattern KHÔNG chứa '*', sinh 2 match
 *    (exact + "*.pattern"). Nếu có '*', dùng nguyên pattern.
 *  - kind='subnet': pattern dạng CIDR ("10.0.0.0/8") -> isInNet(host, base, mask).
 *    Không có '/' -> coi như /32.
 *  - Sắp xếp: priority tăng dần (số nhỏ = ưu tiên), rồi domain trước subnet, rồi pattern.
 *  - Không match -> "DIRECT".
 *
 * proxyTarget lưu nguyên directive PAC, vd: "PROXY 127.0.0.1:18888" | "SOCKS5 127.0.0.1:7654".
 */

export type PacRuleRow = {
  kind: 'domain' | 'subnet'
  pattern: string
  proxyTarget: string
  priority: number
  enabled: boolean
}

/** prefix (0..32) -> netmask "255.255.0.0". */
export function prefixToMask(prefix: number): string {
  const p = Math.max(0, Math.min(32, Math.round(prefix)))
  const octets: number[] = []
  for (let i = 0; i < 4; i++) {
    const bits = Math.max(0, Math.min(8, p - i * 8))
    octets.push(256 - Math.pow(2, 8 - bits))
  }
  return octets.join('.')
}

/** "10.0.0.0/8" -> { base: "10.0.0.0", mask: "255.0.0.0" }. Không có '/' -> /32. */
export function cidrToBaseMask(cidr: string): { base: string; mask: string } {
  const [base, prefixStr] = cidr.trim().split('/')
  const prefix = prefixStr === undefined ? 32 : parseInt(prefixStr, 10)
  return { base: base.trim(), mask: prefixToMask(Number.isFinite(prefix) ? prefix : 32) }
}

/** JS string literal an toàn (escape quote/backslash) dùng trong file PAC. */
function lit(s: string): string {
  return JSON.stringify(String(s))
}

function ruleSortKey(r: PacRuleRow): [number, number, string] {
  return [r.priority ?? 100, r.kind === 'domain' ? 0 : 1, r.pattern]
}

export function buildPac(rules: PacRuleRow[]): string {
  const active = rules
    .filter((r) => r.enabled && r.pattern && r.proxyTarget)
    .slice()
    .sort((a, b) => {
      const ka = ruleSortKey(a)
      const kb = ruleSortKey(b)
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2])
    })

  const lines: string[] = []
  for (const r of active) {
    if (r.kind === 'domain') {
      const conds = r.pattern.includes('*')
        ? `shExpMatch(host, ${lit(r.pattern)})`
        : `shExpMatch(host, ${lit(r.pattern)}) || shExpMatch(host, ${lit('*.' + r.pattern)})`
      lines.push(`    if (${conds}) return ${lit(r.proxyTarget)};`)
    } else {
      const { base, mask } = cidrToBaseMask(r.pattern)
      lines.push(`    if (isInNet(host, ${lit(base)}, ${lit(mask)})) return ${lit(r.proxyTarget)};`)
    }
  }

  return [
    '// PAC sinh tự động từ dashboard (pac_rules). KHÔNG sửa tay — sửa trên dashboard.',
    'function FindProxyForURL(url, host) {',
    '    host = host.toLowerCase();',
    ...lines,
    '    return "DIRECT";',
    '}',
    '',
  ].join('\n')
}
