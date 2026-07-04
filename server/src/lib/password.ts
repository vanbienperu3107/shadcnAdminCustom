import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// scrypt params — N=16384 (2^14) là mức khuyến nghị tối thiểu, an toàn cho web admin.
const KEYLEN = 64
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

// promisify không nắm được overload có options của scrypt — tự bọc Promise.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

/**
 * Băm mật khẩu bằng scrypt (built-in, không thêm dependency).
 * Định dạng chuỗi lưu DB: `scrypt$N$r$p$saltHex$hashHex`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scryptAsync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })) as Buffer
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`
}

// Hash "mồi" cache lại để burn thời gian scrypt tương đương khi user không tồn
// tại — tránh timing side-channel cho phép dò username. Sinh 1 lần khi cần.
let dummyHashPromise: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(16).toString('hex'))
  }
  return dummyHashPromise
}

/**
 * Chạy một phép scrypt "giả" để thời gian phản hồi khi user KHÔNG tồn tại (hoặc
 * chưa đặt mật khẩu) tương đương lúc verify thật. Luôn trả false.
 */
export async function dummyVerify(password: string): Promise<false> {
  await verifyPassword(password, await getDummyHash())
  return false
}

/**
 * Kiểm mật khẩu theo hash đã lưu. So sánh timing-safe để tránh timing attack.
 * Trả false (không ném) nếu định dạng hash lỗi.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false
  }
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }
  if (expected.length === 0) return false
  const derived = (await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
  })) as Buffer
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
