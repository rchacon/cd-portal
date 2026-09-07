import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsageSection } from '../../src/components/UsageSection'
import { CdServerError, getFeatures, type Feature } from '../../src/lib/cdServer'

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
})

describe('UsageSection', () => {
  it('shows used / limit / remaining and a reset time once loaded', async () => {
    vi.mocked(getFeatures).mockResolvedValueOnce([AI_SUMMARY])
    render(<UsageSection />)

    expect(await screen.findByText(/used today/i)).toHaveTextContent('3 of 10 used today')
    expect(screen.getByText(/remaining/i)).toHaveTextContent('7 remaining')
    expect(screen.getByText(/^Resets/)).toHaveTextContent(/^Resets .+/)
  })

  it.each([
    ['null', null],
    ['0', 0],
  ])('treats dailyLimit %s as no cap (no bar, no divide-by-zero)', async (_label, dailyLimit) => {
    vi.mocked(getFeatures).mockResolvedValueOnce([{ ...AI_SUMMARY, dailyLimit }])
    render(<UsageSection />)

    expect(await screen.findByText(/no daily limit/i)).toHaveTextContent(
      '3 used today · no daily limit',
    )
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument()
  })

  it('notes when the daily limit is reached', async () => {
    vi.mocked(getFeatures).mockResolvedValueOnce([
      { ...AI_SUMMARY, enabled: false, reason: 'daily_limit_reached', usedToday: 10 },
    ])
    render(<UsageSection />)

    expect(await screen.findByText(/used all of today's summaries/i)).toBeInTheDocument()
  })

  it('notes when the feature is globally at capacity', async () => {
    vi.mocked(getFeatures).mockResolvedValueOnce([
      { ...AI_SUMMARY, enabled: false, reason: 'globally_unavailable' },
    ])
    render(<UsageSection />)

    expect(await screen.findByText(/at capacity for everyone/i)).toBeInTheDocument()
  })

  it('falls back to a generic note for an unrecognised disabled reason', async () => {
    vi.mocked(getFeatures).mockResolvedValueOnce([{ ...AI_SUMMARY, enabled: false, reason: null }])
    render(<UsageSection />)

    expect(await screen.findByText(/aren.t available right now/i)).toBeInTheDocument()
  })

  it('shows an error with a working "Try again"', async () => {
    vi.mocked(getFeatures).mockRejectedValueOnce(new CdServerError('features requires authentication'))
    const user = userEvent.setup()
    render(<UsageSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load your usage/i)

    vi.mocked(getFeatures).mockResolvedValueOnce([AI_SUMMARY])
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText(/used today/i)).toHaveTextContent('3 of 10 used today')
  })

  it('handles the ai_summary feature being absent', async () => {
    vi.mocked(getFeatures).mockResolvedValueOnce([])
    render(<UsageSection />)

    expect(await screen.findByText(/usage isn.t available/i)).toBeInTheDocument()
  })
})
