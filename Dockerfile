# syntax=docker/dockerfile:1
# Image gộp: build SPA (Vite) + backend (Fastify) -> 1 container phục vụ cả hai.
# Backend phục vụ /api, /derpmap.json và SPA tĩnh (CLIENT_DIST). Caddy chỉ cần
# reverse_proxy subdomain -> container này. Headscale fetch /derpmap.json nội bộ.

# ---- Frontend (Vite SPA) ----
FROM node:22-alpine AS frontend
WORKDIR /app
# Pin pnpm 9 (pnpm 10 hard-fails frozen install với ERR_PNPM_IGNORED_BUILDS do
# chặn postinstall của esbuild/@clerk). pnpm 9 chạy các script đó -> vite build ok.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Serve dưới vpn2.hangocthanh.io.vn/app: base + API base đều mang prefix /app
# (Caddy handle_path /app/* strip prefix -> backend thấy / và /api).
ENV VITE_BASE=/app/
ENV VITE_API_BASE_URL=/app/api
RUN pnpm build

# ---- Backend (TypeScript -> dist) ----
FROM node:22-alpine AS backend
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- Runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
ENV CLIENT_DIST=/app/client
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=backend /app/server/dist ./dist
COPY --from=frontend /app/dist /app/client
EXPOSE 8787
CMD ["node", "dist/index.js"]
