import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/session'
import { searchBills, summarizeVotingRecord, type Bill, type MemberDetail } from '../lib/cdServer'
import {
  congressGovBillUrl,
  congressLabel,
  errorMessage,
  formatBillId,
  formatMemberName,
  formatVoteCast,
  formatVoteDate,
  isNonVotingRole,
  plainText,
  plainTextBlocks,
  truncate,
  voteTone,
  type VoteTone,
} from '../lib/format'

// Polarizing, and each currently returns bills from searchBills against
// the recorded-vote corpus (checked 2026-09-04). If the corpus shifts
// and one starts coming back empty, swap it -- there's no "popular
// topics" endpoint to drive these from.
const SUGGESTED_TOPICS = [
  'immigration enforcement',
  'firearm regulation',
  'abortion access',
  'transgender rights',
]
const SUMMARY_MAX = 280

const inputClass =
  'w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-navy-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/50'
const submitButtonClass =
  'shrink-0 rounded-full bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60'
const chipClass =
  'rounded-full bg-white/10 px-3 py-1 text-xs text-blue-100 ring-1 ring-white/15 transition-colors hover:bg-white/15'

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; q: string }
  | { kind: 'error'; q: string }
  | { kind: 'done'; q: string; bills: Bill[] }

// Which branch of the voting-record section a member gets. Representatives
// get the real topic search; non-voting House members (Delegate / Resident
// Commissioner) have no floor votes to search; the Senate roll-call feed
// isn't in the ETL pipeline yet.
export function VotingRecord({ member }: { member: MemberDetail }) {
  const name = formatMemberName(member) || 'this member'

  if (isNonVotingRole(member.role)) {
    const seat = member.role === 'Resident Commissioner' ? 'the Resident Commissioner' : 'a Delegate'
    return (
      <Section>
        <h2 className="text-xl font-semibold text-white">Voting record</h2>
        <p className="mt-2 max-w-prose text-sm text-blue-100">
          As {seat}, {name} can vote in committee but not on House floor passage, so there is no
          floor voting record to search.
        </p>
      </Section>
    )
  }

  if (member.role === 'Senator') {
    return (
      <Section>
        <h2 className="text-xl font-semibold text-white">Voting record</h2>
        <p className="mt-2 max-w-prose text-sm text-blue-100">
          Searching a senator&rsquo;s votes by topic is coming soon.
        </p>
      </Section>
    )
  }

  if (member.role === 'Representative') {
    return <VoteSearch bioguideId={member.bioguideId} name={name} />
  }

  // Any other / unexpected role string: no assumptions, no query.
  return (
    <Section>
      <h2 className="text-xl font-semibold text-white">Voting record</h2>
      <p className="mt-2 max-w-prose text-sm text-blue-100">
        No floor voting record is available for {name}.
      </p>
    </Section>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <section className="mt-8">{children}</section>
}

function VoteSearch({ bioguideId, name }: { bioguideId: string; name: string }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  // Ignore a resolved/rejected search once a newer one has been kicked off.
  const requestId = useRef(0)

  function run(raw: string) {
    const q = raw.trim()
    if (!q) return
    const id = ++requestId.current
    setState({ kind: 'loading', q })
    searchBills(bioguideId, q)
      .then((bills) => {
        if (id === requestId.current) setState({ kind: 'done', q, bills })
      })
      .catch((err: unknown) => {
        if (id === requestId.current) {
          console.error('searchBills failed', errorMessage(err))
          setState({ kind: 'error', q })
        }
      })
  }

  const loading = state.kind === 'loading'

  return (
    <Section>
      <h2 className="text-xl font-semibold text-white">How did {name} vote on&hellip;</h2>
      <p className="mt-2 max-w-prose text-sm text-blue-100">
        Search {name}&rsquo;s floor votes by topic &mdash; plain language, no bill numbers needed.
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run(query)
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. teaching gender identity in schools"
          disabled={loading}
          className={inputClass}
        />
        <button type="submit" disabled={loading || !query.trim()} className={submitButtonClass}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {state.kind === 'idle' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-blue-300">Try</span>
          {SUGGESTED_TOPICS.map((topic) => (
            <button
              key={topic}
              type="button"
              onClick={() => {
                setQuery(topic)
                run(topic)
              }}
              className={chipClass}
            >
              {topic}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="mt-6 text-sm text-blue-100">Searching {name}&rsquo;s votes&hellip;</p>}

      {state.kind === 'error' && (
        <div
          role="alert"
          className="mt-6 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-200 ring-1 ring-red-400/30"
        >
          <p className="font-semibold">Search is temporarily unavailable</p>
          <p className="mt-1 text-red-200/90">
            We couldn&rsquo;t run that search just now &mdash; this is on our side, not your query.
          </p>
          <button
            type="button"
            onClick={() => run(state.q)}
            className="mt-3 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
          >
            Try again
          </button>
        </div>
      )}

      {state.kind === 'done' && (
        <Results q={state.q} bills={state.bills} name={name} bioguideId={bioguideId} />
      )}
    </Section>
  )
}

type AiState =
  | { kind: 'idle' }
  | { kind: 'need-auth' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; summary: string }

function Results({
  q,
  bills,
  name,
  bioguideId,
}: {
  q: string
  bills: Bill[]
  name: string
  bioguideId: string
}) {
  const { displayName, login } = useAuth()
  const [ai, setAi] = useState<AiState>({ kind: 'idle' })
  // Same stale-response guard as VoteSearch.run -- a Bedrock generation
  // takes seconds, plenty of time to navigate away first.
  const requestId = useRef(0)

  function runSummary() {
    if (!displayName) {
      setAi({ kind: 'need-auth' })
      return
    }
    const id = ++requestId.current
    setAi({ kind: 'loading' })
    summarizeVotingRecord(bioguideId, q)
      .then((result) => {
        if (id === requestId.current) setAi({ kind: 'done', summary: result.summary })
      })
      .catch((err: unknown) => {
        if (id === requestId.current) setAi({ kind: 'error', message: errorMessage(err) })
      })
  }

  if (bills.length === 0) {
    return (
      <div className="mt-6 rounded-xl bg-white/5 px-5 py-8 text-center ring-1 ring-white/10">
        <p className="text-base font-semibold text-white">No bills matched &ldquo;{q}&rdquo;</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-blue-100">
          Search covers bills that have come up for a recorded House floor vote &mdash; a narrow
          topic can match none. Try a broader topic, or word it differently.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-blue-100">
          <span className="font-semibold text-white">
            {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
          </span>{' '}
          related to &ldquo;{q}&rdquo;, closest matches first.
        </p>
        <SummarizeButton onClick={runSummary} disabled={ai.kind === 'loading'} />
      </div>

      {ai.kind !== 'idle' && (
        <AiSummaryCard state={ai} name={name} q={q} onRun={runSummary} onSignIn={login} />
      )}

      <ul className="mt-4 space-y-4">
        {bills.map((bill) => (
          <BillResult key={bill.billKey} bill={bill} name={name} />
        ))}
      </ul>
      <p className="mt-6 max-w-prose text-xs text-blue-300/80">
        Covers only bills that have come up for a recorded House floor vote &mdash; a small share
        of all bills introduced. A narrow topic can return very few, or none.
      </p>
    </>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2.5l1.9 4.9 4.9 1.9-4.9 1.9L12 16l-1.9-4.8L5.2 9.3l4.9-1.9L12 2.5z" />
      <path d="M18.5 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5z" />
    </svg>
  )
}

// A muted warm gold -- distinct from the brand blue and from the bright
// amber "PRESENT" vote pill (which is amber-500/15 + amber-200). The AI
// treatment leans darker/golder: dimmer wash, amber-300 label.
const aiPillClass =
  'inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-3.5 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/25 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60'

function SummarizeButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={aiPillClass}>
      <SparkleIcon className="h-3.5 w-3.5" />
      Summarize with AI
    </button>
  )
}

const aiActionClass =
  'mt-3 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/15'

function AiSummaryCard({
  state,
  name,
  q,
  onRun,
  onSignIn,
}: {
  state: Exclude<AiState, { kind: 'idle' }>
  name: string
  q: string
  onRun: () => void
  onSignIn: () => void
}) {
  return (
    <div className="mt-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-400/5 p-5 ring-1 ring-amber-400/25">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-300">
        <SparkleIcon className="h-4 w-4" />
        AI summary
      </div>

      {state.kind === 'loading' && (
        <p className="mt-3 animate-pulse text-sm text-amber-100/90">
          Summarizing {name}&rsquo;s record on &ldquo;{q}&rdquo;&hellip;
        </p>
      )}

      {state.kind === 'need-auth' && (
        <>
          <p className="mt-3 text-sm text-amber-100/90">
            Sign in to generate an AI summary of this voting record.
          </p>
          <button type="button" onClick={onSignIn} className={aiActionClass}>
            Sign in
          </button>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <p role="alert" className="mt-3 text-sm text-red-200">
            We couldn&rsquo;t generate a summary just now &mdash; {state.message}
          </p>
          <button type="button" onClick={onRun} className={aiActionClass}>
            Try again
          </button>
        </>
      )}

      {state.kind === 'done' && (
        <>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-blue-50">
            {state.summary}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-amber-400/20 pt-3 text-xs text-amber-300/70">
            <span>
              AI-generated from {name}&rsquo;s votes on the bills below &mdash; it can be wrong or
              miss context.
            </span>
            <button
              type="button"
              onClick={onRun}
              className="font-semibold text-amber-200 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-100"
            >
              Regenerate
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// memo: the search input stays editable in the 'done' state, so a
// keystroke re-renders Results and every row. `bill` is a stable
// reference from the results array, so memo skips the row entirely --
// and with it the DOMParser pass in plainText() for each CRS summary.
// The Show more/less toggle below is *local* state, which memo doesn't
// gate (it only compares props) -- summaryText/summaryBlocks are each
// useMemo'd on crsSummary so clicking it doesn't re-parse HTML that
// hasn't changed, and the block split only runs at all once expanded.
const BillResult = memo(function BillResult({ bill, name }: { bill: Bill; name: string }) {
  const [expanded, setExpanded] = useState(false)
  const { crsSummary } = bill
  const summaryText = useMemo(() => (crsSummary ? plainText(crsSummary) : null), [crsSummary])
  const summaryBlocks = useMemo(
    () => (expanded && crsSummary ? plainTextBlocks(crsSummary) : null),
    [expanded, crsSummary],
  )
  const isLong = summaryText !== null && summaryText.length > SUMMARY_MAX
  const billUrl = congressGovBillUrl(bill.congress, bill.billType, bill.billNumber)

  return (
    <li className="rounded-2xl bg-white/10 p-5 ring-1 ring-white/15">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-blue-100">
          {formatBillId(bill.billType, bill.billNumber)} &middot; {congressLabel(bill.congress)}
        </span>
        {bill.policyArea && (
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-200 ring-1 ring-white/15">
            {bill.policyArea}
          </span>
        )}
      </div>

      {bill.title && <h3 className="mt-2 text-lg font-semibold text-white">{bill.title}</h3>}

      {summaryText && (
        <div className="mt-2 text-sm leading-relaxed text-blue-100">
          {expanded && summaryBlocks ? (
            <div className="space-y-2">
              {summaryBlocks.map((block, i) => (
                <p key={i}>{block}</p>
              ))}
            </div>
          ) : (
            <p>{isLong ? truncate(summaryText, SUMMARY_MAX) : summaryText}</p>
          )}
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-1 font-semibold text-blue-300 underline decoration-blue-300/40 underline-offset-4 hover:text-blue-200"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {bill.votes.length > 0 ? (
        <ul className="mt-4 space-y-2 border-t border-white/10 pt-4">
          {bill.votes.map((vote, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <VotePill voteCast={vote.voteCast} />
              <span className="text-sm text-blue-100">
                {vote.voteQuestion} &middot; {vote.result} &middot; {formatVoteDate(vote.voteDate)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 border-t border-white/10 pt-4 text-sm italic text-blue-300/80">
          No recorded vote for {name} on this bill &mdash; it matched your topic, but they have no
          vote on record for it.
        </p>
      )}

      {billUrl && (
        <a
          href={billUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-sm font-semibold text-blue-300 underline decoration-blue-300/40 underline-offset-4 hover:text-blue-200"
        >
          View full bill on Congress.gov &rarr;
        </a>
      )}
    </li>
  )
})

const VOTE_PILL_CLASSES: Record<VoteTone, string> = {
  yea: 'bg-green-500/15 text-green-300 ring-green-400/30',
  nay: 'bg-red-500/15 text-red-300 ring-red-400/30',
  present: 'bg-amber-500/15 text-amber-200 ring-amber-400/30',
  none: 'bg-white/10 text-blue-200 ring-white/15',
}

function VotePill({ voteCast }: { voteCast: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${VOTE_PILL_CLASSES[voteTone(voteCast)]}`}
    >
      {formatVoteCast(voteCast)}
    </span>
  )
}
