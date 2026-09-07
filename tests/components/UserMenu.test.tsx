import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserMenu } from '../../src/components/UserMenu'

function setup() {
  const onOpenSettings = vi.fn()
  const onLogout = vi.fn()
  render(<UserMenu name="Ada" onOpenSettings={onOpenSettings} onLogout={onLogout} />)
  return { user: userEvent.setup(), onOpenSettings, onLogout }
}

describe('UserMenu', () => {
  it('shows the name and toggles the menu on click', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: /ada/i })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"Usage" calls onOpenSettings and closes the menu', async () => {
    const { user, onOpenSettings } = setup()
    await user.click(screen.getByRole('button', { name: /ada/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Usage' }))

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"Log out" calls onLogout', async () => {
    const { user, onLogout } = setup()
    await user.click(screen.getByRole('button', { name: /ada/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))

    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and on an outside click', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: /ada/i })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
