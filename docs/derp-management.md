# Quản lý DERP node động (DB Postgres) — Dashboard + API

Tính năng cho phép **lưu toàn bộ node DERP vào database**, **bật/tắt (ON/OFF), thêm, xóa, tạm dừng, đặt
độ ưu tiên** qua giao diện web, và **client Tailscale tự phát hiện chuyển node — KHÔNG cần reload**.

## 1. Kiến trúc

```
[Dashboard SPA] --login Google--> [derp-backend (Fastify)] --OAuth2--> [Google]
      |  TanStack Query (optimistic + invalidate, KHÔNG reload)   |
      |  PATCH/POST /api/derp/...                                 | lưu user + token
      v                                                          v
[derp-backend] <------------------------------------------> [Neon Postgres (cloud)]
      |  GET /derpmap.json (dựng từ DB)
      v
[Headscale vpn2] --derp.urls poll mỗi ~10s--> /derpmap.json --long-poll--> [Clients tự chuyển node]
```

- **derp-backend** = Node.js + Fastify, nằm trong repo này tại [`server/`](../server). Phục vụ: REST API
  `/api/*`, endpoint `/derpmap.json` (headscale fetch), và SPA tĩnh (prod).
- **DB** = Postgres trên **Neon** (cloud) — backend deploy ở đâu cũng được.
- **Headscale** dùng `derp.urls` + `auto_update_enabled: true` + `update_frequency: 10s` → tự fetch lại
  `/derpmap.json` và đẩy map mới xuống client **không restart**. Bật/tắt 1 node = thêm/bỏ node khỏi JSON.
- **Fork tailscale** (`tailscale_mod`) phát hiện node chết ~5s → tắt cứng derper thì client chuyển còn nhanh hơn.

## 2. Thành phần & file chính

| Phần | Đường dẫn |
|------|-----------|
| Backend (API + derpmap + auth) | [`server/src/`](../server/src) |
| Logic dựng derpmap (pure, có test) | [`server/src/lib/build-derpmap.ts`](../server/src/lib/build-derpmap.ts) |
| Cấp region_id không trùng (test) | [`server/src/lib/region-id.ts`](../server/src/lib/region-id.ts) |
| Google OAuth | [`server/src/auth/`](../server/src/auth) |
| Frontend feature DERP | [`src/features/derp/`](../src/features/derp) |
| Trang đăng nhập Google | [`src/features/auth/sign-in/index.tsx`](../src/features/auth/sign-in/index.tsx) |
| Image gộp SPA + backend | [`Dockerfile`](../Dockerfile) |
| Tích hợp headscale | `deployHeadscale/config/config.yaml`, `docker-compose.yml`, `Caddyfile`, `.github/workflows/deploy.yml` |

## 3. Chạy local (dev)

1. **Backend** (`server/`):
   ```bash
   cd server
   cp .env.example .env      # điền DATABASE_URL (Neon). Để AUTH_OPTIONAL=true để xem UI không cần Google
   npm install
   npm run dev               # http://localhost:8787
   ```
   Seed lần đầu tự chạy nếu trỏ `SEED_DERP_YAML` tới `deployHeadscale/config/derp.yaml` và DB rỗng.

2. **Frontend** (gốc repo):
   ```bash
   pnpm install
   pnpm dev                  # http://localhost:5173, proxy /api + /derpmap.json -> :8787
   ```
   Mở `http://localhost:5173/derp`. Với `AUTH_OPTIONAL=true`, guard cho qua (user `dev@local`).

## 4. Biến môi trường backend (xem [`server/.env.example`](../server/.env.example))

| Biến | Ý nghĩa |
|------|---------|
| `DATABASE_URL` | Connection string Postgres/Neon (`...sslmode=require`). **Bí mật — không commit.** |
| `PUBLIC_URL` | URL công khai dashboard (để dựng redirect URI Google). Prod: `https://dashboard.hangocthanh.io.vn` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Tái dùng client của oauth2-proxy/headscale |
| `SESSION_SECRET` | Bí mật cookie session (random ≥32 ký tự) |
| `ALLOWED_EMAILS` | Danh sách email được đăng nhập (phẩy ngăn cách) |
| `SEED_DERP_YAML` | Đường dẫn `derp.yaml` để seed lần đầu (tùy chọn) |
| `CLIENT_DIST` | Thư mục SPA build (prod). Image đặt sẵn `/app/client` |
| `AUTH_OPTIONAL` | CHỈ DEV: `true` = bỏ qua đăng nhập. PROD luôn `false` |

## 5. Cài đặt Google OAuth

Tái dùng Google OAuth client sẵn có (của oauth2-proxy/headscale — `OAUTH2_PROXY_CLIENT_ID/SECRET`):

1. Vào **Google Cloud Console → APIs & Services → Credentials → OAuth client**.
2. Thêm **Authorized redirect URI**:
   - Prod: `https://dashboard.hangocthanh.io.vn/api/auth/google/callback`
   - Dev (nếu test Google local): `http://localhost:8787/api/auth/google/callback`
3. Backend dùng chính `GOOGLE_CLIENT_ID/SECRET` đó. Chỉ email trong `ALLOWED_EMAILS` mới vào được.
   Token Google (access/refresh/id) được lưu bảng `sessions` trong Postgres.

## 6. Triển khai prod lên vpn2 (Docker)

> Quy tắc: **build → CI xanh → prod**. Đừng deploy khi CI chưa pass.

1. **Build image**: merge/push code lên `main` của repo shadcn-admin → workflow
   [`release-image.yml`](../.github/workflows/release-image.yml) build & đẩy
   `ghcr.io/vanbienperu3107/derp-backend:latest`. CI [`ci.yml`](../.github/workflows/ci.yml) chạy test backend
   (build-derpmap, region-id) + build frontend.
2. **Public GHCR package**: GitHub → Packages → `derp-backend` → Package settings → **Change visibility → Public**
   (để vpn2 `docker compose pull` không cần đăng nhập GHCR).
3. **GitHub Secrets cho repo deployHeadscale** (Settings → Secrets → Actions):
   - `DERP_DATABASE_URL` = connection string Neon
   - `DERP_SESSION_SECRET` = chuỗi random ≥32 ký tự
   - `DERP_ALLOWED_EMAILS` = `hangocthanh3107@gmail.com,hangocthanhperu3107@gmail.com`
   - (`OAUTH2_PROXY_CLIENT_ID/SECRET` đã có sẵn — backend tái dùng làm `GOOGLE_*`)
4. **DNS**: tạo A record `dashboard.hangocthanh.io.vn` → IP vpn2 (`165.22.12.169`).
5. **Google Console**: thêm redirect URI `https://dashboard.hangocthanh.io.vn/api/auth/google/callback`.
6. **Deploy deployHeadscale**: push lên `main` (hoặc Actions → Deploy → Run). Workflow ghi `.env`, `docker compose
   pull derp-backend`, `up -d`. Caddy tự cấp TLS cho subdomain. Headscale đọc `config.yaml` mới (đã trỏ
   `derp.urls` tới `http://derp-backend:8787/derpmap.json`).

### Kiểm tra sau deploy
```bash
docker logs --tail 30 headscale         # thấy nó fetch derpmap từ derp-backend
docker logs --tail 30 derp-backend      # "db ready", listening :8787
curl -s http://localhost:8787/derpmap.json | head   # (trên vpn2) JSON regions
```
Trên client: `tailscale debug derp-map` khớp dashboard. Tắt 1 node trên UI → trong ~10s client đổi DERP.

## 7. Cách "không reload" hoạt động & tốc độ

- Bật/tắt/xóa/tạm dừng/ưu tiên → backend đổi dòng DB → `/derpmap.json` phản ánh ngay.
- Headscale poll mỗi `update_frequency` (**10s**) → rebuild map → đẩy xuống client qua long-poll → client
  `setDERPMap` đóng region cũ, ReSTUN, chuyển. **Không restart headscale, không reload client.**
- Thêm node mới: `POST /api/derp` → UI `invalidateQueries` (bảng tự render) → headscale nhận trong ≤10s.
- Độ ưu tiên (`priority`, số nhỏ = ưu tiên cao) → map sang `HomeParams.RegionScore` (trọng số latency, không
  phải thứ tự cứng tuyệt đối).
- Region **999** (embedded vpn2) do headscale tự thêm → backend **không bao giờ cấp 999** và loại embedded khỏi
  `/derpmap.json` ⇒ không thể trùng. region_id mới luôn tự cấp trong dải 1000–1099.

## 8. Bảo mật

- `DATABASE_URL`, `GOOGLE_*`, `SESSION_SECRET` chỉ nằm trong `.env`/GitHub Secrets — **không commit** (đã gitignore).
- ⚠ **Connection string Neon đã từng dán plaintext khi trao đổi → nên ROTATE password Neon** rồi cập nhật secret.
- `/derpmap.json` public (headscale fetch không auth) — chỉ lộ hostname/IP relay vốn công khai. Các route ghi
  (`/api/derp/*`) yêu cầu session Google hợp lệ.

## 9. Di chuyển sang server mới (server migration)

Backend **không gắn chặt vpn2** (DB ở cloud Neon). Để chuyển derp-backend sang host khác:

1. Trên host mới: cài Docker, `docker compose pull derp-backend && up -d` (hoặc thêm service vào compose của
   host đó) với cùng các biến env (`DATABASE_URL`, `GOOGLE_*`, `SESSION_SECRET`, `ALLOWED_EMAILS`, `PUBLIC_URL`).
2. Trỏ DNS `dashboard...` sang IP host mới; thêm redirect URI Google nếu đổi domain (`PUBLIC_URL`).
3. Sửa `derp.urls` trong `config.yaml` của headscale nếu backend đổi địa chỉ (nếu vẫn cùng compose network thì
   giữ `http://derp-backend:8787/derpmap.json`; nếu khác host → dùng URL HTTPS công khai của backend).
4. DB giữ nguyên (Neon) → toàn bộ node DERP, user, session đi theo, không cần seed lại.
5. Nếu đổi sang Postgres khác: dump/restore Neon → cập nhật `DATABASE_URL`. Bảng tự tạo lại nếu rỗng (migrate
   idempotent) và seed từ `derp.yaml`.

## 10. Troubleshoot nhanh

| Triệu chứng | Cách xử lý |
|-------------|-----------|
| Dashboard /derp báo "Không tải được" | backend chưa chạy / sai `DATABASE_URL`. Xem `docker logs derp-backend`, `GET /healthz`. |
| Đăng nhập Google lỗi `redirect_uri_mismatch` | thêm đúng redirect URI vào Google client; khớp `PUBLIC_URL`. |
| `not_allowed` khi login | email chưa nằm trong `ALLOWED_EMAILS`. |
| Client không đổi node sau khi tắt | kiểm tra headscale có fetch được `/derp-backend:8787/derpmap.json` (cùng compose network) và `auto_update_enabled: true`. |
| `docker compose pull` lỗi GHCR | package `derp-backend` chưa Public, hoặc image chưa được CI build. |
