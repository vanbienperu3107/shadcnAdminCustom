/* Smoke test: kết nối Neon, migrate, seed, dựng derpmap. Chạy: tsx scripts/smoke.ts */
import { migrate } from '../src/db/migrate.js'
import { seedIfEmpty } from '../src/db/seed.js'
import { db, queryClient } from '../src/db/client.js'
import { derpServers } from '../src/db/schema.js'
import { buildDerpMap, type DerpServerRow } from '../src/lib/build-derpmap.js'

async function main() {
  console.log('→ migrate…')
  await migrate()
  console.log('→ seed…')
  const seed = await seedIfEmpty()
  console.log('   seed:', seed)
  const rows = (await db.select().from(derpServers)) as DerpServerRow[]
  console.log(`→ ${rows.length} rows:`)
  for (const r of rows) {
    console.log(`   region ${r.regionId} ${r.code} ${r.hostname} enabled=${r.enabled} paused=${r.paused} embedded=${r.embedded}`)
  }
  console.log('→ /derpmap.json:')
  console.log(JSON.stringify(buildDerpMap(rows), null, 2))
  await queryClient.end()
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('SMOKE FAILED:', err)
    process.exit(1)
  }
)
