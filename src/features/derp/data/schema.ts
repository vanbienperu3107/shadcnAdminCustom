import { z } from 'zod'

/** Một DERP server (1 region = 1 node) trả về từ backend. */
export type DerpServer = {
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
  createdAt: string
  updatedAt: string
}

// Field số dạng chuỗi (tránh lệch input/output của z.coerce với zodResolver).
const intField = (min: number, max: number, label: string) =>
  z
    .string()
    .min(1, `${label} bắt buộc`)
    .regex(/^-?\d+$/, `${label} phải là số nguyên`)
    .refine((v) => {
      const n = Number(v)
      return Number.isInteger(n) && n >= min && n <= max
    }, `${label} trong khoảng ${min}–${max}`)

/** Form thêm/sửa node (region_id do backend tự cấp nên KHÔNG có ở đây). */
export const derpFormSchema = z.object({
  name: z.string().min(1, 'Tên region bắt buộc'),
  code: z
    .string()
    .min(1, 'Region code bắt buộc')
    .regex(/^[a-z0-9-]+$/, 'Chỉ chữ thường, số và dấu -'),
  nodeName: z
    .string()
    .min(1, 'Tên node bắt buộc')
    .regex(/^[a-z0-9-]+$/, 'Chỉ chữ thường, số và dấu -'),
  hostname: z.string().min(1, 'Hostname bắt buộc'),
  ipv4: z
    .string()
    .refine(
      (v) => !v || v === 'none' || /^(\d{1,3}\.){3}\d{1,3}$/.test(v),
      'IPv4 không hợp lệ'
    ),
  derpPort: intField(1, 65535, 'DERP port'),
  stunPort: intField(-1, 65535, 'STUN port'),
  canPort80: z.boolean(),
  priority: intField(1, 1000, 'Độ ưu tiên'),
})

export type DerpFormValues = z.infer<typeof derpFormSchema>

export const DERP_FORM_DEFAULTS: DerpFormValues = {
  name: '',
  code: '',
  nodeName: '',
  hostname: '',
  ipv4: '',
  derpPort: '443',
  stunPort: '3478',
  canPort80: false,
  priority: '100',
}
