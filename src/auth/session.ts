import { useCallback, useEffect, useState } from 'react'
import { createPkcePair, generateState } from './pkce'
import { buildLoginUrl, buildLogoutUrl, clientId, redirectUri, tokenEndpoint } from './config'

const SESSION_KEY = 'cd_auth_session'
const VERIFIER_KEY = 'cd_pkce_verifier'
const STATE_KEY = 'cd_oauth_state'
const RETURN_TO_KEY = 'cd_return_to'
const REFRESH_LEEWAY_MS = 5 * 60 * 1000

interface StoredSession {
  idToken: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  displayName: string
}

interface TokenResponse {
  access_token: string
  id_token: string
  expires_in: number
  refresh_token?: string
}

let refreshTimeoutId: ReturnType<typeof setTimeout> | undefined
let subscribers: Array<(session: StoredSession | null) => void> = []

function notify(session: StoredSession | null) {
  for (const subscriber of subscribers) subscriber(session)
}

function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function getIdToken(): string | null {
  const session = loadSession()
  if (!session || session.expiresAt <= Date.now()) return null
  return session.idToken
}

function saveSession(session: StoredSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  clearTimeout(refreshTimeoutId)
}

// Stash where the user was before the Cognito redirect, so handleCallback
// can send them back there rather than always to "/". Skip "/callback"
// itself (login is never initiated from there, but be safe).
function rememberReturnPath() {
  const path = window.location.pathname + window.location.search
  if (!path.startsWith('/callback')) {
    sessionStorage.setItem(RETURN_TO_KEY, path)
  }
}

// The stashed return path, consumed once. Falls back to "/" unless the
// value is a safe same-origin absolute path: one leading "/" (not "//" or
// "/\", which a browser can read as protocol-relative), no whitespace,
// a sane length, and not the callback route.
function takeReturnPath(): string {
  const raw = sessionStorage.getItem(RETURN_TO_KEY)
  sessionStorage.removeItem(RETURN_TO_KEY)
  if (
    raw &&
    raw.length <= 2048 &&
    !/\s/.test(raw) &&
    /^\/(?![/\\])/.test(raw) &&
    !raw.startsWith('/callback')
  ) {
    return raw
  }
  return '/'
}

// No signature verification: the token arrives directly from Cognito over TLS to this
// app, so there's no third party to verify it against.
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
  // atob gives a binary string (one char per byte) -- decode it as UTF-8 bytes rather
  // than handing it straight to JSON.parse, or non-ASCII claims (e.g. accented names)
  // come out mojibake'd.
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

function extractDisplayName(idToken: string): string {
  const claims = decodeJwtPayload(idToken)

  const givenName = typeof claims.given_name === 'string' ? claims.given_name.trim() : ''
  if (givenName) return givenName

  const fullName = typeof claims.name === 'string' ? claims.name.trim() : ''
  if (fullName) return fullName.split(/\s+/)[0]

  const email = typeof claims.email === 'string' ? claims.email : ''
  if (email.includes('@')) return email.split('@')[0]

  return 'there'
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) throw new Error(`Token request failed: ${response.status}`)
  return (await response.json()) as TokenResponse
}

function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  )
}

function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  )
}

function buildSession(tokens: TokenResponse, existingRefreshToken: string): StoredSession {
  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    // Cognito's refresh grant doesn't return a new refresh_token (no rotation configured) --
    // keep reusing the original one.
    refreshToken: tokens.refresh_token ?? existingRefreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    displayName: extractDisplayName(tokens.id_token),
  }
}

// Refreshes and persists a session, or clears it on failure (refresh token itself
// expired after 30 days, or a network error) -- returns null in that case so the
// caller can fall back cleanly to logged-out rather than looping or leaving stale
// tokens around. Shared by the scheduled-timer path and the near-expiry-on-mount path.
async function performRefresh(session: StoredSession): Promise<StoredSession | null> {
  try {
    const tokens = await refreshTokens(session.refreshToken)
    const next = buildSession(tokens, session.refreshToken)
    saveSession(next)
    return next
  } catch {
    clearSession()
    return null
  }
}

function scheduleRefresh(session: StoredSession) {
  clearTimeout(refreshTimeoutId)
  const delay = Math.max(0, session.expiresAt - Date.now() - REFRESH_LEEWAY_MS)
  refreshTimeoutId = setTimeout(async () => {
    const next = await performRefresh(session)
    notify(next)
    if (next) scheduleRefresh(next)
  }, delay)
}

async function handleCallback() {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  const expectedState = sessionStorage.getItem(STATE_KEY)
  // Read + delete synchronously, before any await: React 19 StrictMode double-invokes
  // mount effects in dev, and an authorization code is single-use. The second
  // invocation finds nothing here and no-ops instead of double-spending the code.
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)

  const params = new URLSearchParams(window.location.search)
  const returnPath = takeReturnPath()
  // Rewrite the URL off /callback *before* notify(): notify re-renders App,
  // and useRoute reads window.location synchronously during that render
  // (replaceState fires no popstate, so there's no second chance to
  // correct it). Every branch below navigates first, then notifies.
  const navigateBack = () => window.history.replaceState(null, '', returnPath)

  if (!verifier || !expectedState || params.get('state') !== expectedState || !params.get('code')) {
    navigateBack()
    notify(loadSession())
    return
  }

  try {
    const tokens = await exchangeCode(params.get('code')!, verifier)
    const session = buildSession(tokens, '')
    saveSession(session)
    scheduleRefresh(session)
    navigateBack()
    notify(session)
  } catch (err) {
    console.error('Login failed', err)
    navigateBack()
    notify(loadSession())
  }
}

async function initFromStoredSession() {
  const session = loadSession()
  if (!session) {
    notify(null)
    return
  }

  if (session.expiresAt - Date.now() < REFRESH_LEEWAY_MS) {
    const next = await performRefresh(session)
    if (next) scheduleRefresh(next)
    notify(next)
    return
  }

  scheduleRefresh(session)
  notify(session)
}

// Cognito's hosted logout doesn't revoke the refresh token, so a background tab's
// already-scheduled refresh timer would otherwise keep firing after logout and silently
// repopulate localStorage. React to the other tab's localStorage change instead of
// waiting for that timer: clear this tab's timer and mirror the new state immediately.
function handleStorageEvent(event: StorageEvent) {
  if (event.key !== SESSION_KEY) return
  clearTimeout(refreshTimeoutId)
  if (!event.newValue) {
    notify(null)
    return
  }
  try {
    const session = JSON.parse(event.newValue) as StoredSession
    scheduleRefresh(session)
    notify(session)
  } catch {
    notify(null)
  }
}

let initialized = false
function ensureInitialized() {
  if (initialized) return
  initialized = true
  window.addEventListener('storage', handleStorageEvent)
  if (window.location.pathname === '/callback') {
    void handleCallback()
  } else {
    void initFromStoredSession()
  }
}

export function useAuth() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession())
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const subscriber = (next: StoredSession | null) => {
      setSession(next)
      setIsLoading(false)
    }
    subscribers.push(subscriber)
    ensureInitialized()
    return () => {
      subscribers = subscribers.filter((s) => s !== subscriber)
    }
  }, [])

  const login = useCallback(async () => {
    const { verifier, challenge } = await createPkcePair()
    const state = generateState()
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    sessionStorage.setItem(STATE_KEY, state)
    rememberReturnPath()
    window.location.href = buildLoginUrl(challenge, state)
  }, [])

  const logout = useCallback(() => {
    clearSession()
    notify(null)
    window.location.href = buildLogoutUrl()
  }, [])

  return {
    displayName: session?.displayName ?? null,
    isLoading,
    login,
    logout,
  }
}
