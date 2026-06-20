import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { env, googleEnabled } from './env.js'
import { migrate } from './db/migrate.js'
import { seedIfEmpty } from './db/seed.js'
import { authRoutes } from './routes/auth.js'
import { derpRoutes } from './routes/derp.js'
import { derpmapRoutes } from './routes/derpmap.js'
import { headscaleRoutes } from './routes/headscale.js'
import { healthRoutes } from './routes/health.js'

async function main() {
  const app = Fastify({ logger: { level: 'info' } })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  if (env.CORS_ORIGIN) {
    await app.register(cors, { origin: env.CORS_ORIGIN.split(','), credentials: true })
  }

  // Routes
  await app.register(healthRoutes)
  await app.register(derpmapRoutes)
  await app.register(authRoutes)
  await app.register(derpRoutes)
  await app.register(headscaleRoutes)

  // Phục vụ SPA tĩnh (prod) nếu có CLIENT_DIST — fallback về index.html cho client-routing.
  if (env.CLIENT_DIST && existsSync(env.CLIENT_DIST)) {
    const fastifyStatic = (await import('@fastify/static')).default
    await app.register(fastifyStatic, { root: env.CLIENT_DIST })
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? ''
      if (url.startsWith('/api') || url.startsWith('/derpmap.json') || url.startsWith('/healthz')) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.sendFile('index.html')
    })
  }

  // DB init
  await migrate()
  const seed = await seedIfEmpty()
  app.log.info({ seed, googleEnabled }, 'db ready')

  await app.listen({ host: '0.0.0.0', port: env.PORT })
  app.log.info(`DERP backend listening on :${env.PORT} (public: ${env.PUBLIC_URL})`)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
