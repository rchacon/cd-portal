import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsOverlay } from '../../src/components/SettingsOverlay'
import { getFeatures, type Feature } from '../../src/lib/cdServer'

vi.mock('../../src/lib/cdServer', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/cdServer')>(
    '../../src/lib/cdServer',
  )
  return { ...actual, getFeatures: vi.fn() }
})

const AI_SUMMARY: Feature = {
  name: 'ai_summary',
  enabled: true,
  reason: null,
  dailyLimit: 10,
  usedToday: 3,
  resetsAt: '2099-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getFeatures).mockResolvedValue([AI_SUMMARY])
})

describe('SettingsOverlay', () => {
  it('renders a labelled dialog with a Usage nav item and its content', async () => {
    render(<SettingsOverlay onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: /settings/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usage' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText(/used today/i)).toHaveTextContent('3 of 10 used today')
  })

  it('moves focus to the close button on open', async () => {
    render(<SettingsOverlay onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /close settings/i })).toHaveFocus()
  })

  it('closes via the ✕ button, Escape, and a backdrop click', async () => {
    const user = userEvent.setup()

    const onClose1 = vi.fn()
    const { unmount } = render(<SettingsOverlay onClose={onClose1} />)
    await user.click(screen.getByRole('button', { name: /close settings/i }))
    expect(onClose1).toHaveBeenCalledTimes(1)
    unmount()

    const onClose2 = vi.fn()
    const r2 = render(<SettingsOverlay onClose={onClose2} />)
    await user.keyboard('{Escape}')
    expect(onClose2).toHaveBeenCalledTimes(1)
    r2.unmount()

    const onClose3 = vi.fn()
    render(<SettingsOverlay onClose={onClose3} />)
    // mousedown on the backdrop (the dialog's parent), not the panel
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose3).toHaveBeenCalledTimes(1)
  })

  it('does not close when the panel itself is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<SettingsOverlay onClose={onClose} />)

    await user.click(screen.getByRole('heading', { name: /settings/i }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
