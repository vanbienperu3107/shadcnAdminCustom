import type { FastifyReply, FastifyRequest } from 'fastify'
import { authOptional } from '../env.js'
import { getSessionUser, type SessionUser } from './session.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
  }
}

export const DEV_USER: SessionUser = {
  id: 0,
  email: 'dev@local',
  name: 'Dev (AUTH_OPTIONAL)',
  picture: null,
}

/** preHandler: chặn nếu chưa đăng nhập (401). Gắn req.user nếu hợp lệ. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await getSessionUser(req)
  if (!user) {
    if (authOptional) {
      req.user = DEV_USER
      return
    }
    reply.code(401).send({ error: 'unauthorized' })
    return
  }
  req.user = user
}
