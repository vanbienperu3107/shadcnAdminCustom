# pgweb — quản trị Postgres vpn6 (sql.hangocthanh.io.vn)

Web UI [pgweb](https://github.com/sosedoff/pgweb) quản trị Postgres nội bộ `derp-postgres` trên **vpn6 (45.119.87.220)**, cả 2 DB `derp` + `headscale`, quyền **superuser**, phơi qua **`sql.hangocthanh.io.vn`** sau **Google login (oauth2-proxy)** + lớp phụ **basic-auth pgweb**.

Plan đầy đủ (đã qua 3 lớp review + validate thật): `docs/plan-pgweb-vpn6.md`.

> ⚠️ **Rủi ro**: public + superuser = ai vượt được auth có toàn quyền instance (RCE qua `COPY TO PROGRAM`, đọc password hash, sửa/xoá `headscale.nodes` → sập fleet). Đã bù bằng 2 lớp auth + backup bắt buộc. Cân nhắc hạ role DML non-superuser nếu muốn an toàn hơn.

## Thành phần
- `docker-compose.yml` — 3 container: `pgweb-oauth2`, `pgweb-derp` (`--prefix derp`), `pgweb-headscale` (`--prefix headscale`). Join network external `memory-stack_memnet` + `dashboard-vn_dashnet`. Compose RIÊNG `/opt/pgweb`, không đụng `/opt/dashboard-vn`.
- `sql.caddy` — site block append vào `/home/thanh/memory-stack/Caddyfile` (forward_auth Google → route `/derp` | `/headscale`).
- `emails.txt.example` — mẫu allowlist (file thật do workflow ghi từ secret, đã `.gitignore`).

## Bước thủ công TRƯỚC khi deploy
1. **Google OAuth client**: thêm Authorized redirect URI `https://sql.hangocthanh.io.vn/oauth2/callback`.
2. **DNS**: tạo bản ghi A `sql.hangocthanh.io.vn → 45.119.87.220` (TTL 300) tại longvan.vn. Chờ propagate (Caddy cần HTTP-01 cổng 80).
3. **Backup** (bắt buộc, vì bật ghi superuser): trên vpn6
   ```bash
   TS=$(date +%F-%H%M)
   for DB in derp headscale; do docker exec derp-postgres pg_dump -U derp -d "$DB" | gzip > /opt/backups-derp-vn/pre-pgweb-$DB-$TS.sql.gz; done
   ```
   Mở rộng cron `/opt/dashboard-vn/backup-db.sh` để thêm DB `headscale`.
4. **GitHub Secrets** (repo shadcnAdminCustom):
   | Secret | Vai trò |
   |---|---|
   | `PGWEB_ALLOWED_EMAILS` | email được phép (phẩy hoặc xuống dòng) |
   | `PGWEB_BASIC_USER` | user lớp 2 (basic-auth) |
   | `PGWEB_BASIC_PASS` | mật khẩu lớp 2 |
   | `SSH_HOST_VPN6`/`SSH_USER_VPN6`/`SSH_KEY_VPN6`/`SSH_PORT_VPN6` | (đã có) |
   | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` | (đã có, dùng chung) |

   `DERP_PG_PASSWORD` **không** đưa lên Secret — workflow đọc từ `/opt/dashboard-vn/.env`. Cookie secret oauth2-proxy sinh/giữ trên server.

## Deploy
```
Actions → "Deploy pgweb (vpn6)" → Run workflow (workflow_dispatch)
```
Workflow: scp compose+caddy → ghi `.env`/`emails.txt` → `docker compose up` → append+validate+reload Caddy → health.

## Nghiệm thu
- `curl https://sql.hangocthanh.io.vn/derp/` (ẩn danh) → **302 → /oauth2/start** (nếu 200 = lỗi bypass auth).
- Đăng nhập email allowlist → basic-auth → thấy DB `derp`; `/headscale/` thấy DB `headscale`.
- Asset (`static/js/app.js`) trả 200 dưới `/derp/`.

## Rollback
- Caddy: khôi phục backup mới nhất `Caddyfile.bak.<ts>` (`ls -t | head -1`) + `caddy reload`.
- Container: `docker compose -f /opt/pgweb/docker-compose.yml down`.
- Dữ liệu (lỡ tay): restore từ `/opt/backups-derp-vn/pre-pgweb-*.sql.gz`.

## Chuyển sang server mới
1. Server mới có stack `dashboard-vn` (Postgres + `dashboard-vn_dashnet`) + `memory-stack_memnet` + `memory-caddy`.
2. Trỏ DNS A `sql → IP mới`; đổi `SSH_*_VPN6` sang server mới.
3. Chạy lại workflow (đọc `DERP_PG_PASSWORD` từ `.env` server mới, sinh lại cookie secret). Redirect URI Google theo domain → không đổi.
4. Chuyển lịch backup 2 DB sang server mới.
