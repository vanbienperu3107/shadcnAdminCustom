import { existsSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'

// Dev: nạp .env nếu có (prod/Docker lấy env từ compose nên không cần).
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* Node < 20.12 không có loadEnvFile — bỏ qua, dùng env hệ thống */
  }
}

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // PEPPER cho định danh thiết bị theo salt (plan device_id): salt_hmac =
  // HMAC-SHA256(salt, PEPPER). Server-side, PHẢI tách kênh backup khỏi
  // DATABASE_URL (kho lưu bí mật / CI riêng) — rò DB đơn thuần không đảo được
  // salt ⇒ không tái tạo machine key toàn fleet. Để trống = định danh theo salt
  // TẠM NGHỈ (không tính salt_hmac). KHÔNG fail-fast ở PR nền để không chặn boot;
  // đặt qua env rồi backfill tự chạy lần deploy kế (F1a-enroll sau sẽ ép bắt buộc).
  PEPPER: z.string().default(''),
  PORT: z.coerce.number().default(8787),
  PUBLIC_URL: z.string().url().default('http://localhost:8787'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SESSION_SECRET: z.string().default('dev-insecure-change-me-please-32chars'),
  ALLOWED_EMAILS: z.string().default(''),
  SEED_DERP_YAML: z.string().optional(),
  EMBEDDED_HOSTNAME: z.string().default('vpn2.hangocthanh.io.vn'),
  EMBEDDED_IPV4: z.string().default('165.22.12.169'),
  // Khoa ma hoa mat khau OpenVPN cua VPN gateway (auth_password_enc, AES-256-GCM).
  // Chuoi ngau nhien >=32 ky tu, tach kenh khoi DATABASE_URL. Trong = derive tu
  // SESSION_SECRET (chay duoc nhung kem tach kenh — nen dat rieng o prod).
  VPN_SECRET_KEY: z.string().default(''),
  // Khai bao 1 VPN gateway luc khoi dong (Phase 5, idempotent) — de agent tren
  // node bao trang thai. Trong = khong bootstrap gateway nao.
  VPN_GW_NAME: z.string().default(''),
  VPN_GW_TAILNET_IP: z.string().default(''),
  VPN_GW_PROXY_PORT: z.coerce.number().default(8888),
  VPN_GW_AGENT_TOKEN: z.string().default(''),
  // Domain di qua gateway tren (CSV) — seed vao vpn_domains de PAC route ngay.
  VPN_GW_DOMAINS: z.string().default(''),
  CORS_ORIGIN: z.string().default(''),
  CLIENT_DIST: z.string().default(''),
  // Headscale API (machines/users). Key = headscale apikey (HEADPLANE_HS_API_KEY).
  HEADSCALE_API_URL: z.string().default('http://headscale:8080'),
  HEADSCALE_API_KEY: z.string().default(''),
  // Zero-touch enrollment: MỌI pre-auth key cấp cho node phải thuộc CÙNG 1 user
  // headscale. Đổi user giữa các lần đăng ký khiến headscale tạo node MỚI cho
  // cùng machinekey (hscontrol/state/state.go:1446-1463) ⇒ trôi IP trở lại.
  HEADSCALE_NODES_USER: z.string().default('nodes'),
  // URL control server trả về cho client sau khi enroll. Để trống = client dùng
  // giá trị đã bake sẵn trong binary (nodeLoginServer).
  HEADSCALE_LOGIN_SERVER: z.string().default(''),
  // [deprecated] node-dedup collector — thay bằng POST /api/metrics/report sau Feature L.
  NODEDEDUP_URL: z.string().default('http://node-dedup:8090'),
  // Shared secret cho endpoint POST /api/metrics/report (gửi từ metrics-report.ps1).
  // Để trống = bỏ qua kiểm tra (chỉ dùng trong môi trường dev nội bộ).
  METRICS_SHARED_SECRET: z.string().default(''),
  // Secret mà headscale patch gửi kèm header X-Headscale-Secret khi gọi GET /api/internal/derp-map/:nodeKey.
  // Để trống = không kiểm tra (chỉ dùng trong dev). Cấu hình trong headscale config: derp.dashboard.secret.
  HEADSCALE_DASHBOARD_SECRET: z.string().default(''),
  // Private key SSH để quản lý firewall iptables trên DERP nodes (Feature C).
  // Nội dung PEM (bắt đầu bằng -----BEGIN ...). Trong Docker: dùng env var hoặc secret mount.
  DERP_SSH_PRIVATE_KEY: z.string().default(''),
  // GitHub Actions (tab Deploy & CI). PAT read actions; repos phẩy ngăn cách.
  GITHUB_TOKEN: z.string().default(''),
  GITHUB_REPOS: z
    .string()
    .default('vanbienperu3107/shadcnAdminCustom,vanbienperu3107/deployHeadscale'),
  // Repo chứa GitHub Release của portable client (auto-update lấy binary từ đây).
  CLIENT_RELEASE_REPO: z.string().default('vanbienperu3107/tailscale_mod'),
  // 'true' = bỏ qua đăng nhập (CHỈ dev/local để xem UI khi chưa cấu hình Google).
  AUTH_OPTIONAL: z.string().default('false'),
  // Bootstrap tài khoản admin nội bộ (username/password) lúc khởi động. Để trống
  // = không tạo. Idempotent: chỉ tạo nếu username chưa tồn tại (không ghi đè
  // mật khẩu/2FA đã đổi). Sau khi tạo xong nên xóa 2 biến này khỏi môi trường.
  ADMIN_USERNAME: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  ADMIN_EMAIL: z.string().default(''),
  NODE_ENV: z.string().default('development'),
})

export const env = schema.parse(process.env)

/** Danh sách email được phép đăng nhập, normalize lowercase. */
export const allowedEmails = env.ALLOWED_EMAILS.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export const isProd = env.NODE_ENV === 'production'
export const googleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const authOptional = env.AUTH_OPTIONAL === 'true'
