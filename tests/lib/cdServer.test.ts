import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CdServerError,
  getStates,
  getDistrict,
  getRepresentatives,
  getSenators,
  getMember,
  searchBills,
  summarizeVotingRecord,
} from '../../src/lib/cdServer'
import { getIdToken } from '../../src/auth/session'

vi.mock('../../src/auth/session', () => ({
  getIdToken: vi.fn(),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(getIdToken).mockReturnValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getStates', () => {
  it('returns parsed states on a successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { getStates: [{ abbr: 'CA', name: 'California', seats: 52, votingSeats: true }] },
      }),
    } as Response)

    const result = await getStates()

    expect(result).toEqual([{ abbr: 'CA', name: 'California', seats: 52, votingSeats: true }])
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws CdServerError when fetch rejects (network/CORS failure)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(getStates()).rejects.toThrow(
      new CdServerError('Could not reach the lookup service. Please try again later.'),
    )
  })

  it('the network-failure rejection is an instance of CdServerError', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(getStates()).rejects.toBeInstanceOf(CdServerError)
  })

  it('throws CdServerError when the response body is not valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    } as unknown as Response)

    await expect(getStates()).rejects.toThrow(
      new CdServerError('Unexpected response from lookup service (status 200).'),
    )
  })

  it('throws CdServerError with the GraphQL error message when payload.errors is present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'boom' }] }),
    } as Response)

    await expect(getStates()).rejects.toThrow(new CdServerError('boom'))
  })

  it('throws CdServerError on a non-2xx status with no errors array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    await expect(getStates()).rejects.toThrow(
      new CdServerError('Lookup service returned an error (status 500).'),
    )
  })

  it('throws CdServerError when the resolver returns a null field with no errors entry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getStates: null } }),
    } as Response)

    await expect(getStates()).rejects.toThrow(
      new CdServerError('Lookup service returned an error (status 200).'),
    )
  })
})

describe('Authorization header', () => {
  it('attaches Authorization: Bearer <idToken> when an idToken is available', async () => {
    vi.mocked(getIdToken).mockReturnValue('the-id-token')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getStates: [] } }),
    } as Response)

    await getStates()

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/graphql',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer the-id-token' },
      }),
    )
  })

  it('sends no Authorization header when logged out (no idToken)', async () => {
    vi.mocked(getIdToken).mockReturnValue(null)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getStates: [] } }),
    } as Response)

    await getStates()

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/graphql',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

describe('getDistrict', () => {
  it('returns the resolved state and district on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getDistrict: { state: 'CA', district: 12 } } }),
    } as Response)

    const result = await getDistrict('1 Main St, San Francisco, CA')

    expect(result).toEqual({ state: 'CA', district: 12 })
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws CdServerError when the geocode fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'Could not geocode address' }] }),
    } as Response)

    await expect(getDistrict('nowhere')).rejects.toThrow(
      new CdServerError('Could not geocode address'),
    )
  })

  it('throws CdServerError when the resolver returns a null field with no errors entry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getDistrict: null } }),
    } as Response)

    await expect(getDistrict('nowhere')).rejects.toThrow(CdServerError)
  })
})

describe('getRepresentatives', () => {
  it('returns representatives on success', async () => {
    const rep = {
      bioguideId: 'A000000',
      firstName: 'Jane',
      middleName: null,
      lastName: 'Doe',
      nickname: null,
      suffix: null,
      role: 'Representative',
      district: 12,
      party: 'Independent',
      phone: null,
      website: null,
      photoUrl: null,
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getRepresentatives: [rep] } }),
    } as Response)

    const result = await getRepresentatives('CA', 12)

    expect(result).toEqual([rep])
  })

  it('throws CdServerError on a server error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    await expect(getRepresentatives('CA', 12)).rejects.toThrow(
      new CdServerError('Lookup service returned an error (status 500).'),
    )
  })
})

describe('getSenators', () => {
  it('returns senators on success', async () => {
    const senator = {
      bioguideId: 'B000000',
      firstName: 'John',
      middleName: null,
      lastName: 'Smith',
      nickname: null,
      suffix: null,
      party: 'Independent',
      phone: null,
      website: null,
      photoUrl: null,
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getSenators: [senator] } }),
    } as Response)

    const result = await getSenators('CA')

    expect(result).toEqual([senator])
  })

  it('throws CdServerError on a server error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    await expect(getSenators('CA')).rejects.toThrow(
      new CdServerError('Lookup service returned an error (status 500).'),
    )
  })
})

describe('getMember', () => {
  const MEMBER = {
    bioguideId: 'K000401',
    firstName: 'Kevin',
    middleName: null,
    lastName: 'Kiley',
    nickname: null,
    suffix: null,
    role: 'Representative',
    district: 3,
    state: 'CA',
    party: 'Republican',
    phone: null,
    website: null,
    photoUrl: null,
    inOffice: true,
  }

  it('returns the parsed member detail on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { getMember: MEMBER } }),
    } as Response)

    const result = await getMember('K000401')

    expect(result).toEqual(MEMBER)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces a cd-api 404 (unknown bioguide id) as a CdServerError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'cd-api request failed: 404' }] }),
    } as Response)

    await expect(getMember('X000000')).rejects.toThrow(
      new CdServerError('cd-api request failed: 404'),
    )
  })
})

describe('searchBills', () => {
  const BILL = {
    billKey: '119-hr-2056',
    congress: 119,
    billType: 'HR',
    billNumber: 2056,
    title: 'District of Columbia Federal Immigration Compliance Act of 2025',
    policyArea: 'Immigration',
    crsSummary: '<p>Does a thing.</p>',
    votes: [
      { voteCast: 'NAY', voteQuestion: 'On Passage', result: 'Passed', voteDate: '2025-06-12' },
    ],
  }

  it('returns the parsed bills on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { searchBills: [BILL] } }),
    } as Response)

    const result = await searchBills('O000172', 'immigration enforcement')

    expect(result).toEqual([BILL])
  })

  it('returns an empty array when nothing matched (not an error)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { searchBills: [] } }),
    } as Response)

    await expect(searchBills('O000172', 'nothing relevant')).resolves.toEqual([])
  })

  it('surfaces a Bedrock outage (cd-api 503) as a CdServerError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'cd-api request failed: 503' }] }),
    } as Response)

    await expect(searchBills('O000172', 'immigration')).rejects.toThrow(
      new CdServerError('cd-api request failed: 503'),
    )
  })
})

describe('summarizeVotingRecord', () => {
  const SUMMARY = {
    id: 'sum_1',
    bioguideId: 'O000172',
    query: 'immigration enforcement',
    summary: 'The member voted against every enforcement-expansion bill in the set.',
    createdAt: '2026-09-05T12:00:00Z',
  }

  it('returns the parsed AI summary on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { summarizeVotingRecord: SUMMARY } }),
    } as Response)

    const result = await summarizeVotingRecord('O000172', 'immigration enforcement')

    expect(result).toEqual(SUMMARY)
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces an anonymous call (NotAuthenticatedError) as a CdServerError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        errors: [{ message: 'summarizeVotingRecord requires authentication' }],
      }),
    } as Response)

    await expect(summarizeVotingRecord('O000172', 'immigration')).rejects.toThrow(
      new CdServerError('summarizeVotingRecord requires authentication'),
    )
  })
})
