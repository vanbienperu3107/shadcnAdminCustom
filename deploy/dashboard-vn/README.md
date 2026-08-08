# deploy/dashboard-vn

Bản gốc của `/opt/dashboard-vn/docker-compose.yml` trên **vpn6** (45.119.87.220) —
stack headscale-dashboard chạy tại Việt Nam (derp-backend + Postgres 18 +
watchtower riêng scope `dashboard-vn`).

## Vì sao file này nằm trong repo

Workflow `deploy-dashboard-vn.yml` **chỉ ghi `.env`** rồi chạy `docker compose
up -d` — nó **không** đồng bộ `docker-compose.yml`. Trước 2026-08-09 file compose
chỉ tồn tại trên máy: dựng lại máy là mất, và không ai review được thay đổi.
Bản trong repo này là nguồn tham chiếu; khi sửa, copy lên `/opt/dashboard-vn/`
rồi chạy workflow `Deploy dashboard-vn (vpn6)`.

## Thay đổi 2026-08-09 — log rotation

Sự cố: file `json.log` của `derp-backend` phình **2.5 GB** (tổng
`/var/lib/docker/containers` = 3.0 GB) vì compose không đặt giới hạn log nào.
Một lệnh `docker logs` đọc hết file đó làm nghẽn I/O → derp-backend mất kết nối
Postgres (`write CONNECT_TIMEOUT postgres:5432`) khoảng 4 phút: dashboard trả
500, headscale liên tục `WRN derp/patch: dashboard call failed, using base
DERPMap`. Không container nào restart, không OOM — nên `docker ps` vẫn báo "Up".

Đã sửa:

| Thay đổi | Lý do |
|---|---|
| `logging: json-file, max-size 50m, max-file 3` cho derp-backend + postgres (10m cho watchtower) | trần 150 MB/container thay vì vô hạn |
| `log_connections=off`, `log_disconnections=off` (Postgres) | healthcheck `pg_isready` chạy 10 s/lần, mỗi lần sinh 4 dòng log rác |
| `healthcheck` cho derp-backend (`/healthz`) | trước đây container báo "Up" cả khi `/api/*` đang trả 503 vì mất DB |

Lưu ý: Docker **không** tự restart container theo healthcheck — đây là tín hiệu
quan sát, không phải cơ chế tự chữa. Việc tự phục hồi khi mất DB vẫn dựa vào
`initDbWithRetry()` phía app.
