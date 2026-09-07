import type { Member } from './cdServer'

type NameParts = Pick<Member, 'firstName' | 'middleName' | 'lastName' | 'nickname' | 'suffix'>

// The message to show for a rejected promise: a CdServerError (or any
// Error) carries a user-facing string; anything else gets a generic
// fallback. Shared by every screen that awaits a cd-server call.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}

// nickname/firstName is an `||`, not `??`, on purpose: cd-server sends an
// empty string (not null) for a member with no recorded nickname, and an
// empty nickname should still fall through to the first name.
export function formatMemberName(member: NameParts): string {
  return [member.nickname || member.firstName, member.middleName, member.lastName, member.suffix]
    .filter(Boolean)
    .join(' ')
}

// Delegates (DC and the five territories) and Puerto Rico's Resident
// Commissioner hold House seats and vote in committee, but not on floor
// passage -- so "voting record" doesn't apply to them the way it does
// to a Senator or Representative. Matches cd-lib's role vocabulary.
const NON_VOTING_ROLES = new Set(['Delegate', 'Resident Commissioner'])

export function isNonVotingRole(role: string): boolean {
  return NON_VOTING_ROLES.has(role)
}

export function isHttpUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

// cd-server relays Congress.gov's party names verbatim, and they arrive
// SHOUTING ("DEMOCRATIC", "REPUBLICAN", "INDEPENDENT"). Title-case an
// all-caps value for display; leave anything already mixed-case alone.
export function formatParty(party: string): string {
  if (party !== party.toUpperCase()) return party
  return party.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// A URL trimmed for display next to a member: no scheme, no trailing
// slash (cd-server hands back e.g. "https://ocasio-cortez.house.gov/").
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

// A `tel:` URI from a display phone number ("(202) 225-2523" ->
// "tel:+12022252523") so it's tappable on mobile. Congress numbers are
// all US/NANP: a bare 10-digit number gets a +1, a leading 1 is treated
// as the country code.
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `tel:+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`
  return `tel:${digits}`
}

// --- bill / vote formatting (searchBills on the member detail page) ---

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

export function congressLabel(congress: number): string {
  return `${ordinal(congress)} Congress`
}

// cd-api sends the bill type uppercased and dot-less ("HR", "S", "HJRES");
// render it Congress.gov-style ("H.R.", "S.", "H.J.Res.").
const BILL_TYPE_LABELS: Record<string, string> = {
  HR: 'H.R.',
  S: 'S.',
  HJRES: 'H.J.Res.',
  SJRES: 'S.J.Res.',
  HCONRES: 'H.Con.Res.',
  SCONRES: 'S.Con.Res.',
  HRES: 'H.Res.',
  SRES: 'S.Res.',
}
export function formatBillId(billType: string, billNumber: number): string {
  return `${BILL_TYPE_LABELS[billType.toUpperCase()] ?? `${billType}.`} ${billNumber}`
}

const CONGRESS_GOV_BILL_PATHS: Record<string, string> = {
  HR: 'house-bill',
  S: 'senate-bill',
  HJRES: 'house-joint-resolution',
  SJRES: 'senate-joint-resolution',
  HCONRES: 'house-concurrent-resolution',
  SCONRES: 'senate-concurrent-resolution',
  HRES: 'house-resolution',
  SRES: 'senate-resolution',
}
export function congressGovBillUrl(
  congress: number,
  billType: string,
  billNumber: number,
): string | null {
  const path = CONGRESS_GOV_BILL_PATHS[billType.toUpperCase()]
  if (!path) return null
  return `https://www.congress.gov/bill/${ordinal(congress)}-congress/${path}/${billNumber}`
}

export type VoteTone = 'yea' | 'nay' | 'present' | 'none'

// cd-lib RollCallVote.vote_cast is "YEA" | "NAY" | "PRESENT" | "NOT_VOTING".
export function voteTone(voteCast: string): VoteTone {
  switch (voteCast.toUpperCase()) {
    case 'YEA':
      return 'yea'
    case 'NAY':
      return 'nay'
    case 'PRESENT':
      return 'present'
    default:
      return 'none'
  }
}
export function formatVoteCast(voteCast: string): string {
  switch (voteCast.toUpperCase()) {
    case 'YEA':
      return 'Voted Yea'
    case 'NAY':
      return 'Voted Nay'
    case 'PRESENT':
      return 'Voted Present'
    case 'NOT_VOTING':
      return 'Did not vote'
    default:
      return voteCast
  }
}

// "2025-06-12" -> "June 12, 2025". Parsed at local midnight so the day
// doesn't slip a date in a behind-UTC timezone.
export function formatVoteDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Elements matching `selector`, keeping only the outermost match for any
// nesting (a <p> inside a <li>, say) -- so a block's text isn't counted
// once for the outer element and again for the nested one.
function leafBlocks(doc: Document, selector: string): Element[] {
  const all = Array.from(doc.body.querySelectorAll(selector))
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)))
}

// CRS bill summaries arrive as HTML. Flatten to text for a preview --
// DOMParser with 'text/html' never runs scripts, so upstream markup is
// safe to feed through. Block-level elements (<p>, <li>) are joined with
// a space: `doc.body.textContent` alone concatenates adjacent elements
// with no separator at all, so a title <p> immediately followed by a
// body <p> (a common CRS shape, no whitespace between the tags) would
// otherwise glue into one word ("...Act" + "This section..." ->
// "...ActThis section..."). Falls back to the raw body text when
// there's no block-level markup to split on.
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = leafBlocks(doc, 'p, li').map((el) => el.textContent ?? '')
  const text = blocks.length > 0 ? blocks.join(' ') : (doc.body.textContent ?? '')
  return text.replace(/\s+/g, ' ').trim()
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}

// The full CRS summary, split on block boundaries (<p>, <li>) instead of
// joined into one run-on paragraph like plainText() -- for the "Show
// more" expanded view, where a multi-section summary (several <p>s, a
// <ul> of bullets) reads far better as separate paragraphs. Falls back
// to the whole body as a single block when there's no block-level markup
// to split on.
export function plainTextBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = leafBlocks(doc, 'p, li')
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (blocks.length > 0) return blocks
  const whole = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
  return whole ? [whole] : []
}

// "2026-09-06T00:00:00Z" -> "12:00 AM (in about 6 hours)". The daily
// AI-summary cap resets at the next UTC midnight; show it as a local
// time plus a rough countdown. `now` is injectable for tests.
export function formatResetsAt(iso: string, now: Date = new Date()): string {
  const reset = new Date(iso)
  if (Number.isNaN(reset.getTime())) return iso
  const time = reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const hours = Math.round((reset.getTime() - now.getTime()) / 3_600_000)
  if (hours <= 0) return `${time} (soon)`
  if (hours === 1) return `${time} (in about an hour)`
  return `${time} (in about ${hours} hours)`
}
