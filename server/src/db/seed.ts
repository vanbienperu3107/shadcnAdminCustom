import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { sql } from 'drizzle-orm'
import { db } from './client.js'
import { derpServers } from './schema.js'
import { env } from '../env.js'
import { EMBEDDED_REGION_ID } from '../lib/region-id.js'

type YamlNode = {
  name?: string
  regionid?: number
  hostname?: string
  ipv4?: string
  ipv6?: string
  stunport?: number
  derpport?: number
}
type YamlRegion = {
  regionid?: number
  regioncode?: string
  regionname?: string
  nodes?: YamlNode[]
}
type DerpYaml = { regions?: Record<string, YamlRegion> }

/**
 * Seed lần đầu (chỉ khi bảng rỗng). Idempotent qua ON CONFLICT DO NOTHING.
 *  1. Region 999 embedded (vpn2) — read-only trong UI, KHÔNG vào /derpmap.json.
 *  2. Các region trong derp.yaml (1000..) nếu có SEED_DERP_YAML.
 */
export async function seedIfEmpty(): Promise<{ seeded: boolean; count: number }> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(derpServers)
  if (count > 0) return { seeded: false, count }

  const rows: (typeof derpServers.$inferInsert)[] = []

  // 1) Embedded region 999
  rows.push({
    regionId: EMBEDDED_REGION_ID,
    code: 'myderp',
    name: 'My DERP Server',
    nodeName: 'embedded-999',
    hostname: env.EMBEDDED_HOSTNAME,
    ipv4: env.EMBEDDED_IPV4 || null,
    enabled: true,
    paused: false,
    embedded: true,
    priority: 100,
  })

  // 2) derp.yaml
  if (env.SEED_DERP_YAML) {
    try {
      const raw = readFileSync(env.SEED_DERP_YAML, 'utf8')
      const doc = parseYaml(raw) as DerpYaml
      for (const [key, region] of Object.entries(doc.regions ?? {})) {
        const regionId = region.regionid ?? Number(key)
        const node = region.nodes?.[0]
        if (!regionId || !node?.hostname) continue
        rows.push({
          regionId,
          code: region.regioncode ?? `region-${regionId}`,
          name: region.regionname ?? `Region ${regionId}`,
          nodeName: node.name ?? `${region.regioncode ?? regionId}-1`,
          hostname: node.hostname,
          ipv4: node.ipv4 ?? null,
          ipv6: node.ipv6 ?? null,
          derpPort: node.derpport ?? 443,
          stunPort: node.stunport ?? 3478,
          enabled: true,
          paused: false,
          embedded: false,
          priority: 100,
        })
      }
    } catch (err) {
      console.error(`[seed] không đọc được ${env.SEED_DERP_YAML}:`, err)
    }
  }

  if (rows.length > 0) {
    await db.insert(derpServers).values(rows).onConflictDoNothing()
  }
  return { seeded: true, count: rows.length }
}

// Cho phép chạy tay: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { migrate } = await import('./migrate.js')
  await migrate()
  const res = await seedIfEmpty()
  console.log('[seed]', res)
  process.exit(0)
}
