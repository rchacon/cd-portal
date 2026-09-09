import { useEffect, useState, type FormEvent } from 'react'
import {
  CdServerError,
  getDistrict,
  getDistrictByCoords,
  getRepresentatives,
  getSenators,
  getStates,
  type Representative,
  type Senator,
  type StateOption,
} from '../lib/cdServer'
import { errorMessage, formatMemberName, formatParty, isNonVotingRole } from '../lib/format'
import { memberPath } from '../lib/router'
import { RouterLink } from './RouterLink'

type Chamber = 'representatives' | 'senators'
type RepMode = 'district' | 'address'

// The only search mode that doesn't need the `states` list loaded is
// representatives-by-address (getDistrict/getRepresentatives never read it).
// Named and centralized here, rather than inlined at the formDisabled call
// site, so a future mode with the same property has one obvious place to
// update instead of a scattered boolean someone has to remember to touch.
function modeNeedsStates(chamber: Chamber, repMode: RepMode): boolean {
  return !(chamber === 'representatives' && repMode === 'address')
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; members: Array<Representative | Senator> }

function MemberCard({ member, chamber }: { member: Representative | Senator; chamber: Chamber }) {
  // The chamber that was actually searched is the authoritative signal for
  // whether `member` is a Representative -- not whether the GraphQL response
  // happens to include a `role` field, which could drift from this component
  // if the query strings in cdServer.ts ever change independently.
  const role = chamber === 'representatives' ? (member as Representative).role : null
  // Delegates / the Resident Commissioner can't vote on floor passage, so
  // "View voting record" would misrepresent what the detail page offers.
  const cta = role && isNonVotingRole(role) ? 'View details' : 'View voting record'

  return (
    <li>
      <RouterLink
        href={memberPath(member.bioguideId)}
        className="group block rounded-2xl bg-white/10 p-5 text-left ring-1 ring-white/15 transition-colors hover:bg-white/15 hover:ring-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <div className="flex items-center gap-4">
          {member.photoUrl && (
            <img src={member.photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          )}
          <div>
            <p className="text-lg font-semibold text-white">
              {formatMemberName(member) || 'Unnamed'}
            </p>
            {role && <p className="text-sm text-blue-300">{role}</p>}
            {member.party && <p className="text-sm text-blue-100">{formatParty(member.party)}</p>}
          </div>
        </div>
        {/* Contact details (phone, website) live on the detail page only:
            the whole card is a single link, so a phone/URL sitting on it
            reads as clickable when it isn't. One card, one action. */}
        <p className="mt-4 flex items-center gap-1.5 border-t border-white/10 pt-3 text-sm font-semibold text-blue-300 group-hover:text-blue-200">
          {cta}
          <span aria-hidden="true">&rarr;</span>
        </p>
      </RouterLink>
    </li>
  )
}

// Feature-detected at render (not import) time -- it's absent in
// non-secure contexts and unset by default in jsdom. When false the
// "use my location" icon isn't rendered at all; the address field is
// the only path and it's already there.
function geolocationAvailable(): boolean {
  return typeof navigator.geolocation?.getCurrentPosition === 'function'
}

// navigator.geolocation.getCurrentPosition, promisified, with a message
// tuned per failure mode. Rejects with a CdServerError so the shared
// error rendering (errorMessage) surfaces the text verbatim, same as a
// getDistrict failure.
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    // The `timeout` option below only bounds *position acquisition*, not a
    // permission prompt the user leaves open -- browsers never time that out,
    // so getCurrentPosition can invoke neither callback indefinitely and the
    // caller (which disables the whole form while it waits) hangs with no
    // cancel affordance. This watchdog bounds the entire round trip.
    const watchdog = setTimeout(() => {
      reject(
        new CdServerError(
          'Getting your location took too long. Try again, or enter your address instead.',
        ),
      )
    }, 15_000)
    const settle = (fn: () => void) => {
      clearTimeout(watchdog)
      fn()
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => settle(() => resolve(pos)),
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location access is blocked. Allow it in your browser settings, or enter your address instead.'
            : err.code === err.TIMEOUT
              ? 'Getting your location took too long. Try again, or enter your address instead.'
              : "Couldn't get your location. Try again, or enter your address instead."
        settle(() => reject(new CdServerError(message)))
      },
      { timeout: 10_000, maximumAge: 60_000 },
    )
  })
}

function LocationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5 animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const inputClass =
  'w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-navy-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/50'
const radioLabelClass =
  'flex cursor-pointer items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-white has-[:checked]:border-blue-400 has-[:checked]:bg-blue-500/20 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50'
const toggleButtonClass =
  'text-sm font-medium text-blue-300 underline decoration-blue-300/40 underline-offset-4 transition-colors hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-60'
const submitButtonClass =
  'rounded-full bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60'

export function LookupForm() {
  const [states, setStates] = useState<StateOption[] | null>(null)
  const [statesError, setStatesError] = useState<string | null>(null)

  const [chamber, setChamber] = useState<Chamber>('representatives')
  const [repMode, setRepMode] = useState<RepMode>('district')
  const [stateCode, setStateCode] = useState('')
  const [district, setDistrict] = useState('')
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Distinct from status.kind === 'loading' so only the location icon
  // shows a spinner -- a plain address Search shouldn't spin it too.
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    let cancelled = false
    getStates()
      .then((result) => {
        if (!cancelled) setStates(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatesError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const senateEligibleStates = states?.filter((s) => s.votingSeats) ?? []

  const selectedState = states?.find((s) => s.abbr === stateCode)
  // At-large states (a single seat) use district 0; every other state numbers districts 1..seats.
  const isAtLargeState = selectedState?.seats === 1
  const districtMin = selectedState && !isAtLargeState ? 1 : 0
  const districtMax = selectedState && (isAtLargeState ? 0 : selectedState.seats)

  function resetStatus() {
    if (status.kind !== 'loading') setStatus({ kind: 'idle' })
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus({ kind: 'loading' })
    try {
      if (chamber === 'senators') {
        const members = await getSenators(stateCode)
        setStatus({ kind: 'success', members })
        return
      }

      let resolvedState = stateCode
      let resolvedDistrict: number
      if (repMode === 'address') {
        const resolved = await getDistrict(address)
        resolvedState = resolved.state
        resolvedDistrict = resolved.district
      } else {
        resolvedDistrict = Number(district)
        // Number('') is 0, not NaN -- an empty field would otherwise silently
        // query an at-large district instead of being rejected. The `required`
        // attribute normally blocks this, but that's a UI-layer constraint,
        // not a guarantee handleSubmit itself can rely on.
        if (district.trim() === '' || !Number.isInteger(resolvedDistrict)) {
          throw new CdServerError('Enter a valid district number.')
        }
      }
      const members = await getRepresentatives(resolvedState, resolvedDistrict)
      setStatus({ kind: 'success', members })
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) })
    }
  }

  // "Use my location": browser geolocation -> district -> representatives,
  // in one go. Only reachable in representatives-by-address mode, so the
  // result always renders as a representatives search.
  async function handleUseLocation() {
    setLocating(true)
    setStatus({ kind: 'loading' })
    try {
      const { coords } = await getCurrentPosition()
      // Destructure into `resolved` rather than `{ state, district }` --
      // a bare `district` here would shadow the district input-field state,
      // the same trap handleSubmit sidesteps.
      const resolved = await getDistrictByCoords(coords.latitude, coords.longitude)
      const members = await getRepresentatives(resolved.state, resolved.district)
      setStatus({ kind: 'success', members })
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err) })
    } finally {
      setLocating(false)
    }
  }

  const isLoading = status.kind === 'loading'
  const formDisabled = isLoading || (modeNeedsStates(chamber, repMode) && !states)

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Find your representatives
      </h1>
      <p className="mt-3 text-blue-100">
        Look up your U.S. senators or House representative by state and district, or by address.
      </p>

      {statesError && (
        <p role="alert" className="mt-4 text-sm font-medium text-red-300">
          Couldn't load the list of states: {statesError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <fieldset className="flex gap-3">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-widest text-blue-300">
            Chamber
          </legend>
          <label className={radioLabelClass}>
            <input
              type="radio"
              name="chamber"
              value="representatives"
              checked={chamber === 'representatives'}
              onChange={() => {
                setChamber('representatives')
                resetStatus()
              }}
              disabled={isLoading}
              className="accent-blue-400"
            />
            Representatives
          </label>
          <label className={radioLabelClass}>
            <input
              type="radio"
              name="chamber"
              value="senators"
              checked={chamber === 'senators'}
              onChange={() => {
                setChamber('senators')
                if (!senateEligibleStates.some((s) => s.abbr === stateCode)) setStateCode('')
                resetStatus()
              }}
              disabled={isLoading}
              className="accent-blue-400"
            />
            Senators
          </label>
        </fieldset>

        {chamber === 'senators' && (
          <select
            value={stateCode}
            onChange={(e) => {
              setStateCode(e.target.value)
              resetStatus()
            }}
            required
            disabled={formDisabled}
            className={inputClass}
          >
            <option value="">Select a state</option>
            {senateEligibleStates.map((s) => (
              <option key={s.abbr} value={s.abbr}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        {chamber === 'representatives' && (
          <>
            <button
              type="button"
              onClick={() => {
                setRepMode((m) => (m === 'district' ? 'address' : 'district'))
                resetStatus()
              }}
              disabled={isLoading}
              className={toggleButtonClass}
            >
              {repMode === 'district'
                ? "Don't know your district? Enter your address instead"
                : 'Enter state & district instead'}
            </button>

            {repMode === 'district' ? (
              <div className="flex gap-3">
                <select
                  value={stateCode}
                  onChange={(e) => {
                    setStateCode(e.target.value)
                    setDistrict('')
                    resetStatus()
                  }}
                  required
                  disabled={formDisabled}
                  className={inputClass}
                >
                  <option value="">Select a state</option>
                  {states?.map((s) => (
                    <option key={s.abbr} value={s.abbr}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={districtMin}
                  max={districtMax}
                  value={district}
                  onChange={(e) => {
                    setDistrict(e.target.value)
                    resetStatus()
                  }}
                  placeholder={
                    selectedState
                      ? isAtLargeState
                        ? 'District (0 for at-large)'
                        : `District (1–${selectedState.seats})`
                      : 'District'
                  }
                  required
                  disabled={formDisabled}
                  className={inputClass}
                />
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value)
                    resetStatus()
                  }}
                  placeholder="Street address, city, state, ZIP"
                  required
                  disabled={formDisabled}
                  className={`${inputClass} ${geolocationAvailable() ? 'pr-11' : ''}`}
                />
                {geolocationAvailable() && (
                  <button
                    type="button"
                    onClick={handleUseLocation}
                    disabled={formDisabled}
                    aria-label="Use my location"
                    title="Use my location"
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-navy-600 transition-colors hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {locating ? <SpinnerIcon /> : <LocationIcon />}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <button type="submit" disabled={formDisabled} className={submitButtonClass}>
          {isLoading ? 'Searching…' : 'Search'}
        </button>

        {status.kind === 'error' && (
          <p role="alert" className="text-sm font-medium text-red-300">
            {status.message}
          </p>
        )}
      </form>

      {status.kind === 'success' && (
        <ul className="mt-8 space-y-4">
          {status.members.length === 0 ? (
            <p className="text-blue-100">No results found.</p>
          ) : (
            status.members.map((member) => (
              <MemberCard key={member.bioguideId} member={member} chamber={chamber} />
            ))
          )}
        </ul>
      )}
    </div>
  )
}
