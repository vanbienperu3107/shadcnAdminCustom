# DERP backend

API quản lý node DERP (DB Postgres/Neon) + endpoint `/derpmap.json` cho Headscale + đăng nhập Google.
Tài liệu đầy đủ: [`../docs/derp-management.md`](../docs/derp-management.md).

## Chạy nhanh (dev)

```bash
cp .env.example .env     # điền DATABASE_URL (Neon); AUTH_OPTIONAL=true để xem UI không cần Google
npm install
npm run dev              # http://localhost:8787
```

## Scripts

| Lệnh | Việc |
|------|------|
| `npm run dev` | chạy dev (tsx watch) |
| `npm run build` | biên dịch TS -> `dist/` |
| `npm start` | chạy bản build (`node dist/index.js`) |
| `npm test` | unit test thuần (build-derpmap, region-id) — chạy được trong CI không cần DB |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | migrate + seed thủ công từ `SEED_DERP_YAML` |

## API

```
GET    /healthz
GET    /derpmap.json                 # headscale fetch (public, không auth)

GET    /api/auth/google/login        # bắt đầu đăng nhập Google
GET    /api/auth/google/callback     # callback (đổi code -> token, lưu DB, set cookie)
GET    /api/auth/me                  # user hiện tại (401 nếu chưa login)
POST   /api/auth/logout

GET    /api/derp                     # danh sách (cần auth)
GET    /api/derp/next-region-id      # preview region_id sẽ cấp
POST   /api/derp                     # thêm (region_id tự cấp, không trùng)
PATCH  /api/derp/:regionId           # sửa (gồm priority)
DELETE /api/derp/:regionId           # xóa
POST   /api/derp/:regionId/toggle    # { enabled?, paused? } — ON/OFF / tạm dừng
```

Bảng DB: `derp_servers` (1 region = 1 node), `users`, `sessions`. Migration idempotent chạy lúc boot.
Region 999 (embedded vpn2) read-only, không vào `/derpmap.json`.
