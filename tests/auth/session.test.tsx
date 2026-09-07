import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const SESSION_KEY = 'cd_auth_session'
const VERIFIER_KEY = 'cd_pkce_verifier'
const STATE_KEY = 'cd_oauth_state'
const RETURN_TO_KEY = 'cd_return_to'

function base64UrlEncodeJson(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function makeJwt(claims: Record<string, unknown>): string {
  return `${base64UrlEncodeJson({ alg: 'none', typ: 'JWT' })}.${base64UrlEncodeJson(claims)}.`
}

function makeSession(overrides: {
  name?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
} = {}) {
  const name = overrides.name ?? 'Ada'
  return {
    idToken: makeJwt({ given_name: name }),
    accessToken: overrides.accessToken ?? 'at-1',
    refreshToken: overrides.refreshToken ?? 'rt-1',
    expiresAt: overrides.expiresAt ?? Date.now() + 60 * 60 * 1000,
    displayName: name,
  }
}

vi.mock('../../src/auth/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/auth/config')>('../../src/auth/config')
  return {
    ...actual,
    buildLoginUrl: vi.fn(() => 'https://example.test/mock-login'),
    buildLogoutUrl: vi.fn(() => 'https://example.test/mock-logout'),
  }
})

// session.ts's ensureInitialized() registers a window 'storage' listener once per
// module instance with no matching removeEventListener, and vi.resetModules() only
// clears the module cache, not existing DOM listener registrations -- without this,
// every test in this file leaks a listener bound to a dead module's closure onto the
// shared jsdom window, each capable of independently re-arming scheduleRefresh().
let addEventListenerSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn())
  addEventListenerSpy = vi.spyOn(window, 'addEventListener')
})

afterEach(() => {
  for (const [type, listener] of addEventListenerSpy.mock.calls) {
    if (type === 'storage') window.removeEventListener('storage', listener as EventListenerOrEventListenerObject)
  }
  addEventListenerSpy.mockRestore()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('initFromStoredSession', () => {
  it('loads a fresh-enough stored session without refreshing', async () => {
    const session = makeSession()
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName, isLoading } = useAuth()
      return <div data-testid="name">{isLoading ? 'loading' : (displayName ?? 'none')}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('immediately refreshes a near-expiry stored session on mount', async () => {
    const session = makeSession({ expiresAt: Date.now() + 60 * 1000 })
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at-2',
        id_token: makeJwt({ given_name: 'Ada' }),
        expires_in: 3600,
        refresh_token: 'rt-2',
      }),
    } as Response)

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(stored.accessToken).toBe('at-2')
  })

  it('has no display name when nothing is stored', async () => {
    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName, isLoading } = useAuth()
      return <div data-testid="name">{isLoading ? 'loading' : (displayName ?? 'none')}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('getIdToken', () => {
  it('returns the idToken from a stored session', async () => {
    const session = makeSession()
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))

    const { getIdToken } = await import('../../src/auth/session')

    expect(getIdToken()).toBe(session.idToken)
  })

  it('returns null when there is no stored session', async () => {
    const { getIdToken } = await import('../../src/auth/session')

    expect(getIdToken()).toBeNull()
  })

  it('returns null when the stored idToken has expired', async () => {
    const session = makeSession({ expiresAt: Date.now() - 1000 })
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))

    const { getIdToken } = await import('../../src/auth/session')

    expect(getIdToken()).toBeNull()
  })
})

describe('handleCallback', () => {
  it('exchanges the code for tokens on a successful /callback arrival', async () => {
    window.history.replaceState(null, '', '/callback?code=abc123&state=xyz789')
    sessionStorage.setItem(VERIFIER_KEY, 'verifier-1')
    sessionStorage.setItem(STATE_KEY, 'xyz789')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at-1',
        id_token: makeJwt({ given_name: 'Ada' }),
        expires_in: 3600,
        refresh_token: 'rt-1',
      }),
    } as Response)

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))
    expect(fetch).toHaveBeenCalledWith(
      'https://auth.test.civicdog.com/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull()
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull()
    expect(window.location.pathname).toBe('/')
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(stored.accessToken).toBe('at-1')
  })

  it('returns to the stashed path after a successful exchange, then clears it', async () => {
    window.history.replaceState(null, '', '/callback?code=abc123&state=xyz789')
    sessionStorage.setItem(VERIFIER_KEY, 'verifier-1')
    sessionStorage.setItem(STATE_KEY, 'xyz789')
    sessionStorage.setItem(RETURN_TO_KEY, '/member/K000401?tab=votes')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at-1',
        id_token: makeJwt({ given_name: 'Ada' }),
        expires_in: 3600,
        refresh_token: 'rt-1',
      }),
    } as Response)

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))
    expect(window.location.pathname + window.location.search).toBe('/member/K000401?tab=votes')
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
  })

  it.each(['//evil.example.com', 'https://evil.example.com', '/\\evil', 'not-a-path'])(
    'ignores an unsafe stashed return path (%s) and goes home',
    async (bad) => {
      window.history.replaceState(null, '', '/callback?code=abc123&state=xyz789')
      sessionStorage.setItem(VERIFIER_KEY, 'verifier-1')
      sessionStorage.setItem(STATE_KEY, 'xyz789')
      sessionStorage.setItem(RETURN_TO_KEY, bad)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at-1',
          id_token: makeJwt({ given_name: 'Ada' }),
          expires_in: 3600,
          refresh_token: 'rt-1',
        }),
      } as Response)

      const { useAuth } = await import('../../src/auth/session')
      function Probe() {
        const { displayName } = useAuth()
        return <div data-testid="name">{displayName ?? 'none'}</div>
      }
      render(<Probe />)

      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))
      expect(window.location.pathname).toBe('/')
    },
  )

  it('falls back to any stored session when state is missing or mismatched', async () => {
    window.history.replaceState(null, '', '/callback?code=abc123&state=wrong')
    sessionStorage.setItem(VERIFIER_KEY, 'verifier-1')
    sessionStorage.setItem(STATE_KEY, 'xyz789')
    const existing = makeSession({ name: 'Bob', accessToken: 'at-existing', refreshToken: 'rt-existing' })
    localStorage.setItem(SESSION_KEY, JSON.stringify(existing))

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Bob'))
    expect(fetch).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })

  it('logs an error and falls back cleanly when the token exchange fails', async () => {
    window.history.replaceState(null, '', '/callback?code=abc123&state=xyz789')
    sessionStorage.setItem(VERIFIER_KEY, 'verifier-1')
    sessionStorage.setItem(STATE_KEY, 'xyz789')
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) } as Response)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName, isLoading } = useAuth()
      return <div data-testid="name">{isLoading ? 'loading' : (displayName ?? 'none')}</div>
    }
    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))
    expect(consoleErrorSpy).toHaveBeenCalledWith('Login failed', expect.any(Error))
    expect(window.location.pathname).toBe('/')
    consoleErrorSpy.mockRestore()
  })

  describe('extractDisplayName fallback chain', () => {
    it.each([
      [{ given_name: 'Ada', name: 'Ada Lovelace', email: 'ada@example.com' }, 'Ada'],
      [{ name: 'Ada Lovelace', email: 'ada@example.com' }, 'Ada'],
      [{ email: 'ada@example.com' }, 'ada'],
      [{}, 'there'],
    ])('resolves %j to %s', async (claims, expected) => {
      window.history.replaceState(null, '', '/callback?code=abc123&state=xyz789')
      sessionStorage.setItem(VERIFIER_KEY, 'verifier-1')
      sessionStorage.setItem(STATE_KEY, 'xyz789')
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at-1',
          id_token: makeJwt(claims),
          expires_in: 3600,
          refresh_token: 'rt-1',
        }),
      } as Response)

      const { useAuth } = await import('../../src/auth/session')
      function Probe() {
        const { displayName } = useAuth()
        return <div data-testid="name">{displayName ?? 'none'}</div>
      }
      render(<Probe />)

      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(expected))
    })
  })
})

describe('scheduled token refresh', () => {
  it('refreshes tokens shortly before expiry and persists the new session', async () => {
    vi.useFakeTimers()
    const initialSession = makeSession({ expiresAt: Date.now() + 10 * 60 * 1000 })
    localStorage.setItem(SESSION_KEY, JSON.stringify(initialSession))

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at-2',
        id_token: makeJwt({ given_name: 'Ada' }),
        expires_in: 3600,
        refresh_token: 'rt-2',
      }),
    } as Response)

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName}</div>
    }
    render(<Probe />)

    expect(screen.getByTestId('name')).toHaveTextContent('Ada')
    expect(fetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1_000)

    expect(fetch).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(stored.accessToken).toBe('at-2')
    expect(stored.refreshToken).toBe('rt-2')
  })

  it('clears the session when a scheduled refresh fails', async () => {
    vi.useFakeTimers()
    const initialSession = makeSession({ expiresAt: Date.now() + 10 * 60 * 1000 })
    localStorage.setItem(SESSION_KEY, JSON.stringify(initialSession))
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName}</div>
    }
    render(<Probe />)

    expect(screen.getByTestId('name')).toHaveTextContent('Ada')

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1_000)

    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('handleStorageEvent', () => {
  it('ignores unrelated storage keys', async () => {
    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))

    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'whatever' }))

    expect(screen.getByTestId('name')).toHaveTextContent('none')
  })

  it('logs out when the session key is cleared in another tab', async () => {
    const session = makeSession()
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))

    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_KEY, newValue: null, storageArea: localStorage }),
    )

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))
  })

  it('updates the session when a new one is set in another tab', async () => {
    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))

    const nextSession = makeSession({ name: 'Grace', accessToken: 'at-2', refreshToken: 'rt-2' })
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: SESSION_KEY,
        newValue: JSON.stringify(nextSession),
        storageArea: localStorage,
      }),
    )

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Grace'))
  })

  it('treats malformed JSON as a logout rather than throwing', async () => {
    const session = makeSession()
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))

    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { displayName } = useAuth()
      return <div data-testid="name">{displayName ?? 'none'}</div>
    }
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))

    expect(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: SESSION_KEY, newValue: 'not json', storageArea: localStorage }),
      )
    }).not.toThrow()

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))
  })
})

// jsdom logs "Not implemented: navigation to another Document" to stderr for the
// window.location.href assignment below -- expected noise, not a failure. jsdom 30
// makes window.location's properties non-configurable, so the assignment can't be
// stubbed or read back; assert on buildLoginUrl/buildLogoutUrl and the pre-navigation
// side effects instead.
describe('login', () => {
  it('writes PKCE verifier and state, and calls buildLoginUrl with them', async () => {
    const user = userEvent.setup()
    const { useAuth } = await import('../../src/auth/session')
    const { buildLoginUrl } = await import('../../src/auth/config')
    function Probe() {
      const { login } = useAuth()
      return (
        <button type="button" onClick={() => void login()}>
          login
        </button>
      )
    }
    render(<Probe />)

    await user.click(screen.getByRole('button', { name: 'login' }))

    await waitFor(() => expect(buildLoginUrl).toHaveBeenCalled())
    const verifier = sessionStorage.getItem(VERIFIER_KEY)
    const state = sessionStorage.getItem(STATE_KEY)
    expect(verifier).toBeTruthy()
    expect(state).toBeTruthy()
    expect(buildLoginUrl).toHaveBeenCalledWith(expect.any(String), state)
  })

  it('stashes the current path so login can return to it', async () => {
    window.history.replaceState(null, '', '/member/K000401?tab=votes')
    const user = userEvent.setup()
    const { useAuth } = await import('../../src/auth/session')
    function Probe() {
      const { login } = useAuth()
      return (
        <button type="button" onClick={() => void login()}>
          login
        </button>
      )
    }
    render(<Probe />)

    await user.click(screen.getByRole('button', { name: 'login' }))

    await waitFor(() =>
      expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/member/K000401?tab=votes'),
    )
  })
})

describe('logout', () => {
  it('clears the session and calls buildLogoutUrl', async () => {
    const session = makeSession()
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))

    const user = userEvent.setup()
    const { useAuth } = await import('../../src/auth/session')
    const { buildLogoutUrl } = await import('../../src/auth/config')
    function Probe() {
      const { displayName, logout } = useAuth()
      return (
        <div>
          <span data-testid="name">{displayName ?? 'none'}</span>
          <button type="button" onClick={logout}>
            logout
          </button>
        </div>
      )
    }
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Ada'))

    await user.click(screen.getByRole('button', { name: 'logout' }))

    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('none'))
    expect(buildLogoutUrl).toHaveBeenCalled()
  })
})
