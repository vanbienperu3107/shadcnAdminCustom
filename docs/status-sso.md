# Nút "Status" — SSO từ CMS sang Beszel (status.hangocthanh.io.vn)

## Luồng

```
Trình duyệt ──(cookie derp_session, domain .hangocthanh.io.vn)──> status.hangocthanh.io.vn
  memory-caddy:
    1. request_header -X-Auth-Email          # xoá header client tự gửi (chống giả mạo)
    2. forward_auth derp-backend:8787 /api/auth/forward
         200 + X-Auth-Email: $BESZEL_SSO_EMAIL -> chép header, đi tiếp
         401/404                               -> redirect cms.../app/sign-in
    3. reverse_proxy beszel:8090             # Beszel tin TRUSTED_AUTH_HEADER=X-Auth-Email
```

- Nút nằm góc phải tiêu đề trang **Overview** (`src/features/overview/index.tsx`), mở tab mới.
- `/api/auth/forward` (`server/src/routes/auth.ts`) chỉ trả 200 cho phiên đầy đủ
  (không pending 2FA, chưa hết hạn). KHÔNG theo `AUTH_OPTIONAL`.
- Beszel **không tự tạo user** từ trusted header ⇒ `BESZEL_SSO_EMAIL` phải là user
  đã có trong Beszel (mặc định `admin@hangocthanh.io.vn`, do `beszel/bootstrap.py` tạo).

## Cấu hình

| Nơi | Biến / file |
|---|---|
| `deploy/dashboard-vn/docker-compose.yml` | `COOKIE_DOMAIN=.hangocthanh.io.vn`, `BESZEL_SSO_EMAIL=admin@hangocthanh.io.vn` |
| deployHeadscale `beszel/docker-compose.yml` | `TRUSTED_AUTH_HEADER=X-Auth-Email` |
| deployHeadscale `beszel/caddy_block.py` | block Caddy `status.*` (workflow `deploy-beszel.yml` ghi đè giữ inode) |

Đổi `COOKIE_DOMAIN` ⇒ mọi người đăng nhập CMS lại một lần.

## Rollback

1. Xoá 2 biến `COOKIE_DOMAIN`, `BESZEL_SSO_EMAIL` ⇒ deploy dashboard-vn (route trả 404 ⇒ Caddy chuyển về trang đăng nhập CMS).
2. Khôi phục Caddyfile từ `/home/thanh/memory-stack/Caddyfile.bak-beszel-*` bằng `cat bak > Caddyfile` rồi `caddy reload` (hoặc `docker restart memory-caddy`).
3. Xoá `TRUSTED_AUTH_HEADER` khỏi compose Beszel ⇒ `docker compose up -d`. Đăng nhập Beszel bằng mật khẩu như cũ (`/root/beszel-admin.txt`).

## Chuyển sang server mới

- Beszel + memory-caddy + derp-backend phải chung mạng docker (`memory-stack_memnet`) để Caddy gọi được `derp-backend:8787`.
- Chạy `deploy-beszel.yml` trên server mới: nó tạo user Beszel và ghi block Caddy `status.*`.
- Nếu đổi domain gốc: sửa `COOKIE_DOMAIN`, host trong `caddy_block.py`, link nút ở Dashboard và URL redirect sign-in.
- Cổng `127.0.0.1:8090` của Beszel nhận header trực tiếp — không bao giờ publish ra `0.0.0.0`.
