import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { existsSync } from 'node:fs'
import { migrate } from './db/migrate.js'
import { seedIfEmpty } from './db/seed.js'
import { env, googleEnabled } from './env.js'
import { bootstrapAdmin } from './lib/admin-bootstrap.js'
import { seedFromEnv, startAutoRefresh } from './lib/apikey-manager.js'
import { startDerpNodeHealthSweep } from './lib/derp-node-health.js'
import { apikeyRoutes } from './routes/apikey.js'
import { authRoutes } from './routes/auth.js'
import { ciRoutes } from './routes/ci.js'
import {
  clientConfigRoutes,
  clientPublicRoutes,
} from './routes/client-config.js'
import {
  clientRuntimePublicRoutes,
  clientRuntimeRoutes,
} from './routes/client-runtime.js'
import { derpRoutes } from './routes/derp.js'
import { derpmapRoutes } from './routes/derpmap.js'
import { deviceIdentityPublicRoutes } from './routes/device-identity.js'
import { devicesRoutes } from './routes/devices.js'
import { dnsSplitPublicRoutes, dnsSplitRoutes } from './routes/dns-split.js'
import { forceRouteRoutes } from './routes/force-routes.js'
import { headscalePublicRoutes, headscaleRoutes } from './routes/headscale.js'
import { healthRoutes } from './routes/health.js'
import {
  nodeAssignmentsPublicRoutes,
  nodeAssignmentsRoutes,
} from './routes/node-assignments.js'
import { telemetryPublicRoutes, telemetryRoutes } from './routes/telemetry.js'

async function main() {
  const app = Fastify({ logger: { level: 'info' } })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  // Rate limit global:false — chỉ áp cho route bật config.rateLimit (đăng nhập,
  // verify-2fa) để tránh throttle traffic API bình thường (telemetry 3s…).
  await app.register(rateLimit, { global: false })
  if (env.CORS_ORIGIN) {
    await app.register(cors, {
      origin: env.CORS_ORIGIN.split(','),
      credentials: true,
    })
  }

  // Routes
  await app.register(healthRoutes)
  await app.register(derpmapRoutes)
  await app.register(authRoutes)
  await app.register(derpRoutes)
  await app.register(headscalePublicRoutes)
  await app.register(headscaleRoutes)
  await app.register(clientPublicRoutes)
  await app.register(clientRuntimePublicRoutes)
  await app.register(clientRuntimeRoutes)
  await app.register(forceRouteRoutes)
  await app.register(nodeAssignmentsPublicRoutes)
  await app.register(nodeAssignmentsRoutes)
  await app.register(ciRoutes)
  await app.register(apikeyRoutes)
  await app.register(clientConfigRoutes)
  await app.register(dnsSplitPublicRoutes)
  await app.register(dnsSplitRoutes)
  await app.register(deviceIdentityPublicRoutes)
  await app.register(devicesRoutes)
  await app.register(telemetryPublicRoutes)
  await app.register(telemetryRoutes)

  // SPA tĩnh (prod)
  if (env.CLIENT_DIST && existsSync(env.CLIENT_DIST)) {
    const fastifyStatic = (await import('@fastify/static')).default
    await app.register(fastifyStatic, { root: env.CLIENT_DIST })
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? ''
      if (
        url.startsWith('/api') ||
        url.startsWith('/derpmap.json') ||
        url.startsWith('/healthz')
      ) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.sendFile('index.html')
    })
  }

  // DB init
  await migrate()
  const seed = await seedIfEmpty()
  app.log.info({ seed, googleEnabled }, 'db ready')

  // Tạo admin nội bộ (username/password) từ env nếu cấu hình — idempotent.
  const adminCreated = await bootstrapAdmin()
  if (adminCreated) app.log.info('admin bootstrap: created internal admin user')

  // Headscale API key: seed từ env (chỉ nếu DB chưa có), rồi bắt đầu auto-refresh 24h
  const seeded = await seedFromEnv()
  if (seeded) app.log.info('headscale apikey: seeded from env var')
  startAutoRefresh((msg) => app.log.info(msg))

  // Probe nền cho các node đang "khóa cứng 1 DERP" — quyết định exclusive vs
  // fallback (van an toàn 10 phút), tách khỏi request GET /api/internal/derp-map.
  startDerpNodeHealthSweep()

  await app.listen({ host: '0.0.0.0', port: env.PORT })
  app.log.info(`DERP backend :${env.PORT} (public: ${env.PUBLIC_URL})`)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
