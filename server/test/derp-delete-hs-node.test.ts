/**
 * Xoá 1 DERP server trong CMS phải kéo theo node tailnet của sidecar chạy trên
 * chính host đó. Bỏ bước này thì máy đã gỡ vẫn để lại đăng ký node sống mãi
 * trong headscale — không cơ chế nào dọn (node.expiry=0, không ephemeral,
 * node-dedup chỉ gom node TRÙNG hostname) và nó ôm luôn IP tailnet không trả
 * lại. Đó chính là ca vpn3/region 1000 để lại node id 21 giữ 100.64.0.2.
 *
 * Phần thuần (nodeIdsByNodeKey) test trực tiếp; phần gọi mạng
 * (deleteHsNodeByNodeKey) test qua mock hsApi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hsApi = vi.fn()
const isHsConfigured = vi.fn()
const isHsNotFound = vi.fn(
  (e: unknown) =>
    e instanceof Error && (e as Error & { status?: number }).status === 404
)

vi.mock('../src/lib/headscale.js', () => ({
  hsApi: (...a: unknown[]) => hsApi(...a),
  isHsConfigured: (...a: unknown[]) => isHsConfigured(...a),
  isHsNotFound: (e: unknown) => isHsNotFound(e),
}))

// db/client.ts mở kết nối Postgres thật lúc import — stub để test chạy offline.
vi.mock('../src/db/client.js', () => ({ db: {}, queryClient: {} }))

const { nodeIdsByNodeKey, deleteHsNodeByNodeKey } = await import(
  '../src/lib/device-registry'
)

const KEY = 'nodekey:c8eb536e11409c3250e83836765f8e90e3ddcfb979c34eda2089fcfc94654957'
const HEX = 'c8eb536e11409c3250e83836765f8e90e3ddcfb979c34eda2089fcfc94654957'

function hsErr(status: number): Error {
  const e = new Error(`headscale ${status}`) as Error & { status: number }
  e.status = status
  return e
}

describe('nodeIdsByNodeKey', () => {
  it('khớp đúng node theo nodeKey', () => {
    const nodes = [
      { id: '18', nodeKey: 'nodekey:aaaa' },
      { id: '21', nodeKey: KEY },
      { id: '22', nodeKey: 'nodekey:bbbb' },
    ]
    expect(nodeIdsByNodeKey(KEY, nodes)).toEqual(['21'])
  })

  it('ts_node_key dán dạng hex trần (không tiền tố) vẫn khớp', () => {
    // Admin gõ tay vào form DERP thường chỉ dán phần hex — đây chính là ca
    // khiến so chuỗi thô trượt và để node mồ côi lại.
    expect(nodeIdsByNodeKey(HEX, [{ id: '21', nodeKey: KEY }])).toEqual(['21'])
  })

  it('lệch chữ hoa/thường vẫn khớp', () => {
    expect(
      nodeIdsByNodeKey(KEY.toUpperCase(), [{ id: '21', nodeKey: KEY }])
    ).toEqual(['21'])
    expect(
      nodeIdsByNodeKey(KEY, [{ id: '21', nodeKey: `NODEKEY:${HEX.toUpperCase()}` }])
    ).toEqual(['21'])
  })

  it('khoảng trắng thừa vẫn khớp', () => {
    expect(nodeIdsByNodeKey(`  ${KEY}  `, [{ id: '21', nodeKey: KEY }])).toEqual(['21'])
  })

  it('không khớp → rỗng (KHÔNG được xoá nhầm node khác)', () => {
    expect(nodeIdsByNodeKey(KEY, [{ id: '18', nodeKey: 'nodekey:aaaa' }])).toEqual([])
  })

  it('nodeKey rỗng/null → rỗng (không quét bừa toàn bộ node)', () => {
    const nodes = [{ id: '21', nodeKey: KEY }]
    expect(nodeIdsByNodeKey(null, nodes)).toEqual([])
    expect(nodeIdsByNodeKey(undefined, nodes)).toEqual([])
    expect(nodeIdsByNodeKey('', nodes)).toEqual([])
    expect(nodeIdsByNodeKey('   ', nodes)).toEqual([])
  })

  it('node thiếu id thì bỏ qua, không ném lỗi', () => {
    expect(nodeIdsByNodeKey(KEY, [{ nodeKey: KEY }, { id: '21', nodeKey: KEY }])).toEqual([
      '21',
    ])
  })

  it('nhiều node cùng nodeKey → trả hết', () => {
    expect(
      nodeIdsByNodeKey(KEY, [
        { id: '21', nodeKey: KEY },
        { id: '99', nodeKey: HEX },
      ])
    ).toEqual(['21', '99'])
  })
})

describe('deleteHsNodeByNodeKey', () => {
  beforeEach(() => {
    hsApi.mockReset()
    isHsConfigured.mockReset()
    isHsConfigured.mockResolvedValue(true)
  })

  it('tìm thấy node → gọi DELETE đúng id và trả id đã xoá', async () => {
    hsApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/node') {
        return { nodes: [{ id: '18', nodeKey: 'nodekey:aaaa' }, { id: '21', nodeKey: KEY }] }
      }
      return {}
    })

    await expect(deleteHsNodeByNodeKey(KEY)).resolves.toEqual(['21'])
    expect(hsApi).toHaveBeenCalledWith('/api/v1/node/21', { method: 'DELETE' })
    // KHÔNG được đụng node 18
    expect(hsApi).not.toHaveBeenCalledWith('/api/v1/node/18', { method: 'DELETE' })
  })

  it('không tìm thấy node → trả [] và KHÔNG ném (idempotent)', async () => {
    hsApi.mockResolvedValue({ nodes: [{ id: '18', nodeKey: 'nodekey:aaaa' }] })
    await expect(deleteHsNodeByNodeKey(KEY)).resolves.toEqual([])
    expect(hsApi).toHaveBeenCalledTimes(1) // chỉ list, không DELETE
  })

  it('node biến mất giữa chừng (404 lúc DELETE) → bỏ qua, không ném', async () => {
    hsApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/node') return { nodes: [{ id: '21', nodeKey: KEY }] }
      throw hsErr(404)
    })
    await expect(deleteHsNodeByNodeKey(KEY)).resolves.toEqual([])
  })

  it('headscale lỗi thật (500) → NÉM để nơi gọi chặn việc xoá DERP server', async () => {
    hsApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/node') return { nodes: [{ id: '21', nodeKey: KEY }] }
      throw hsErr(500)
    })
    await expect(deleteHsNodeByNodeKey(KEY)).rejects.toThrow('headscale 500')
  })

  it('list node lỗi → NÉM (không được im lặng coi như xoá xong)', async () => {
    hsApi.mockRejectedValue(hsErr(502))
    await expect(deleteHsNodeByNodeKey(KEY)).rejects.toThrow('headscale 502')
  })

  it('headscale chưa cấu hình → NÉM (không âm thầm bỏ qua)', async () => {
    isHsConfigured.mockResolvedValue(false)
    await expect(deleteHsNodeByNodeKey(KEY)).rejects.toThrow('headscale_not_configured')
    expect(hsApi).not.toHaveBeenCalled()
  })

  it('nodeKey rỗng → trả [] ngay, không gọi headscale', async () => {
    await expect(deleteHsNodeByNodeKey(null)).resolves.toEqual([])
    await expect(deleteHsNodeByNodeKey('')).resolves.toEqual([])
    expect(isHsConfigured).not.toHaveBeenCalled()
    expect(hsApi).not.toHaveBeenCalled()
  })

  it('nhiều node trùng key → xoá hết', async () => {
    hsApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/node') {
        return { nodes: [{ id: '21', nodeKey: KEY }, { id: '99', nodeKey: HEX }] }
      }
      return {}
    })
    await expect(deleteHsNodeByNodeKey(KEY)).resolves.toEqual(['21', '99'])
  })
})
