import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VotingRecord } from '../../src/components/VotingRecord'
import { getIdToken, useAuth } from '../../src/auth/session'
import {
  CdServerError,
  searchBills,
  summarizeVotingRecord,
  type AiSummary,
  type Bill,
  type MemberDetail,
} from '../../src/lib/cdServer'

vi.mock('../../src/auth/session', () => ({ useAuth: vi.fn(), getIdToken: vi.fn() }))
vi.mock('../../src/lib/cdServer', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/cdServer')>(
    '../../src/lib/cdServer',
  )
  return { ...actual, searchBills: vi.fn(), summarizeVotingRecord: vi.fn() }
})

// SummaryMarkdown is the lazy-loaded chunk. It renders for real unless a
// test flips this, which stands in for the chunk failing to load/render.
let mockMarkdownThrows = false
vi.mock('../../src/components/SummaryMarkdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/SummaryMarkdown')>()
  return {
    default: (props: { children: string }) => {
      if (mockMarkdownThrows) throw new Error('markdown chunk failed to load')
      return <actual.default {...props} />
    },
  }
})

const LOGGED_IN = { displayName: 'Ada', isLoading: false, login: vi.fn(), logout: vi.fn() }
const LOGGED_OUT = { displayName: null, isLoading: false, login: vi.fn(), logout: vi.fn() }

const REP: MemberDetail = {
  bioguideId: 'O000172',
  firstName: 'Alexandria',
  middleName: null,
  lastName: 'Ocasio-Cortez',
  nickname: null,
  suffix: null,
  role: 'Representative',
  district: 14,
  state: 'NY',
  party: 'DEMOCRATIC',
  phone: null,
  website: null,
  photoUrl: null,
  inOffice: true,
}

const BILL: Bill = {
  billKey: '119-hr-2056',
  congress: 119,
  billType: 'HR',
  billNumber: 2056,
  title: 'District of Columbia Federal Immigration Compliance Act of 2025',
  policyArea: 'Immigration',
  crsSummary: '<p><strong>DC Immigration Compliance Act</strong></p><p>Bars DC from limiting cooperation.</p>',
  votes: [
    { voteCast: 'NAY', voteQuestion: 'On Passage', result: 'Passed', voteDate: '2025-06-12' },
  ],
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (r: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkdownThrows = false
  vi.mocked(useAuth).mockReturnValue(LOGGED_IN)
  vi.mocked(getIdToken).mockReturnValue('id-token') // signed in by default
  // A completed search writes ?topic= to the URL and caches its results
  // in sessionStorage; clear both so one test's search can't rehydrate
  // into the next test's fresh render.
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('role branches', () => {
  it('a Delegate gets a non-voting message and no search box', () => {
    render(<VotingRecord member={{ ...REP, role: 'Delegate' }} />)

    expect(screen.getByText(/can vote in committee but not on House floor passage/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('the Resident Commissioner gets the non-voting message too', () => {
    render(<VotingRecord member={{ ...REP, role: 'Resident Commissioner' }} />)

    expect(screen.getByText(/As the Resident Commissioner/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('a Senator gets "coming soon" and no search box', () => {
    render(<VotingRecord member={{ ...REP, role: 'Senator', district: null }} />)

    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('a Representative gets the topic search box', () => {
    render(<VotingRecord member={REP} />)

    expect(
      screen.getByRole('heading', { name: /How did Alexandria Ocasio-Cortez vote on/i }),
    ).toBeInTheDocument()
    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
    // cd-server rejects a summarize query over 200 chars; the input caps it.
    expect(input).toHaveAttribute('maxlength', '200')
  })
})

describe('search flow (Representative)', () => {
  it('queries searchBills with the bioguide id and the typed topic, and renders a bill + vote', async () => {
    vi.mocked(searchBills).mockResolvedValueOnce([BILL])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'immigration enforcement')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(searchBills).toHaveBeenCalledWith('O000172', 'immigration enforcement')

    expect(await screen.findByText(BILL.title!)).toBeInTheDocument()
    expect(screen.getByText('H.R. 2056 · 119th Congress')).toBeInTheDocument()
    expect(screen.getByText('Voted Nay')).toBeInTheDocument()
    expect(screen.getByText('On Passage · Passed · June 12, 2025')).toBeInTheDocument()
    // CRS summary HTML is flattened to text, with a separator between the
    // title <p> and the body <p> -- not glued into one word.
    expect(
      screen.getByText('DC Immigration Compliance Act Bars DC from limiting cooperation.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View full bill on Congress\.gov/i })).toHaveAttribute(
      'href',
      'https://www.congress.gov/bill/119th-congress/house-bill/2056',
    )
  })

  it('shows a "no vote on record" note for a matched bill the member never voted on', async () => {
    vi.mocked(searchBills).mockResolvedValueOnce([{ ...BILL, votes: [] }])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'immigration')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(
      await screen.findByText(/No recorded vote for Alexandria Ocasio-Cortez on this bill/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Voted /)).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matched', async () => {
    vi.mocked(searchBills).mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'cryptocurrency mining energy limits')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(
      await screen.findByText(/No bills matched .cryptocurrency mining energy limits./i),
    ).toBeInTheDocument()
    // Scope is the recorded-vote corpus, not "bills this member voted on".
    expect(screen.getByText(/recorded House floor vote/i)).toBeInTheDocument()
  })

  it('a suggested-topic chip runs that search', async () => {
    vi.mocked(searchBills).mockResolvedValueOnce([BILL])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.click(screen.getByRole('button', { name: 'immigration enforcement' }))

    expect(searchBills).toHaveBeenCalledWith('O000172', 'immigration enforcement')
    expect(await screen.findByText(BILL.title!)).toBeInTheDocument()
  })

  it('shows an error panel with a working retry when the search fails', async () => {
    vi.mocked(searchBills).mockRejectedValueOnce(new CdServerError('cd-api request failed: 503'))
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'immigration')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i)

    vi.mocked(searchBills).mockResolvedValueOnce([BILL])
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(searchBills).toHaveBeenLastCalledWith('O000172', 'immigration')
    expect(await screen.findByText(BILL.title!)).toBeInTheDocument()
  })

  it('disables the input and button while a search is in flight', async () => {
    const { promise, resolve } = deferred<Bill[]>()
    vi.mocked(searchBills).mockReturnValueOnce(promise)
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'immigration')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: /searching/i })).toBeDisabled()

    resolve([BILL])
    await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled())
  })
})

describe('expanding a long CRS summary', () => {
  const PARA_1 =
    'This section funds border security technology and screening operations across ports of entry along the southwest, northern, and maritime borders of the United States, including nonintrusive inspection equipment and artificial intelligence tools.'
  const PARA_2 =
    'It also authorizes additional personnel for processing and directs a study of staffing needs at each port of entry over the following five fiscal years.'
  const LONG_BILL: Bill = {
    ...BILL,
    billKey: '119-s-2',
    crsSummary: `<p><strong>Secure America Act</strong></p><p>${PARA_1}</p><p>${PARA_2}</p>`,
  }

  async function search(bill: Bill) {
    vi.mocked(searchBills).mockResolvedValueOnce([bill])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)
    await user.type(screen.getByRole('textbox'), 'border security')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await screen.findByText(bill.title!)
    return user
  }

  it('truncates a long summary and offers "Show more"', async () => {
    await search(LONG_BILL)

    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
    expect(screen.queryByText(PARA_2)).not.toBeInTheDocument()
  })

  it('reveals the full summary as separate paragraphs, then collapses back on "Show less"', async () => {
    const user = await search(LONG_BILL)

    await user.click(screen.getByRole('button', { name: /show more/i }))

    expect(screen.getByText('Secure America Act')).toBeInTheDocument()
    expect(screen.getByText(PARA_1)).toBeInTheDocument()
    expect(screen.getByText(PARA_2)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show less/i }))

    expect(screen.queryByText(PARA_2)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument()
  })

  it('shows no "Show more" button for a summary that already fits', async () => {
    await search(BILL)

    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument()
  })
})

describe('AI summary', () => {
  const SUMMARY: AiSummary = {
    id: 'sum_1',
    bioguideId: 'O000172',
    query: 'immigration enforcement',
    summary: 'Across the matched bills, the member voted against every enforcement-expansion measure.',
    createdAt: '2026-09-05T12:00:00Z',
  }

  async function searchThen() {
    vi.mocked(searchBills).mockResolvedValueOnce([BILL])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)
    await user.type(screen.getByRole('textbox'), 'immigration enforcement')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await screen.findByText(BILL.title!)
    return user
  }

  it('offers a "Summarize with AI" button by the results count line', async () => {
    await searchThen()
    expect(screen.getByRole('button', { name: /summarize with ai/i })).toBeInTheDocument()
  })

  it('generates the summary and renders it in the AI card, then regenerates', async () => {
    vi.mocked(summarizeVotingRecord).mockResolvedValueOnce(SUMMARY)
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    expect(summarizeVotingRecord).toHaveBeenCalledWith('O000172', 'immigration enforcement')
    expect(await screen.findByText(SUMMARY.summary)).toBeInTheDocument()
    expect(screen.getByText(/^AI Summary$/)).toBeInTheDocument()

    vi.mocked(summarizeVotingRecord).mockResolvedValueOnce({
      ...SUMMARY,
      summary: 'A fresh take.',
    })
    await user.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(summarizeVotingRecord).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('A fresh take.')).toBeInTheDocument()
  })

  it('hides the "Summarize with AI" link once the summary is on screen', async () => {
    vi.mocked(summarizeVotingRecord).mockResolvedValueOnce(SUMMARY)
    const user = await searchThen()

    expect(screen.getByRole('button', { name: /summarize with ai/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))
    await screen.findByText(SUMMARY.summary)

    // The card's own "Regenerate" link is the way to re-run from here.
    expect(screen.queryByRole('button', { name: /summarize with ai/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
  })

  it('renders the summary markdown (bold, bullet lists) rather than literal syntax', async () => {
    vi.mocked(summarizeVotingRecord).mockResolvedValueOnce({
      ...SUMMARY,
      summary:
        'On **substantive votes**, the member voted NAY on:\n\n- H.R. 2056, the DC Compliance Act\n- S. 5, the Laken Riley Act\n\nOne procedural vote went the other way.',
    })
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    // bold -> <strong>, not literal "**substantive votes**"
    const strong = await screen.findByText('substantive votes')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*substantive votes\*\*/)).not.toBeInTheDocument()
    // "- " lines -> real <li>s
    expect(screen.getByText('H.R. 2056, the DC Compliance Act').tagName).toBe('LI')
    expect(screen.getByText('S. 5, the Laken Riley Act').tagName).toBe('LI')
  })

  it('falls back to the plain-text summary when the markdown chunk fails', async () => {
    mockMarkdownThrows = true
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const md = 'On **substantive votes**, the member voted NAY on every bill.'
    vi.mocked(summarizeVotingRecord).mockResolvedValueOnce({ ...SUMMARY, summary: md })
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    // The raw string renders verbatim -- ** stays literal, nothing parsed.
    expect(await screen.findByText(md)).toBeInTheDocument()
    expect(screen.queryByText('substantive votes')).not.toBeInTheDocument()
    expect(document.querySelector('strong')).toBeNull()

    consoleErr.mockRestore()
  })

  it('shows a loading state while the summary is generating', async () => {
    const { promise, resolve } = deferred<AiSummary>()
    vi.mocked(summarizeVotingRecord).mockReturnValueOnce(promise)
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    expect(screen.getByText(/summarizing/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /summarize with ai/i })).toBeDisabled()

    resolve(SUMMARY)
    expect(await screen.findByText(SUMMARY.summary)).toBeInTheDocument()
  })

  it('surfaces a generation failure with a working "Try again"', async () => {
    vi.mocked(summarizeVotingRecord).mockRejectedValueOnce(
      new CdServerError('cd-api request failed: 503'),
    )
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    // Friendly, static -- the raw backend text is logged, not shown.
    expect(await screen.findByRole('alert')).toHaveTextContent(/this is on our side/i)
    expect(screen.queryByText(/cd-api request failed/i)).not.toBeInTheDocument()

    vi.mocked(summarizeVotingRecord).mockResolvedValueOnce(SUMMARY)
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText(SUMMARY.summary)).toBeInTheDocument()
  })

  it('prompts a logged-out visitor to sign in instead of calling the mutation', async () => {
    vi.mocked(useAuth).mockReturnValue(LOGGED_OUT)
    vi.mocked(getIdToken).mockReturnValue(null)
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    expect(summarizeVotingRecord).not.toHaveBeenCalled()
    expect(screen.getByText(/sign in to generate an ai summary/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(LOGGED_OUT.login).toHaveBeenCalled()
  })

  it('shows the sign-in prompt for an expired session (displayName set, token gone)', async () => {
    // Refresh timer hasn't fired yet: useAuth still reports a name, but
    // getIdToken() returns null. Gating on the token avoids a doomed call.
    vi.mocked(useAuth).mockReturnValue(LOGGED_IN)
    vi.mocked(getIdToken).mockReturnValue(null)
    const user = await searchThen()

    await user.click(screen.getByRole('button', { name: /summarize with ai/i }))

    expect(summarizeVotingRecord).not.toHaveBeenCalled()
    expect(screen.getByText(/sign in to generate an ai summary/i)).toBeInTheDocument()
  })

  it('does not show the button for a zero-result search', async () => {
    vi.mocked(searchBills).mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)
    await user.type(screen.getByRole('textbox'), 'nothing at all')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText(/No bills matched/i)
    expect(screen.queryByRole('button', { name: /summarize with ai/i })).not.toBeInTheDocument()
  })
})

// The completed search survives the Cognito login redirect: the topic
// goes into ?topic= (carried back by src/auth/session.ts) and the result
// list is cached in sessionStorage keyed by bioguideId+topic.
describe('search state round-trips through a full-page redirect', () => {
  const CACHE_KEY = 'cd_voterecord_search'
  const topicParam = () => new URLSearchParams(window.location.search).get('topic')

  it('reflects a completed search into the URL and sessionStorage', async () => {
    vi.mocked(searchBills).mockResolvedValueOnce([BILL])
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'immigration enforcement')
    await user.click(screen.getByRole('button', { name: /^search$/i }))
    await screen.findByText(BILL.title!)

    expect(topicParam()).toBe('immigration enforcement')
    expect(JSON.parse(sessionStorage.getItem(CACHE_KEY)!)).toEqual({
      bioguideId: 'O000172',
      q: 'immigration enforcement',
      bills: [BILL],
    })
  })

  it('paints the cached results on mount without re-running the search', async () => {
    window.history.replaceState(null, '', '/member/O000172?topic=immigration%20enforcement')
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ bioguideId: 'O000172', q: 'immigration enforcement', bills: [BILL] }),
    )

    render(<VotingRecord member={REP} />)

    expect(await screen.findByText(BILL.title!)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('immigration enforcement')
    expect(searchBills).not.toHaveBeenCalled()
  })

  it('re-runs the search from ?topic= when nothing is cached for it', async () => {
    window.history.replaceState(null, '', '/member/O000172?topic=border%20security')
    vi.mocked(searchBills).mockResolvedValueOnce([BILL])

    render(<VotingRecord member={REP} />)

    expect(await screen.findByText(BILL.title!)).toBeInTheDocument()
    expect(searchBills).toHaveBeenCalledWith('O000172', 'border security')
  })

  it('ignores a cache left by a different member', async () => {
    window.history.replaceState(null, '', '/member/O000172?topic=border%20security')
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ bioguideId: 'X999999', q: 'border security', bills: [BILL] }),
    )
    vi.mocked(searchBills).mockResolvedValueOnce([BILL])

    render(<VotingRecord member={REP} />)

    await screen.findByText(BILL.title!)
    expect(searchBills).toHaveBeenCalledWith('O000172', 'border security')
  })

  it('clears the topic param when the search fails', async () => {
    vi.mocked(searchBills).mockRejectedValueOnce(new CdServerError('cd-api request failed: 503'))
    const user = userEvent.setup()
    render(<VotingRecord member={REP} />)

    await user.type(screen.getByRole('textbox'), 'immigration')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByRole('alert')
    expect(topicParam()).toBeNull()
    expect(sessionStorage.getItem(CACHE_KEY)).toBeNull()
  })
})
