#!/usr/bin/env bash
# Don rac dinh ky cho DB dashboard (derp) tren vpn6.
#
# Vi sao can: cac bang telemetry (latency, home-DERP, DERP-ping) va cac ban ghi
# thiet bi "nua voi" tich tu mai. Vi du da quan sat duoc: 6 dong device_identity
# cua CUNG mot may VOTAM-PC vi MAC doi (card ao/bridge), va 8 dong
# device_enrollment cho 6 MAC khac nhau cua cung may do.
#
# Nguyen tac an toan (doc ky truoc khi noi long):
#   1. CHI xoa du lieu DIEN BIEN (telemetry, log, yeu cau) va ban ghi thiet bi
#      CHUA TUNG dang ky. KHONG bao gio dung toi:
#        - device_identity co node_key (da tung dang ky that) hoac co mac,
#        - dong device_type='derp_infra' (vpn4-vn-1 / vpn6-vn-1 — ha tang DERP),
#        - dong co static_ipv4 do admin ghim (tru khi vo danh hoan toan).
#   2. device_enrollment dung LAST_ENROLL_AT (lan dung gan nhat), KHONG dung
#      created_at: may van dang dung thi khong bao gio bi xoa du dang ky tu lau.
#   3. Luon dump ra file TRUOC khi xoa (giu 30 ban), de con duong lui.
#   4. DRY_RUN=1 chi dem, khong xoa. Lan chay dau tien nen dung che do nay.
#
# Dung:
#   RETENTION_DAYS=7 DRY_RUN=1 ./retention-cleanup.sh    # xem truoc
#   ./retention-cleanup.sh                               # chay that
set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-7}"
DRY_RUN="${DRY_RUN:-0}"
PG_CT="${PG_CT:-derp-postgres}"
PG_USER="${PG_USER:-derp}"
PG_DB="${PG_DB:-derp}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups-retention}"
KEEP_BACKUPS="${KEEP_BACKUPS:-30}"

log() { echo "$(date -Is) $*"; }
psql_c() { docker exec "$PG_CT" psql -U "$PG_USER" -d "$PG_DB" -tAc "$1"; }

# --- Dieu kien xoa, khai bao mot cho de doc va sua ------------------------------
# Moi dong: <ten bang>|<menh de WHERE>
# Ghi chu tung dong o ngay duoi, dung tach ra cho khac.
CUTOFF="now() - interval '${RETENTION_DAYS} days'"
RULES=$(cat <<RULES
latency_samples|reported_at < ${CUTOFF}
client_home_derp|reported_at < ${CUTOFF}
client_derp_ping|reported_at < ${CUTOFF}
folder_browse|requested_at < ${CUTOFF}
device_key_audit|at < ${CUTOFF}
node_reload_requests|requested_at < ${CUTOFF}
node_update_requests|requested_at < ${CUTOFF}
device_enrollment|coalesce(last_enroll_at, created_at) < ${CUTOFF}
device_identity|device_type = 'client' AND node_key IS NULL AND mac IS NULL AND updated_at < ${CUTOFF}
RULES
)
# latency_samples / client_home_derp / client_derp_ping: telemetry thuan tuy,
#   may online se ghi lai trong vai giay -> xoa la vo hai.
# folder_browse, node_*_requests: hang doi yeu cau, xu ly xong thi thanh rac.
# device_key_audit: nhat ky, giu 7 ngay theo yeu cau.
# device_enrollment: xem nguyen tac (2). May con dung -> last_enroll_at moi -> giu.
# device_identity: CHI dong vo danh (khong mac, khong node_key) — dung nghia
#   "chua tung register". Dong co mac/node_key la thiet bi that, khong dung toi.

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
TOTAL=0

log "=== retention-cleanup: giu ${RETENTION_DAYS} ngay, DRY_RUN=${DRY_RUN} ==="

while IFS='|' read -r TABLE WHERE; do
  [ -n "${TABLE:-}" ] || continue
  N=$(psql_c "select count(*) from ${TABLE} where ${WHERE}" | tr -d '[:space:]')
  N=${N:-0}
  if [ "$N" = "0" ]; then
    log "  ${TABLE}: khong co dong nao qua han"
    continue
  fi
  TOTAL=$((TOTAL + N))
  if [ "$DRY_RUN" = "1" ]; then
    log "  ${TABLE}: SE xoa ${N} dong (dry-run)"
    continue
  fi
  # Dump truoc khi xoa — con duong lui neu dieu kien viet sai.
  docker exec "$PG_CT" psql -U "$PG_USER" -d "$PG_DB" \
    -c "\\copy (select * from ${TABLE} where ${WHERE}) to stdout with csv header" \
    > "${BACKUP_DIR}/${STAMP}-${TABLE}.csv" 2>/dev/null || true
  psql_c "delete from ${TABLE} where ${WHERE}" >/dev/null
  log "  ${TABLE}: da xoa ${N} dong (dump: ${STAMP}-${TABLE}.csv)"
done <<< "$RULES"

# Don dump cu, giu KEEP_BACKUPS moc thoi gian gan nhat.
if [ "$DRY_RUN" != "1" ]; then
  ls -1 "$BACKUP_DIR" 2>/dev/null | sed 's/-[a-z_]*\.csv$//' | sort -u | head -n -"$KEEP_BACKUPS" \
    | while read -r old; do rm -f "${BACKUP_DIR}/${old}"-*.csv; done || true
fi

log "=== xong: ${TOTAL} dong ${DRY_RUN:+(dry-run)} ==="
