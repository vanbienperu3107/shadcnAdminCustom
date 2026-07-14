import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { listDerp } from '@/features/derp/data/derp-api'
import {
  type Device,
  fetchDevices,
  fetchLatency,
  fetchLiveDevices,
  fetchMachines,
  type HsMachine,
  type LiveDevice,
} from '@/features/headscale/hs-api'
import { Latency } from './index'

// Latency tự gọi 5 query (mac/lat/derp/devices + hook /api/devices/live). Mock
// riêng các hàm FETCH, GIỮ NGUYÊN hàm thuần (derpNameSet/isDerpNodeV2/userName…)
// để component phân loại client vs infra như thật.
vi.mock('@/features/headscale/hs-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/headscale/hs-api')>()
  return {
    ...actual,
    fetchMachines: vi.fn(),
    fetchLatency: vi.fn(),
    fetchDevices: vi.fn(),
    fetchLiveDevices: vi.fn(),
  }
})

vi.mock('@/features/derp/data/derp-api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/derp/data/derp-api')>()
  return { ...actual, listDerp: vi.fn() }
})

function machine(over: Partial<HsMachine>): HsMachine {
  return { id: '0', name: 'n', givenName: 'n', online: false, ...over }
}

function liveDevice(over: Partial<LiveDevice>): LiveDevice {
  return {
    id: 0,
    mac: null,
    nodeKey: null,
    name: 'n',
    ip: null,
    staticIp: null,
    version: null,
    build: null,
    variant: null,
    lastSeen: null,
    online: true,
    reporting: true,
    ...over,
  }
}

function device(over: Partial<Device>): Device {
  return {
    id: 0,
    mac: null,
    nodeKey: null,
    hostname: 'n',
    managedUser: null,
    deviceType: 'client',
    lastIpv4: null,
    staticIpv4: null,
    clientVersion: null,
    clientBuild: null,
    clientVariant: null,
    updatedAt: '2026-07-13T00:00:00.000Z',
    ...over,
  }
}

function renderLatency() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Latency />
    </QueryClientProvider>
  )
}

describe('Latency — cột Online lấy từ nguồn hợp nhất /api/devices/live', () => {
  it('CA VOTAM-PC: headscale thô offline nhưng telemetry tươi → hiện ONLINE (không offline)', async () => {
    // Regression chính: trước fix Latency đọc `!!n.online` = false → báo offline
    // sai. Nay phải khớp Overview: live.online=true thắng.
    vi.mocked(fetchMachines).mockResolvedValue({
      configured: true,
      nodes: [
        machine({
          id: '24',
          name: 'votam-pc',
          givenName: 'votam-pc',
          nodeKey: 'nodekey:votam',
          ipAddresses: ['100.64.0.24'],
          online: false, // cờ map-poll headscale flap
        }),
      ],
    })
    vi.mocked(fetchLiveDevices).mockResolvedValue([
      liveDevice({
        id: 24,
        nodeKey: 'nodekey:votam',
        name: 'votam-pc',
        online: true,
      }),
    ])
    vi.mocked(fetchLatency).mockResolvedValue({ pairs: [] })
    vi.mocked(fetchDevices).mockResolvedValue([])
    vi.mocked(listDerp).mockResolvedValue([])

    const screen = renderLatency()

    await expect.element(screen.getByText('votam-pc')).toBeInTheDocument()
    await expect.element(screen.getByText('online')).toBeInTheDocument()
    await expect.element(screen.getByText('offline')).not.toBeInTheDocument()
  })

  it('Node hạ tầng DERP không có trong /api/devices/live → fallback cờ headscale (không đổi hành vi)', async () => {
    // Infra không thuộc /api/devices/live (chỉ trả deviceType='client'), nên
    // isNodeOnline rơi về n.online thô — đúng như tab "Hạ tầng / Collector" cũ.
    vi.mocked(fetchMachines).mockResolvedValue({
      configured: true,
      nodes: [
        machine({
          id: '4',
          name: 'vpn4',
          givenName: 'vpn4-vn',
          nodeKey: 'nodekey:vpn4',
          ipAddresses: ['100.64.0.4'],
          online: true, // cờ headscale = nguồn cho infra
        }),
      ],
    })
    // device_identity phân loại vpn4 là derp_infra → node vào tab Hạ tầng.
    vi.mocked(fetchDevices).mockResolvedValue([
      device({
        id: 4,
        nodeKey: 'nodekey:vpn4',
        hostname: 'vpn4',
        deviceType: 'derp_infra',
      }),
    ])
    vi.mocked(fetchLiveDevices).mockResolvedValue([]) // infra vắng mặt ở live
    vi.mocked(fetchLatency).mockResolvedValue({ pairs: [] })
    vi.mocked(listDerp).mockResolvedValue([])

    const screen = renderLatency()

    // Chuyển sang tab Hạ tầng / Collector rồi kiểm node infra online theo cờ thô.
    const infraTab = screen.getByRole('tab', { name: /Hạ tầng/ })
    await expect.element(infraTab).toBeInTheDocument()
    await userEvent.click(infraTab)

    await expect.element(screen.getByText('vpn4-vn')).toBeInTheDocument()
    await expect.element(screen.getByText('online')).toBeInTheDocument()
  })
})
