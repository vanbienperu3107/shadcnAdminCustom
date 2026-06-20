import type { FastifyInstance } from 'fastify'
import { env } from '../env.js'
import { requireAuth } from '../auth/middleware.js'

type Run = {
  repo: string
  name: string
  status: string
  conclusion: string | null
  headBranch: string
  event: string
  createdAt: string
  htmlUrl: string
}

type GhRun = {
  name?: string
  status?: string
  conclusion?: string | null
  head_branch?: string
  event?: string
  created_at?: string
  html_url?: string
}

/** Tab Deploy & CI — liệt kê GitHub Actions runs gần nhất của các repo. */
export async function ciRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/ci', async (_req, reply) => {
    if (!env.GITHUB_TOKEN) return { configured: false, runs: [] }
    const repos = env.GITHUB_REPOS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      const all: Run[] = []
      for (const repo of repos) {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/actions/runs?per_page=8`,
          {
            headers: {
              authorization: `Bearer ${env.GITHUB_TOKEN}`,
              accept: 'application/vnd.github+json',
              'user-agent': 'derp-dashboard',
            },
            signal: AbortSignal.timeout(8000),
          }
        )
        if (!res.ok) continue
        const d = (await res.json()) as { workflow_runs?: GhRun[] }
        for (const r of d.workflow_runs ?? []) {
          all.push({
            repo,
            name: r.name ?? '',
            status: r.status ?? '',
            conclusion: r.conclusion ?? null,
            headBranch: r.head_branch ?? '',
            event: r.event ?? '',
            createdAt: r.created_at ?? '',
            htmlUrl: r.html_url ?? '',
          })
        }
      }
      all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      return { configured: true, runs: all.slice(0, 25) }
    } catch (e) {
      return reply.code(502).send({ configured: true, error: String(e), runs: [] })
    }
  })
}
