import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent, type Locator } from 'vitest/browser'
import { ForgotPasswordForm } from './forgot-password-form'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/lib/utils', async (orig) => ({
  ...(await orig()),
  sleep: vi.fn(() => Promise.resolve()),
}))

// sonner toast.promise không chạy success callback ổn định trong browser CI
// (không có <Toaster/> mounted) -> navigate không được gọi -> test flaky/đỏ.
// Mock để success chạy tất định ngay khi promise (sleep đã mock) resolve.
vi.mock('sonner', () => ({
  toast: {
    promise: (promise: Promise<unknown>, opts: { success?: () => unknown }) =>
      Promise.resolve(promise).then(() => opts?.success?.()),
  },
}))

describe('ForgotPasswordForm', () => {
  let screen: RenderResult
  let emailInput: Locator
  let continueButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()

    screen = await render(<ForgotPasswordForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    continueButton = screen.getByRole('button', { name: /^Continue$/i })
  })

  it('renders email field and continue button', async () => {
    await expect.element(emailInput).toBeInTheDocument()
    await expect.element(continueButton).toBeInTheDocument()
  })

  it('shows validation when submitting empty form', async () => {
    await userEvent.click(continueButton)
    // Validation qua zodResolver là async; browser CI chậm hơn local nên cho
    // retry rộng hơn mặc định để tránh flaky.
    await expect
      .element(screen.getByText(/^Please enter your email\.$/i), {
        timeout: 5000,
      })
      .toBeInTheDocument()
  })

  it('resets the form and navigates to /otp on success', async () => {
    await userEvent.fill(emailInput, 'a@b.com')
    await userEvent.click(continueButton)

    // navigate chạy trong success callback của toast.promise(sleep) — trên CI
    // cần chờ lâu hơn 1s mặc định.
    await vi.waitFor(
      () => expect(navigateMock).toHaveBeenCalledWith({ to: '/otp' }),
      { timeout: 5000 }
    )

    // Form should reset on success
    await expect.element(emailInput, { timeout: 5000 }).toHaveValue('')
  })
})
