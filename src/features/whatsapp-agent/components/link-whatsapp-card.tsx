import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { agentKeys, fetchConnection } from '../data/agent-api'
import {
  normalizePhoneNumber,
  requestPairingCode,
  type PairingResult,
} from '../data/setup-api'

const BOX_ERROR = 'rounded-md border border-destructive/40 p-3 text-sm'
const BOX_OK = 'rounded-md border border-emerald-500/40 p-3 text-sm'
const BOX_WARN = 'rounded-md border border-amber-500/40 p-3 text-sm'
const HINT = 'text-xs text-muted-foreground'
const MUTED = 'text-sm text-muted-foreground'

/**
 * Liên kết WhatsApp bằng mã ghép nối 8 ký tự.
 *
 * Ba trạng thái hiển thị tách bạch, đúng theo vỏ bọc response của dịch vụ:
 * đang tải, có dữ liệu, và lỗi. Không gộp "lỗi" thành "chưa liên kết" —
 * người dùng phải phân biệt được "chưa cấu hình" với "đang hỏng", vì hai
 * thứ đó cần hai hành động khác nhau.
 */
export function LinkWhatsAppCard() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [pairing, setPairing] = useState<PairingResult | null>(null)

  const connection = useQuery({
    queryKey: agentKeys.connection,
    queryFn: fetchConnection,
    // Trong lúc ghép nối, trạng thái đổi trong vài giây — hỏi lại dày hơn
    // để người dùng thấy kết quả mà không phải tải lại trang.
    refetchInterval: pairing ? 3_000 : 30_000,
  })

  const link = useMutation({
    mutationFn: (input: string) =>
      requestPairingCode(normalizePhoneNumber(input)),
    onSuccess: setPairing,
  })

  const envelopeState = connection.data?.state
  const linked = connection.data?.data?.state === 'connected'
  const needsRelink = connection.data?.data?.needsRelink === true
  const tooShort = normalizePhoneNumber(phoneNumber).length < 8

  return (
    <Card>
      <CardHeader>
        <CardTitle>Liên kết WhatsApp</CardTitle>
        <CardDescription>
          Chỉ cần làm một lần. Sau khi liên kết, điện thoại tắt máy hệ thống
          vẫn chạy — chỉ đừng gỡ liên kết trong danh sách thiết bị.
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4'>
        {connection.isLoading ? (
          <p className={MUTED}>Đang kiểm tra trạng thái…</p>
        ) : envelopeState === 'error' ? (
          <div className={BOX_ERROR}>
            Không đọc được trạng thái kết nối:{' '}
            {connection.data?.error?.message ?? 'không rõ nguyên nhân'}
          </div>
        ) : linked ? (
          <div className={BOX_OK}>Đã liên kết. Không cần làm gì thêm.</div>
        ) : (
          <>
            {needsRelink ? (
              <div className={BOX_WARN}>
                Liên kết đã mất hiệu lực. Ghép nối lại bên dưới.
              </div>
            ) : null}

            <div className='space-y-2'>
              <Label htmlFor='wa-phone'>Số điện thoại (kèm mã quốc gia)</Label>
              <Input
                id='wa-phone'
                inputMode='numeric'
                placeholder='51987654321'
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value)
                }}
              />
              <p className={HINT}>
                Không dấu cộng, không dấu cách. Peru: 51 + số thuê bao.
              </p>
            </div>

            <Button
              disabled={tooShort || link.isPending}
              onClick={() => {
                link.mutate(phoneNumber)
              }}
            >
              {link.isPending ? 'Đang xin mã…' : 'Lấy mã ghép nối'}
            </Button>

            {link.isError ? (
              <div className={BOX_ERROR}>
                {link.error instanceof Error
                  ? link.error.message
                  : 'không xin được mã ghép nối'}
              </div>
            ) : null}

            {pairing ? (
              <div className='space-y-2 rounded-md border p-4'>
                <p className='text-sm font-medium'>Mã ghép nối</p>
                {/* Giãn chữ để đọc từng ký tự khi gõ sang điện thoại. */}
                <p className='font-mono text-2xl tracking-[0.3em]'>
                  {pairing.pairingCode}
                </p>
                <p className={MUTED}>{pairing.instructions}</p>
                <p className={HINT}>
                  Mã có hạn dùng. Hết hạn thì lấy mã khác, không dùng lại mã cũ.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
