import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { clientConfig, clientNetcheck } from '../db/schema.js'

// Allowed keys — prevent arbitrary key injection.
const ALLOWED_KEYS = new Set([
  'lan_routes', 'itop_lan_prefix', 'pac_extra_subnets', 'pac_extra_domains',
  'gost_fallback', 'metrics_interval', 'proxy_rank', 'gost_listen_port',
  'gost_itop_port', 'gost_itop_addr', 'squid_proxy_addr', 'squid_proxy_port',
  'ping_count', 'ping_timeout',
])

export async function clientConfigRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // GET /api/client-config — list all config rows
  app.get('/api/client-config', async (_req, reply) => {
    try {
      const rows = await db.select().from(clientConfig).orderBy(clientConfig.key)
      return { configs: rows }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })

  // PUT /api/client-config/:key — update a single value
  app.put('/api/client-config/:key', async (req, reply) => {
    const { key } = req.params as { key: string }
    if (!ALLOWED_KEYS.has(key)) {
      return reply.code(400).send({ error: `unknown key: ${key}` })
    }
    const body = req.body as { value?: unknown }
    const value = String(body?.value ?? '').slice(0, 1000)
    try {
      const [row] = await db
        .update(clientConfig)
        .set({ value, updatedAt: new Date() })
        .where(eq(clientConfig.key, key))
        .returning()
      if (!row) return reply.code(404).send({ error: 'key not found' })
      return row
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })

  // GET /api/client-config/ports — list active_ports per client
  app.get('/api/client-config/ports', async (_req, reply) => {
    try {
      const rows = await db
        .select()
        .from(clientNetcheck)
        .orderBy(clientNetcheck.client)
      return { ports: rows }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}

/** Public — no auth. Client agent calls GET /api/client/config on startup + every 5 min. */
export async function clientPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/client/config', async (_req, reply) => {
    try {
      const rows = await db.select().from(clientConfig)
      const m: Record<string, string> = {}
      for (const r of rows) m[r.key] = r.value

      const int_ = (k: string, def: number) => parseInt(m[k] ?? '') || def
      const str  = (k: string, def: string) => m[k] ?? def
      const bool = (k: string, def: boolean) => {
        const v = m[k]; return v === undefined ? def : v === 'true'
      }

      return {
        lan_routes:        str('lan_routes',        '10.0.0.0/8,192.168.0.0/16'),
        itop_lan_prefix:   str('itop_lan_prefix',   '10.'),
        pac_extra_subnets: str('pac_extra_subnets', ''),
        pac_extra_domains: str('pac_extra_domains', ''),
        gost_fallback:     bool('gost_fallback',    false),
        metrics_interval:  int_('metrics_interval', 60),
        proxy_rank:        str('proxy_rank',        'socks5:7654'),
        gost_listen_port:  int_('gost_listen_port', 18888),
        gost_itop_port:    int_('gost_itop_port',   18889),
        gost_itop_addr:    str('gost_itop_addr',    ''),
        squid_proxy_addr:  str('squid_proxy_addr',  ''),
        squid_proxy_port:  int_('squid_proxy_port', 3128),
        ping_count:        int_('ping_count',        2),
        ping_timeout:      str('ping_timeout',      '3s'),
      }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
