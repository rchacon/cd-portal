import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth/session'
import { LookupForm } from './components/LookupForm'
import { MemberDetailPage } from './components/MemberDetailPage'
import { SettingsOverlay } from './components/SettingsOverlay'
import { UserMenu } from './components/UserMenu'
import { useRoute } from './lib/router'

function App() {
  const { displayName, isLoading, login, logout } = useAuth()
  const route = useRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  // Mount LookupForm lazily, on the first visit to / -- then keep it
  // mounted (hidden) from then on, so a later trip to a member and back
  // preserves it. A cold load straight at /member/:bioguideId (a shared
  // link, a crawler, a social-link preview) never needs the search form,
  // so it shouldn't pay for LookupForm's getStates() call.
  const [searchMounted, setSearchMounted] = useState(route.name === 'home')
  useEffect(() => {
    if (route.name === 'home') setSearchMounted(true)
  }, [route.name])

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-navy-900 to-navy-950">
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <a href="https://civicdog.com" className="flex items-center gap-3">
          <picture>
            <source srcSet="/logo/civicdog-mark-white-bg.webp" type="image/webp" />
            <img
              src="/logo/civicdog-mark-white-bg.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8"
            />
          </picture>
          <span className="text-lg font-bold tracking-tight">
            <span className="text-white">Civic</span>
            <span className="text-blue-400">Dog</span>
          </span>
        </a>

        {!isLoading &&
          (displayName ? (
            <UserMenu
              name={displayName}
              onOpenSettings={() => setSettingsOpen(true)}
              onLogout={logout}
            />
          ) : (
            <button
              type="button"
              onClick={login}
              className="rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-400"
            >
              Log in / Sign up
            </button>
          ))}
      </header>

      <main className="flex-1 px-6 pb-16">
        {searchMounted && (
          <div hidden={route.name === 'member'}>
            <LookupForm />
          </div>
        )}
        {route.name === 'member' && (
          <MemberDetailPage key={route.bioguideId} bioguideId={route.bioguideId} />
        )}
      </main>

      <footer className="border-t border-white/10 px-6 py-6 text-xs text-blue-300">
        &copy; {new Date().getFullYear()} CivicDog. All rights reserved.
      </footer>

      {/* displayName-gated so the modal can't outlive the session (an
          expiry mid-view would otherwise leave it over a logged-out header). */}
      {settingsOpen && displayName && <SettingsOverlay onClose={closeSettings} />}
    </div>
  )
}

export default App
