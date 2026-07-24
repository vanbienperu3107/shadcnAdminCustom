import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { vpnGateways } from '../db/schema.js'
import { env } from '../env.js'
import { hashPassword } from './password.js'

/**
 * Khai báo 1 VPN gateway từ env lúc khởi động (idempotent) — để deploy dựng
 * gateway + agent token declaratively, không cần gọi API admin.
 *
 * - Chưa có record theo tên -> tạo mới (tailnet_ip, proxy_port, hash token).
 * - Đã có -> chỉ ĐIỀN các ô còn trống (tailnet_ip null, agent_token_hash null);
 *   KHÔNG ghi đè giá trị admin đã đặt hay token đã xoay tay.
 *
 * Trả true nếu vừa tạo mới record (để log).
 */
export async function bootstrapVpnGateway(): Promise<boolean> {
  const name = env.VPN_GW_NAME.trim()
  if (!name) return false
  const tailnetIp = env.VPN_GW_TAILNET_IP.trim() || null
  const proxyPort = env.VPN_GW_PROXY_PORT
  const agentTok = env.VPN_GW_AGENT_TOKEN

  const [existing] = await db
    .select()
    .from(vpnGateways)
    .where(eq(vpnGateways.name, name))

  if (!existing) {
    await db.insert(vpnGateways).values({
      name,
      tailnetIp,
      proxyPort,
      agentTokenHash: agentTok ? await hashPassword(agentTok) : null,
      updatedAt: new Date(),
    })
    return true
  }

  // Chỉ điền ô trống — tôn trọng cấu hình admin đã đặt / token đã xoay tay.
  const set: Partial<typeof vpnGateways.$inferInsert> = {}
  if (tailnetIp && !existing.tailnetIp) set.tailnetIp = tailnetIp
  if (agentTok && !existing.agentTokenHash) set.agentTokenHash = await hashPassword(agentTok)
  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date()
    await db.update(vpnGateways).set(set).where(eq(vpnGateways.id, existing.id))
  }
  return false
}
