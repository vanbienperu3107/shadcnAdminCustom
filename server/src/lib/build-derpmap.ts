/**
 * Dựng JSON `tailcfg.DERPMap` từ các dòng trong DB.
 *
 * Quy tắc:
 *  - Chỉ lấy node enabled=true, paused=false, embedded=false.
 *  - Mỗi dòng (1 region = 1 node) -> Regions[regionId] = { ...region, Nodes:[node] }.
 *  - Bỏ field mặc định (mô phỏng `omitempty` của Go): STUNPort=3478 / DERPPort=443 / bool=false / IP rỗng.
 *  - priority -> HomeParams.RegionScore (số <1 = ưu tiên hơn, >1 = bị phạt). Bỏ khi =1.
 *  - omitDefaultRegions=true (full self-host, client không fallback DERP của Tailscale).
 *
 * Field name PHẢI khớp marshaller Go: `Regions`, `RegionID`, `Nodes`, `HostName`, `IPv4`,
 * `DERPPort`, `STUNPort`, `CanPort80`, `STUNOnly`; top-level `omitDefaultRegions` (chữ thường),
 * `HomeParams.RegionScore` (key = regionId dạng string).
 */

export type DerpServerRow = {
  regionId: number
  code: string
  name: string
  nodeName: string
  hostname: string
  ipv4: string | null
  ipv6: string | null
  derpPort: number
  stunPort: number
  canPort80: boolean
  stunOnly: boolean
  latitude: number | null
  longitude: number | null
  enabled: boolean
  paused: boolean
  embedded: boolean
  priority: number
}

export type DerpNodeJson = {
  Name: string
  RegionID: number
  HostName: string
  IPv4?: string
  IPv6?: string
  DERPPort?: number
  STUNPort?: number
  CanPort80?: boolean
  STUNOnly?: boolean
}

export type DerpRegionJson = {
  RegionID: number
  RegionCode: string
  RegionName: string
  Latitude?: number
  Longitude?: number
  Nodes: DerpNodeJson[]
}

export type DerpMapJson = {
  omitDefaultRegions: boolean
  HomeParams?: { RegionScore: Record<string, number> }
  Regions: Record<string, DerpRegionJson>
}

/**
 * priority 100 = trung tính (score 1.0). Số nhỏ hơn -> ưu tiên hơn (score < 1).
 * Số lớn hơn -> bị phạt (score > 1). Clamp priority về [1, 1000].
 */
export function scoreFromPriority(priority: number): number {
  const p = Math.max(1, Math.min(1000, Math.round(priority || 100)))
  return Math.round((p / 100) * 100) / 100
}

function buildNode(r: DerpServerRow): DerpNodeJson {
  const node: DerpNodeJson = {
    Name: r.nodeName,
    RegionID: r.regionId,
    HostName: r.hostname,
  }
  if (r.ipv4) node.IPv4 = r.ipv4
  if (r.ipv6) node.IPv6 = r.ipv6
  if (r.derpPort && r.derpPort !== 443) node.DERPPort = r.derpPort
  if (r.stunPort === -1) node.STUNPort = -1
  else if (r.stunPort && r.stunPort !== 3478) node.STUNPort = r.stunPort
  if (r.canPort80) node.CanPort80 = true
  if (r.stunOnly) node.STUNOnly = true
  return node
}

export function buildDerpMap(rows: DerpServerRow[]): DerpMapJson {
  const active = rows.filter((r) => r.enabled && !r.paused && !r.embedded)
  const Regions: Record<string, DerpRegionJson> = {}
  const RegionScore: Record<string, number> = {}

  for (const r of active) {
    const region: DerpRegionJson = {
      RegionID: r.regionId,
      RegionCode: r.code,
      RegionName: r.name,
      Nodes: [buildNode(r)],
    }
    if (r.latitude != null) region.Latitude = r.latitude
    if (r.longitude != null) region.Longitude = r.longitude
    Regions[String(r.regionId)] = region

    const score = scoreFromPriority(r.priority)
    if (score !== 1) RegionScore[String(r.regionId)] = score
  }

  const map: DerpMapJson = { omitDefaultRegions: true, Regions }
  if (Object.keys(RegionScore).length > 0) map.HomeParams = { RegionScore }
  return map
}
