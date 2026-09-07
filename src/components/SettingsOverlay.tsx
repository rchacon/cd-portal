import { useEffect, useRef, useState } from 'react'
import { UsageSection } from './UsageSection'

// One nav item today; add an entry to grow the left rail.
const SECTIONS = [{ id: 'usage', label: 'Usage', Component: UsageSection }] as const
type SectionId = (typeof SECTIONS)[number]['id']

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// The settings modal: fixed, the app blurred behind it, a left nav and a
// main pane. Hand-rolled (no modal library): closes on Escape, the ✕, or
// a backdrop click; focus is moved to the ✕ on open, trapped within the
// dialog, and restored to whatever was focused before on close.
export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState<SectionId>('usage')
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!items || items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreTo?.focus()
    }
  }, [onClose])

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-navy-900 shadow-2xl ring-1 ring-white/15"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-300">Settings</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-blue-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-40 shrink-0 border-r border-white/10 p-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                aria-current={s.id === activeId ? 'page' : undefined}
                className={`block w-full rounded px-3 py-1.5 text-left text-sm transition-colors ${
                  s.id === activeId
                    ? 'bg-white/10 font-medium text-white'
                    : 'text-blue-200 hover:bg-white/5 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <active.Component />
          </div>
        </div>
      </div>
    </div>
  )
}
