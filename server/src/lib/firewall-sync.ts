import { NodeSSH } from 'node-ssh'
import { env } from '../env.js'

export type SyncResult = {
  ok: boolean
  steps: string[]
  error?: string
}

/**
 * SSH vào DERP node, tạo/cập nhật iptables chain DERP-FORCE.
 *
 * Chain sẽ ACCEPT các client IP trong danh sách, RETURN cho các IP khác
 * (không DROP — không làm gián đoạn client hiện tại ngoài danh sách).
 *
 * Requires: SSH user có quyền chạy iptables (root hoặc sudo NOPASSWD).
 */
export async function syncFirewallRules(
  hostname: string,
  sshUser: string,
  sshPort: number,
  allowedIps: string[]
): Promise<SyncResult> {
  if (!env.DERP_SSH_PRIVATE_KEY) {
    return { ok: false, steps: [], error: 'DERP_SSH_PRIVATE_KEY không được cấu hình' }
  }

  const ssh = new NodeSSH()
  const steps: string[] = []

  try {
    await ssh.connect({
      host: hostname,
      port: sshPort,
      username: sshUser,
      privateKey: env.DERP_SSH_PRIVATE_KEY,
      readyTimeout: 10_000,
    })

    const run = async (cmd: string) => {
      const r = await ssh.execCommand(cmd)
      const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
      steps.push(`$ ${cmd}${out ? `\n  ${out}` : ''}`)
      return r
    }

    // Tạo chain nếu chưa có
    await run('iptables -N DERP-FORCE 2>/dev/null || true')
    // Xóa hết rules cũ
    await run('iptables -F DERP-FORCE')

    // Thêm ACCEPT rule cho từng IP
    for (const ip of allowedIps) {
      if (/^[\d.:a-fA-F/]+$/.test(ip)) {
        await run(`iptables -A DERP-FORCE -s ${ip} -j ACCEPT`)
      }
    }
    // Cuối chain: RETURN (không DROP client ngoài danh sách)
    await run('iptables -A DERP-FORCE -j RETURN')

    // Đảm bảo INPUT chain jump vào DERP-FORCE (chèn đầu nếu chưa có)
    await run(
      'iptables -C INPUT -j DERP-FORCE 2>/dev/null || iptables -I INPUT 1 -j DERP-FORCE'
    )

    return { ok: true, steps }
  } catch (e) {
    return { ok: false, steps, error: String(e) }
  } finally {
    ssh.dispose()
  }
}

/** Xóa DERP-FORCE chain và bỏ jump khỏi INPUT. */
export async function clearFirewallRules(
  hostname: string,
  sshUser: string,
  sshPort: number
): Promise<SyncResult> {
  if (!env.DERP_SSH_PRIVATE_KEY) {
    return { ok: false, steps: [], error: 'DERP_SSH_PRIVATE_KEY không được cấu hình' }
  }

  const ssh = new NodeSSH()
  const steps: string[] = []

  try {
    await ssh.connect({
      host: hostname,
      port: sshPort,
      username: sshUser,
      privateKey: env.DERP_SSH_PRIVATE_KEY,
      readyTimeout: 10_000,
    })

    const run = async (cmd: string) => {
      const r = await ssh.execCommand(cmd)
      const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
      steps.push(`$ ${cmd}${out ? `\n  ${out}` : ''}`)
    }

    await run('iptables -D INPUT -j DERP-FORCE 2>/dev/null || true')
    await run('iptables -F DERP-FORCE 2>/dev/null || true')
    await run('iptables -X DERP-FORCE 2>/dev/null || true')

    return { ok: true, steps }
  } catch (e) {
    return { ok: false, steps, error: String(e) }
  } finally {
    ssh.dispose()
  }
}
