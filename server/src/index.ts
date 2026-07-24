import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { migrate } from './db/migrate.js'
import { seedIfEmpty } from './db/seed.js'
import { env, googleEnabled } from './env.js'
import { bootstrapAdmin } from './lib/admin-bootstrap.js'
import { seedFromEnv, startAutoRefresh } from './lib/apikey-manager.js'
import { backfillDevices } from './lib/device-backfill.js'
import { startDerpNodeHealthSweep } from './lib/derp-node-health.js'
import { apikeyRoutes } from './routes/apikey.js'
import { authRoutes } from './routes/auth.js'
import { ciRoutes } from './routes/ci.js'
import {
  clientConfigRoutes,
  clientPublicRoutes,
} from './routes/client-config.js'
import {
  clientUpdatePublicRoutes,
  clientUpdateRoutes,
} from './routes/client-update.js'
import {
  clientRuntimePublicRoutes,
  clientRuntimeRoutes,
} from './routes/client-runtime.js'
import { derpRoutes } from './routes/derp.js'
import { derpmapRoutes } from './routes/derpmap.js'
import { deviceIdentityPublicRoutes } from './routes/device-identity.js'
import { devicesRoutes } from './routes/devices.js'
import {
  enrollmentPublicRoutes,
  enrollmentRoutes,
} from './routes/enrollment.js'
import { dnsSplitPublicRoutes, dnsSplitRoutes } from './routes/dns-split.js'
import {
  folderSharesPublicRoutes,
  folderSharesRoutes,
} from './routes/folder-shares.js'
import { forceRouteRoutes } from './routes/force-routes.js'
import { headscalePublicRoutes, headscaleRoutes } from './routes/headscale.js'
import { healthRoutes } from './routes/health.js'
import {
  nodeAssignmentsPublicRoutes,
  nodeAssignmentsRoutes,
} from './routes/node-assignments.js'
import { telemetryPublicRoutes, telemetryRoutes } from './routes/telemetry.js'
import { vpnAgentPublicRoutes, vpnRoutes } from './routes/vpn.js'

/**
 * Trạng thái sẵn sàng của DB (xem docs/rca-2026-07-18-dashboard-outage.md gốc D).
 * dbReady=false ⇒ /api/* trả 503 kèm dbLastError, nhưng tiến trình VẪN SỐNG:
 * /healthz, log và file tĩnh còn dùng được để chẩn đoán.
 */
let dbReady = false
let dbLastError: string | null = null

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

  // DB chưa sẵn sàng -> trả 503 CÓ LÝ DO, thay vì để từng route ném lỗi 500 khó
  // hiểu. Đặt TRƯỚC khi đăng ký route: Fastify dựng chuỗi hook lúc đăng ký route,
  // hook thêm sau sẽ không áp cho route đã đăng ký.
  // /healthz được cho qua — nó tự kiểm tra DB và trả {db:'down'}, là công cụ chẩn
  // đoán chính khi sự cố. File tĩnh (SPA) cũng cho qua để còn vào được giao diện.
  app.addHook('onRequest', async (req, reply) => {
    if (dbReady) return
    if (req.url.startsWith('/healthz') || !req.url.startsWith('/api/')) return
    return reply.code(503).send({
      error: 'db_unavailable',
      detail: dbLastError ?? 'database is initialising',
    })
  })

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
  await app.register(folderSharesPublicRoutes)
  await app.register(folderSharesRoutes)
  await app.register(ciRoutes)
  await app.register(apikeyRoutes)
  await app.register(clientConfigRoutes)
  await app.register(dnsSplitPublicRoutes)
  await app.register(dnsSplitRoutes)
  await app.register(deviceIdentityPublicRoutes)
  await app.register(devicesRoutes)
  await app.register(enrollmentPublicRoutes)
  await app.register(enrollmentRoutes)
  await app.register(telemetryPublicRoutes)
  await app.register(telemetryRoutes)
  await app.register(clientUpdatePublicRoutes)
  await app.register(clientUpdateRoutes)
  await app.register(vpnAgentPublicRoutes)
  await app.register(vpnRoutes)

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

  // ★ LẮNG NGHE TRƯỚC, KHỞI TẠO DB SAU — xem docs/rca-2026-07-18-dashboard-outage.md
  // (gốc D). Trước đây migrate() nằm trong đường boot: DB hỏng ⇒ throw ⇒
  // process.exit(1) ⇒ container crash-loop ⇒ MẤT LUÔN /healthz và log, đúng lúc
  // cần chẩn đoán nhất (sự cố 2026-07-18: 28 vòng restart, không đọc được gì).
  // Nay app luôn boot; DB khởi tạo nền và tự thử lại tới khi được.
  await app.listen({ host: '0.0.0.0', port: env.PORT })
  app.log.info(`DERP backend :${env.PORT} (public: ${env.PUBLIC_URL})`)

  void initDbWithRetry(app)
}

/**
 * Khởi tạo DB ở nền, thử lại vô hạn với backoff. KHÔNG ném lỗi ra ngoài — mọi
 * thất bại chỉ ghi log và hẹn lần sau, để tiến trình sống và còn chẩn đoán được.
 * Thành công thì bật cờ dbReady, các route /api/* hết bị chặn 503.
 */
async function initDbWithRetry(app: FastifyInstance): Promise<void> {
  let delay = 5_000
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate()
      const seed = await seedIfEmpty()
      app.log.info({ seed, googleEnabled }, 'db ready')

      // Định danh thiết bị theo salt (plan device_id): backfill device_enrollment →
      // device/device_mac. Best-effort, non-throwing, idempotent — bỏ qua nếu PEPPER
      // chưa cấu hình. Chạy sau migrate() để bảng đã tồn tại.
      await backfillDevices((msg) => app.log.info(msg))

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

      dbReady = true
      dbLastError = null
      app.log.info({ attempt }, 'db init hoan tat — /api/* da mo')
      return
    } catch (err) {
      dbLastError = err instanceof Error ? err.message : String(err)
      app.log.error(
        { err: dbLastError, attempt, retryInMs: delay },
        'db init that bai — server VAN CHAY, se thu lai'
      )
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 60_000) // trần 1 phút
    }
  }
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
