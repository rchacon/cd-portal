import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LookupForm } from '../../src/components/LookupForm'
import {
  CdServerError,
  getDistrict,
  getDistrictByCoords,
  getRepresentatives,
  getSenators,
  getStates,
} from '../../src/lib/cdServer'

vi.mock('../../src/lib/cdServer', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/cdServer')>('../../src/lib/cdServer')
  return {
    ...actual,
    getStates: vi.fn(),
    getDistrict: vi.fn(),
    getDistrictByCoords: vi.fn(),
    getRepresentatives: vi.fn(),
    getSenators: vi.fn(),
  }
})

const STATES = [
  { abbr: 'CA', name: 'California', seats: 52, votingSeats: true },
  { abbr: 'PR', name: 'Puerto Rico', seats: 1, votingSeats: false },
]

const REP = {
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

const SENATOR = {
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStates).mockResolvedValue(STATES)
  window.history.pushState({}, '', '/')
})

describe('address lookup availability regression', () => {
  it('keeps the address flow usable while getStates() is still pending', async () => {
    vi.mocked(getStates).mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('button', { name: /enter your address instead/i }))

    expect(screen.getByPlaceholderText(/street address/i)).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^search$/i })).not.toBeDisabled()
  })

  it('keeps the address flow usable after getStates() rejects', async () => {
    vi.mocked(getStates).mockRejectedValue(new CdServerError('states unavailable'))
    const user = userEvent.setup()
    render(<LookupForm />)

    await screen.findByText(/couldn't load the list of states/i)
    await user.click(screen.getByRole('button', { name: /enter your address instead/i }))

    expect(screen.getByPlaceholderText(/street address/i)).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^search$/i })).not.toBeDisabled()
  })
})

describe('chamber/mode switching regression', () => {
  it('disables chamber radios and the mode toggle while a search is in flight, and re-enables them after', async () => {
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.type(screen.getByPlaceholderText(/district/i), '12')

    const { promise, resolve } = deferred<typeof REP[]>()
    vi.mocked(getRepresentatives).mockReturnValueOnce(promise)

    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(screen.getByRole('radio', { name: 'Representatives' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Senators' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /enter your address instead/i })).toBeDisabled()

    resolve([REP])

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Representatives' })).not.toBeDisabled())
    expect(screen.getByRole('radio', { name: 'Senators' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /enter your address instead/i })).not.toBeDisabled()
  })

  it('clears a selected state that is not senate-eligible when switching to Senators', async () => {
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'Puerto Rico')

    await user.click(screen.getByRole('radio', { name: 'Senators' }))

    expect(screen.getByRole('combobox')).toHaveValue('')
  })
})

describe('district number input constraints', () => {
  it('constrains to 1..seats and hints the range for a multi-seat state', async () => {
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')

    const districtInput = screen.getByPlaceholderText('District (1–52)')
    expect(districtInput).toHaveAttribute('min', '1')
    expect(districtInput).toHaveAttribute('max', '52')
  })

  it('constrains to exactly 0 and hints at-large for a single-seat state', async () => {
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'Puerto Rico')

    const districtInput = screen.getByPlaceholderText('District (0 for at-large)')
    expect(districtInput).toHaveAttribute('min', '0')
    expect(districtInput).toHaveAttribute('max', '0')
  })

  it('clears a stale district value when the selected state changes', async () => {
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.type(screen.getByPlaceholderText('District (1–52)'), '45')

    await user.selectOptions(stateSelect, 'Puerto Rico')

    expect(screen.getByPlaceholderText('District (0 for at-large)')).toHaveValue(null)
  })

  it('has no min/max constraint before a state is selected', async () => {
    render(<LookupForm />)

    const districtInput = await screen.findByPlaceholderText('District')
    expect(districtInput).toHaveAttribute('min', '0')
    expect(districtInput).not.toHaveAttribute('max')
  })

  it('rejects an empty district value at the JS level, not just via the required attribute', async () => {
    const user = userEvent.setup()
    const { container } = render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')

    // Bypass native HTML5 constraint validation (which a real browser would
    // enforce on a user-triggered submit) to exercise handleSubmit's own guard.
    fireEvent.submit(container.querySelector('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid district number.')
    expect(getRepresentatives).not.toHaveBeenCalled()
  })
})

describe('search flows', () => {
  it('submits a senators-by-state search and renders the results', async () => {
    vi.mocked(getSenators).mockResolvedValueOnce([SENATOR])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(getSenators).toHaveBeenCalledWith('CA')
    expect(await screen.findByText('John Smith')).toBeInTheDocument()
  })

  it('submits a representatives-by-district search', async () => {
    vi.mocked(getRepresentatives).mockResolvedValueOnce([REP])
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.type(screen.getByPlaceholderText(/district/i), '12')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(getRepresentatives).toHaveBeenCalledWith('CA', 12)
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })

  it('submits a representatives-by-address search by resolving the district first', async () => {
    vi.mocked(getDistrict).mockResolvedValueOnce({ state: 'CA', district: 7 })
    vi.mocked(getRepresentatives).mockResolvedValueOnce([REP])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('button', { name: /enter your address instead/i }))
    await user.type(screen.getByPlaceholderText(/street address/i), '1 Main St, San Francisco, CA')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(getDistrict).toHaveBeenCalledWith('1 Main St, San Francisco, CA'))
    expect(getRepresentatives).toHaveBeenCalledWith('CA', 7)
  })

  it('renders the error message from a thrown CdServerError', async () => {
    vi.mocked(getSenators).mockRejectedValueOnce(new CdServerError('boom'))
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  it('renders "No results found." for an empty result set', async () => {
    vi.mocked(getSenators).mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByText('No results found.')).toBeInTheDocument()
  })
})

describe('use my location', () => {
  const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')

  function setGeolocation(value: Geolocation | undefined) {
    Object.defineProperty(navigator, 'geolocation', { value, configurable: true })
  }
  const stubGeolocation = (getCurrentPosition: Geolocation['getCurrentPosition']) =>
    setGeolocation({ getCurrentPosition } as Geolocation)

  afterEach(() => {
    if (originalGeolocation) {
      Object.defineProperty(navigator, 'geolocation', originalGeolocation)
    } else {
      setGeolocation(undefined)
    }
  })

  async function openAddressMode() {
    const user = userEvent.setup()
    render(<LookupForm />)
    await user.click(screen.getByRole('button', { name: /enter your address instead/i }))
    return user
  }

  const POS = { coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition
  const denied = {
    code: 1,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: 'User denied Geolocation',
  } as GeolocationPositionError

  it('resolves location to district and auto-runs the representatives search', async () => {
    stubGeolocation((success) => success(POS))
    vi.mocked(getDistrictByCoords).mockResolvedValueOnce({ state: 'CA', district: 11 })
    vi.mocked(getRepresentatives).mockResolvedValueOnce([REP])
    const user = await openAddressMode()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    await waitFor(() => expect(getDistrictByCoords).toHaveBeenCalledWith(37.77, -122.42))
    expect(getRepresentatives).toHaveBeenCalledWith('CA', 11)
    expect(getDistrict).not.toHaveBeenCalled()
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })

  it('shows a friendly, actionable error when the user blocks location access', async () => {
    stubGeolocation((_success, error) => error!(denied))
    const user = await openAddressMode()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /location access is blocked.*enter your address instead/i,
    )
    expect(getDistrictByCoords).not.toHaveBeenCalled()
  })

  it('surfaces a "not in a district" error from the backend', async () => {
    stubGeolocation((success) => success(POS))
    vi.mocked(getDistrictByCoords).mockRejectedValueOnce(
      new CdServerError("That location isn't inside a U.S. congressional district"),
    )
    const user = await openAddressMode()

    await user.click(screen.getByRole('button', { name: /use my location/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /inside a U\.S\. congressional district/i,
    )
  })

  it('does not render the icon at all when the browser has no geolocation', async () => {
    setGeolocation(undefined)
    await openAddressMode()

    expect(screen.queryByRole('button', { name: /use my location/i })).not.toBeInTheDocument()
  })
})

describe('member card rendering', () => {
  it('falls back to firstName when nickname is an empty string, not just null', async () => {
    vi.mocked(getSenators).mockResolvedValueOnce([{ ...SENATOR, nickname: '', firstName: 'Jonathan' }])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByText('Jonathan Smith')).toBeInTheDocument()
  })

  it('keeps contact details (phone, website) off the card -- one card, one action', async () => {
    vi.mocked(getSenators).mockResolvedValueOnce([
      { ...SENATOR, phone: '(202) 224-3553', website: 'https://example.gov' },
    ])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText('John Smith')
    expect(screen.queryByText('example.gov')).not.toBeInTheDocument()
    expect(screen.queryByText('(202) 224-3553')).not.toBeInTheDocument()
  })

  it('links the whole card to the member detail page and navigates on click', async () => {
    vi.mocked(getSenators).mockResolvedValueOnce([SENATOR])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    const card = await screen.findByRole('link', { name: /John Smith/i })
    expect(card).toHaveAttribute('href', '/member/B000000')

    await user.click(card)
    expect(window.location.pathname).toBe('/member/B000000')
  })

  it('renders the role for a representatives search', async () => {
    vi.mocked(getRepresentatives).mockResolvedValueOnce([REP])
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.type(screen.getByPlaceholderText('District (1–52)'), '12')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText('Jane Doe')
    expect(screen.getByText('Representative')).toBeInTheDocument()
  })

  it('does not render a role for a senators search, regardless of response shape', async () => {
    vi.mocked(getSenators).mockResolvedValueOnce([SENATOR])
    const user = userEvent.setup()
    render(<LookupForm />)

    await user.click(screen.getByRole('radio', { name: 'Senators' }))
    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText('John Smith')
    expect(screen.queryByText('Representative')).not.toBeInTheDocument()
  })

  it('offers "View voting record" for a Representative', async () => {
    vi.mocked(getRepresentatives).mockResolvedValueOnce([REP])
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.type(screen.getByPlaceholderText('District (1–52)'), '12')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    const card = await screen.findByRole('link', { name: /Jane Doe/i })
    expect(card).toHaveTextContent('View voting record')
    expect(card).not.toHaveTextContent('View details')
  })

  it('offers "View details" instead for a non-voting Delegate', async () => {
    vi.mocked(getRepresentatives).mockResolvedValueOnce([
      { ...REP, role: 'Delegate', firstName: 'Stacey', lastName: 'Plaskett' },
    ])
    const user = userEvent.setup()
    render(<LookupForm />)

    const stateSelect = await screen.findByRole('combobox')
    await waitFor(() => expect(stateSelect).not.toBeDisabled())
    await user.selectOptions(stateSelect, 'California')
    await user.type(screen.getByPlaceholderText('District (1–52)'), '12')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    const card = await screen.findByRole('link', { name: /Stacey Plaskett/i })
    expect(card).toHaveTextContent('View details')
    expect(card).not.toHaveTextContent('View voting record')
  })
})
