import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

const menuItemClass =
  'flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-left text-sm text-blue-100 transition-colors hover:bg-white/10 hover:text-white'

const iconClass = 'h-4 w-4 shrink-0 text-blue-300'

function UsageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={iconClass}
    >
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={iconClass}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

// First initial(s) of the display name, for the avatar chip.
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  )
}

// The header username, as a dropdown: "Usage" opens the settings overlay,
// "Log out" ends the session. Hand-rolled (no menu library, matching the
// rest of src/): closes on Escape, outside click, or picking an item;
// focus moves into the menu on open and back to the trigger on Escape /
// outside click.
export function UserMenu({
  name,
  onOpenSettings,
  onLogout,
}: {
  name: string
  onOpenSettings: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    function onMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Arrow keys move between the two items, as a role="menu" is expected to.
  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1
    items[(next + items.length) % items.length]?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-blue-100 ring-1 ring-white/15"
        >
          {initials(name)}
        </span>
        {name}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-blue-300 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5.5 7.5 10 12l4.5-4.5" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 mt-1 min-w-40 rounded-lg bg-navy-800 p-1 ring-1 ring-white/15 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              // Land focus back on the trigger before the overlay mounts,
              // so it captures a real element to restore focus to on close.
              triggerRef.current?.focus()
              onOpenSettings()
            }}
            className={menuItemClass}
          >
            <UsageIcon />
            Usage
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className={menuItemClass}
          >
            <LogOutIcon />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
