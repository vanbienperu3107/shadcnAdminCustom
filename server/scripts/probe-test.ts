/* Test probeHost against live DERP servers. Run: tsx scripts/probe-test.ts */
import { probeHost } from '../src/lib/probe.js'

const hosts: [string, number][] = [
  ['vpn2.hangocthanh.io.vn', 443],
  ['vpn3.hangocthanh.io.vn', 443],
  ['vpn4.hangocthanh.io.vn', 443],
  ['vpn5.hangocthanh.io.vn', 443],
  ['vpn6.hangocthanh.io.vn', 443],
]

for (const [h, p] of hosts) {
  const r = await probeHost(h, p)
  console.log(`${h.padEnd(28)} ${r.up ? 'UP  ' : 'DOWN'} ${r.latencyMs ?? '-'}ms path=${r.path ?? '-'} err=${r.error ?? '-'}`)
}
process.exit(0)
