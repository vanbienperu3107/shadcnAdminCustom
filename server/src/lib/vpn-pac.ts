import { db } from '../db/client.js'
import { vpnDomains, vpnGateways } from '../db/schema.js'
import type { PacRuleRow } from './build-pac.js'

/**
 * Tích hợp VPN gateway vào PAC: mỗi tên miền trong vpn_domains -> một dòng PAC
 * trỏ `PROXY <tailnet_ip>:<proxy_port>` của gateway tương ứng.
 *
 * Target dựng ĐỘNG từ vpn_gateways (không lưu chuỗi cứng) -> đổi IP tailnet của
 * gateway thì PAC tự đúng. priority mặc định 10 (< pac_rules 100) nên các dòng
 * VPN đứng TRƯỚC, thắng mọi rule `*.bitel.com.pe` chung trong pac_rules.
 *
 * Bỏ qua domain nếu: domain disabled, gateway disabled, hoặc gateway CHƯA có
 * tailnet_ip (chưa biết IP -> chưa route được, đưa vào PAC sẽ sinh target lỗi).
 */

export type VpnGwLite = {
  id: number
  tailnetIp: string | null
  proxyPort: number
  enabled: boolean
}

export type VpnDomainLite = {
  gatewayId: number
  domain: string
  enabled: boolean
  priority: number
}

/** Pure — tách khỏi DB để test dễ. */
export function vpnDomainsToPacRows(
  domains: VpnDomainLite[],
  gateways: VpnGwLite[]
): PacRuleRow[] {
  const gw = new Map(gateways.map((g) => [g.id, g]))
  const rows: PacRuleRow[] = []
  for (const d of domains) {
    if (!d.enabled) continue
    const g = gw.get(d.gatewayId)
    if (!g || !g.enabled || !g.tailnetIp) continue
    rows.push({
      kind: 'domain',
      pattern: d.domain,
      proxyTarget: `PROXY ${g.tailnetIp}:${g.proxyPort}`,
      priority: d.priority,
      enabled: true,
    })
  }
  return rows
}

/** Load các dòng PAC từ VPN gateway trong DB (gộp trước pac_rules khi buildPac). */
export async function loadVpnPacRows(): Promise<PacRuleRow[]> {
  const gws = await db.select().from(vpnGateways)
  const doms = await db.select().from(vpnDomains)
  return vpnDomainsToPacRows(
    doms.map((d) => ({
      gatewayId: d.gatewayId,
      domain: d.domain,
      enabled: d.enabled,
      priority: d.priority,
    })),
    gws.map((g) => ({
      id: g.id,
      tailnetIp: g.tailnetIp,
      proxyPort: g.proxyPort,
      enabled: g.enabled,
    }))
  )
}
