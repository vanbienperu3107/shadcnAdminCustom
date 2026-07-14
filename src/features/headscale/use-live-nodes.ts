import { useQuery } from '@tanstack/react-query'
import { fetchLiveDevices, type HsMachine, type LiveDevice } from './hs-api'

/**
 * NGUỒN "online" DUY NHẤT ở frontend. Trước đây logic hợp nhất
 * (telemetry OR headscale) bị copy rời rạc: Overview + Machines dùng
 * /api/devices/live, còn tab Latency lỡ đọc cờ headscale thô `!!n.online` →
 * hai màn hình mâu thuẫn (máy telemetry tươi nhưng cờ map-poll flap = false thì
 * Latency báo "offline" sai). Gom về 1 hook để không tái diễn drift.
 *
 * "online" ở đây khớp NGUYÊN SI resolveDeviceLiveState phía server
 * (server/src/lib/device-registry.ts): online = reporting(telemetry tươi) OR
 * headscaleOnline. `/api/devices/live` đã tính sẵn `online`/`reporting`, hook
 * chỉ join theo nodeKey và fallback cờ headscale thô khi máy chưa có dòng
 * device_identity (chưa backfill / node hạ tầng DERP không thuộc endpoint).
 */
export const liveDevicesKeys = {
  all: ['devices', 'live'] as const,
}

/** nodeKey chuẩn hoá để join an toàn: device_identity lưu lowercase+prefix,
 *  còn /api/machines trả THÔ. Hiện headscale trả lowercase nên tình cờ khớp;
 *  hạ chữ thường 2 phía là belt-and-suspenders (bài học nodeKey-format-asymmetry). */
function normKey(k: string | null | undefined): string {
  return (k ?? '').toLowerCase().trim()
}

/**
 * Quyết định online THUẦN (không I/O) — tách để unit-test khớp ma trận của
 * resolveDeviceLiveState. `live` = dòng /api/devices/live (đã hợp nhất) nếu có;
 * `headscaleOnline` = cờ thô từ /api/machines dùng làm fallback khi CHƯA có dòng
 * live. Có dòng live thì live.online THẮNG (kể cả false) — nó đã là kết quả hợp
 * nhất; fallback chỉ áp dụng khi thiếu dữ liệu.
 */
export function pickNodeOnline(
  live: Pick<LiveDevice, 'online'> | undefined,
  headscaleOnline: boolean | undefined
): boolean {
  return live?.online ?? headscaleOnline ?? false
}

/** Client còn tự báo telemetry gần đây? Thiếu dòng live → coi như đang báo cáo
 *  (true) để không gắn cờ "reporter hỏng" nhầm cho máy chưa có device_identity. */
export function pickNodeReporting(
  live: Pick<LiveDevice, 'reporting'> | undefined
): boolean {
  return live?.reporting ?? true
}

/**
 * Trạng thái sống của node theo nguồn hợp nhất /api/devices/live.
 *
 * @param poll  true = tự đặt refetchInterval 30s. BẮT BUỘC bật ở trang/tab đứng
 *   MỘT MÌNH (vd tab Latency là leaf render độc lập trong MachinesSection — không
 *   observer nào khác giữ timer cho ['devices','live']). Nếu để false ở đó, query
 *   fetch 1 lần rồi đóng băng → cột Online kẹt trạng thái cũ. Nơi đã có owner
 *   polling riêng thì để mặc định false, react-query dedupe theo key.
 */
export function useNodeLiveState({ poll = false }: { poll?: boolean } = {}) {
  const liveQuery = useQuery({
    queryKey: liveDevicesKeys.all,
    queryFn: fetchLiveDevices,
    staleTime: 30_000,
    refetchInterval: poll ? 30_000 : undefined,
  })
  const liveByNodeKey = new Map<string, LiveDevice>(
    (liveQuery.data ?? [])
      .filter((d) => d.nodeKey)
      .map((d) => [normKey(d.nodeKey), d])
  )
  const liveOf = (n: HsMachine): LiveDevice | undefined =>
    liveByNodeKey.get(normKey(n.nodeKey))
  const isNodeOnline = (n: HsMachine): boolean =>
    pickNodeOnline(liveOf(n), n.online)
  const isNodeReporting = (n: HsMachine): boolean =>
    pickNodeReporting(liveOf(n))

  // Trả LUÔN liveQuery để nơi gọi (useRealNodes) giữ NGUYÊN công thức isFetching
  // cũ (có gộp trạng thái refetch nền của /api/devices/live) — nếu nuốt mất, chấm
  // "đang cập nhật" trên Overview sẽ hỏng âm thầm mà TypeScript không bắt.
  return { liveByNodeKey, liveOf, isNodeOnline, isNodeReporting, liveQuery }
}
