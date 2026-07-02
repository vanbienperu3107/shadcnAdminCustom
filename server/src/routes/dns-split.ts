import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { dnsSplitRules } from '../db/schema.js'
import { env } from '../env.js'

function toNameserverList(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Public endpoint — gọi bởi headscale patch (Feature D, dns/patch.go), cùng
 * dashboard/secret với Feature B (per-node DERPMap). Không cần login; bảo vệ
 * bằng X-Headscale-Secret nếu env được set.
 *
 * Trả về { "domain.": ["ns1","ns2"], ... } — khớp shape mà headscale
 * hscontrol/dns/patch.go unmarshal (map[string][]string). Chỉ domain enabled.
 */
export async function dnsSplitPublicRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get('/api/internal/dns-split', async (req, reply) => {
    if (env.HEADSCALE_DASHBOARD_SECRET) {
      const header = req.headers['x-headscale-secret']
      if (header !== env.HEADSCALE_DASHBOARD_SECRET) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
    }

    const rows = await db
      .select()
      .from(dnsSplitRules)
      .where(eq(dnsSplitRules.enabled, true))

    const result: Record<string, string[]> = {}
    for (const r of rows) {
      const domain = r.domain.trim().replace(/\.$/, '') + '.' // headscale split-DNS key format: "domain."
      result[domain] = toNameserverList(r.nameservers)
    }

    return reply.send(result)
  })
}

const ruleSchema = z.object({
  domain: z.string().min(1).max(253),
  nameservers: z.string().min(1).max(500), // CSV
  note: z.string().max(500).nullish(),
  enabled: z.boolean().default(true),
})

/** Admin CRUD — yêu cầu đăng nhập. */
export async function dnsSplitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/dns-split', async () => {
    return db.select().from(dnsSplitRules).orderBy(dnsSplitRules.domain)
  })

  app.post('/api/dns-split', async (req, reply) => {
    const parsed = ruleSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    try {
      const domain = parsed.data.domain.trim().toLowerCase().replace(/\.$/, '')
      const [row] = await db
        .insert(dnsSplitRules)
        .values({ ...parsed.data, domain })
        .returning()
      return reply.code(201).send(row)
    } catch (e) {
      return reply.code(409).send({ error: `domain đã tồn tại: ${String(e)}` })
    }
  })

  app.patch<{ Params: { id: string } }>(
    '/api/dns-split/:id',
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
      const parsed = ruleSchema.partial().safeParse(req.body)
      if (!parsed.success)
        return reply.code(400).send({ error: parsed.error.flatten() })
      const setData: Record<string, unknown> = { updatedAt: new Date() }
      if (parsed.data.domain !== undefined) {
        setData.domain = parsed.data.domain
          .trim()
          .toLowerCase()
          .replace(/\.$/, '')
      }
      if (parsed.data.nameservers !== undefined)
        setData.nameservers = parsed.data.nameservers
      if (parsed.data.note !== undefined) setData.note = parsed.data.note
      if (parsed.data.enabled !== undefined)
        setData.enabled = parsed.data.enabled

      const [row] = await db
        .update(dnsSplitRules)
        .set(setData)
        .where(eq(dnsSplitRules.id, id))
        .returning()
      if (!row) return reply.code(404).send({ error: 'not found' })
      return row
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/api/dns-split/:id',
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
      await db.delete(dnsSplitRules).where(eq(dnsSplitRules.id, id))
      return reply.code(204).send()
    }
  )
}
