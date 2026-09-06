import { getIdToken } from '../auth/session'

const CD_SERVER_URL = import.meta.env.VITE_CD_SERVER_URL ?? 'http://localhost:8000/graphql'

export class CdServerError extends Error {}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

async function graphqlRequest<T extends Record<string, unknown>, K extends keyof T>(
  query: string,
  variables: Record<string, unknown>,
  field: K,
): Promise<NonNullable<T[K]>> {
  const idToken = getIdToken()
  let response: Response
  try {
    response = await fetch(CD_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch {
    // fetch() rejects identically for network failures and CORS-blocked
    // requests -- a CORS failure never produces a Response to inspect.
    throw new CdServerError('Could not reach the lookup service. Please try again later.')
  }

  let payload: GraphQLResponse<T>
  try {
    payload = (await response.json()) as GraphQLResponse<T>
  } catch {
    throw new CdServerError(`Unexpected response from lookup service (status ${response.status}).`)
  }

  // Resolvers don't uniformly catch their own service-layer exceptions
  // (e.g. a failing upstream cd-api call, or GeocoderError) -- don't assume
  // either a clean non-2xx or a clean GraphQL `errors` shape, check both.
  if (payload.errors?.length) {
    throw new CdServerError(payload.errors[0]?.message ?? 'Lookup service returned an error.')
  }
  // Check the specific field, not just the envelope: a resolver can return
  // {data: {getSenators: null}} with no errors entry, and callers rely on
  // this function to never hand back a null/undefined result.
  const value = payload.data?.[field]
  if (!response.ok || value == null) {
    throw new CdServerError(`Lookup service returned an error (status ${response.status}).`)
  }
  return value as NonNullable<T[K]>
}

export interface Member {
  bioguideId: string
  firstName: string | null
  middleName: string | null
  lastName: string | null
  nickname: string | null
  suffix: string | null
  party: string | null
  phone: string | null
  website: string | null
  photoUrl: string | null
}
export interface Representative extends Member {
  role: string
  district: number | null
}
export type Senator = Member

// The `getMember(bioguideId)` detail type: every `Member` field plus
// `state` and `inOffice`, which the list resolvers' Representative/Senator
// don't carry. Backs the deep-linkable member page -- a bookmark to a
// since-departed member still resolves, with `inOffice: false`.
export interface MemberDetail extends Member {
  role: string
  district: number | null
  state: string
  inOffice: boolean
}

// `summarizeVotingRecord`: a nonpartisan AI summary of how a member voted
// on the bills matching a topic (the same bills `searchBills` returns,
// fed to Bedrock). Auth-gated -- `graphqlRequest` attaches the Cognito id
// token automatically; an anonymous call comes back as a CdServerError.
export interface AiSummary {
  id: string
  bioguideId: string
  query: string
  summary: string
  createdAt: string
}

// `searchBills`: bills matching a plain-language topic, each merged with
// the queried member's roll-call votes on it. A matched bill the member
// never voted on comes back with `votes: []` -- a distinct, first-class
// state, not an omission.
export interface BillVote {
  voteCast: string // YEA | NAY | PRESENT | NOT_VOTING
  voteQuestion: string
  result: string
  voteDate: string // ISO date, e.g. "2025-06-12"
}
export interface Bill {
  billKey: string
  congress: number
  billType: string // uppercase, dot-less: "HR", "S", "HJRES", ...
  billNumber: number
  title: string | null
  policyArea: string | null
  crsSummary: string | null // HTML
  votes: BillVote[]
}

export interface StateOption {
  abbr: string
  name: string
  seats: number
  votingSeats: boolean
}
export interface DistrictLookup {
  state: string
  district: number
}

const GET_STATES_QUERY = `
  query GetStates {
    getStates { abbr name seats votingSeats }
  }
`
const GET_DISTRICT_QUERY = `
  query GetDistrict($address: String!) {
    getDistrict(address: $address) { state district }
  }
`
const GET_REPRESENTATIVES_QUERY = `
  query GetRepresentatives($state: String!, $district: Int!) {
    getRepresentatives(state: $state, district: $district) {
      bioguideId firstName middleName lastName nickname suffix role district party phone website photoUrl
    }
  }
`
const GET_SENATORS_QUERY = `
  query GetSenators($state: String!) {
    getSenators(state: $state) {
      bioguideId firstName middleName lastName nickname suffix party phone website photoUrl
    }
  }
`

const GET_MEMBER_QUERY = `
  query GetMember($bioguideId: String!) {
    getMember(bioguideId: $bioguideId) {
      bioguideId firstName middleName lastName nickname suffix role district state party phone website photoUrl inOffice
    }
  }
`

const SEARCH_BILLS_QUERY = `
  query SearchBills($bioguideId: String!, $q: String!) {
    searchBills(bioguideId: $bioguideId, q: $q) {
      billKey congress billType billNumber title policyArea crsSummary
      votes { voteCast voteQuestion result voteDate }
    }
  }
`

const SUMMARIZE_VOTING_RECORD_MUTATION = `
  mutation SummarizeVotingRecord($bioguideId: String!, $q: String!) {
    summarizeVotingRecord(bioguideId: $bioguideId, q: $q) {
      id bioguideId query summary createdAt
    }
  }
`

export async function getStates(): Promise<StateOption[]> {
  return graphqlRequest<{ getStates: StateOption[] }, 'getStates'>(GET_STATES_QUERY, {}, 'getStates')
}

export async function getDistrict(address: string): Promise<DistrictLookup> {
  return graphqlRequest<{ getDistrict: DistrictLookup }, 'getDistrict'>(
    GET_DISTRICT_QUERY,
    { address },
    'getDistrict',
  )
}

export async function getRepresentatives(state: string, district: number): Promise<Representative[]> {
  return graphqlRequest<{ getRepresentatives: Representative[] }, 'getRepresentatives'>(
    GET_REPRESENTATIVES_QUERY,
    { state, district },
    'getRepresentatives',
  )
}

export async function getSenators(state: string): Promise<Senator[]> {
  return graphqlRequest<{ getSenators: Senator[] }, 'getSenators'>(GET_SENATORS_QUERY, { state }, 'getSenators')
}

export async function getMember(bioguideId: string): Promise<MemberDetail> {
  return graphqlRequest<{ getMember: MemberDetail }, 'getMember'>(
    GET_MEMBER_QUERY,
    { bioguideId },
    'getMember',
  )
}

export async function searchBills(bioguideId: string, q: string): Promise<Bill[]> {
  return graphqlRequest<{ searchBills: Bill[] }, 'searchBills'>(
    SEARCH_BILLS_QUERY,
    { bioguideId, q },
    'searchBills',
  )
}

export async function summarizeVotingRecord(bioguideId: string, q: string): Promise<AiSummary> {
  return graphqlRequest<{ summarizeVotingRecord: AiSummary }, 'summarizeVotingRecord'>(
    SUMMARIZE_VOTING_RECORD_MUTATION,
    { bioguideId, q },
    'summarizeVotingRecord',
  )
}
