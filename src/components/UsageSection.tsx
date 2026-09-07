import { useEffect, useRef, useState } from 'react'
import { getFeatures, type Feature } from '../lib/cdServer'
import { errorMessage, formatResetsAt } from '../lib/format'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; feature: Feature | null }

const retryClass =
  'mt-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/15'

// The "Usage" pane of the settings overlay: the caller's AI-summary
// allowance for the day, from cd-server's `features` query.
export function UsageSection() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const reqId = useRef(0)

  function load() {
    const id = ++reqId.current
    setState({ kind: 'loading' })
    getFeatures()
      .then((features) => {
        if (id === reqId.current) {
          const feature = features.find((f) => f.name === 'ai_summary') ?? null
          setState({ kind: 'loaded', feature })
        }
      })
      .catch((err: unknown) => {
        if (id === reqId.current) {
          console.error('getFeatures failed', errorMessage(err))
          setState({ kind: 'error' })
        }
      })
  }

  useEffect(() => {
    load()
  }, [])

  if (state.kind === 'loading') {
    return <p className="text-sm text-blue-100">Loading your usage&hellip;</p>
  }

  if (state.kind === 'error') {
    return (
      <div role="alert" className="text-sm text-red-200">
        <p>We couldn&rsquo;t load your usage.</p>
        <button type="button" onClick={load} className={retryClass}>
          Try again
        </button>
      </div>
    )
  }

  const f = state.feature
  if (!f) return <p className="text-sm text-blue-100">Usage isn&rsquo;t available right now.</p>

  // cd-server sends null for a disabled per-user cap, but treat 0 (or a
  // stray negative) the same rather than dividing by it for the bar.
  const limit = f.dailyLimit != null && f.dailyLimit > 0 ? f.dailyLimit : null
  const remaining = limit != null ? Math.max(0, limit - f.usedToday) : null
  const pct = limit != null ? Math.min(100, (f.usedToday / limit) * 100) : 0

  return (
    <div>
      <h3 className="text-base font-semibold text-white">AI summaries</h3>

      {limit != null ? (
        <>
          <p className="mt-1 text-sm text-blue-100">
            <span className="font-semibold text-white">{f.usedToday}</span> of{' '}
            <span className="font-semibold text-white">{limit}</span> used today
          </p>
          <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm text-blue-100">
            <span className="font-semibold text-white">{remaining}</span> remaining
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-blue-100">
          <span className="font-semibold text-white">{f.usedToday}</span> used today &middot; no daily
          limit
        </p>
      )}

      <p className="mt-3 text-sm text-blue-100">
        Resets <span className="font-semibold text-white">{formatResetsAt(f.resetsAt)}</span>
      </p>

      {!f.enabled && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-400/25">
          {f.reason === 'globally_unavailable'
            ? 'AI summaries are at capacity for everyone right now.'
            : f.reason === 'daily_limit_reached'
              ? "You've used all of today's summaries."
              : 'AI summaries aren’t available right now.'}
        </p>
      )}
    </div>
  )
}
