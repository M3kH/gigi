/**
 * ConnectionStatus component tests
 *
 * Renders a status dot reflecting WebSocket connection state:
 * green=connected, orange=connecting/reconnecting, red=disconnected.
 */
import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import ConnectionStatus from '$components/ui/ConnectionStatus.svelte'

describe('ConnectionStatus', () => {
  it('renders with connected state', () => {
    render(ConnectionStatus, { props: { state: 'connected' } })
    const dot = document.querySelector('.status-dot')
    expect(dot).toHaveClass('connected')
    expect(dot).not.toHaveClass('connecting')
    expect(dot).not.toHaveClass('disconnected')
  })

  it('renders with connecting state', () => {
    render(ConnectionStatus, { props: { state: 'connecting' } })
    const dot = document.querySelector('.status-dot')
    expect(dot).toHaveClass('connecting')
    expect(dot).not.toHaveClass('connected')
  })

  it('renders with reconnecting state (same class as connecting)', () => {
    render(ConnectionStatus, { props: { state: 'reconnecting' } })
    const dot = document.querySelector('.status-dot')
    expect(dot).toHaveClass('connecting')
  })

  it('renders with disconnected state', () => {
    render(ConnectionStatus, { props: { state: 'disconnected' } })
    const dot = document.querySelector('.status-dot')
    expect(dot).toHaveClass('disconnected')
    expect(dot).not.toHaveClass('connected')
  })

  it('shows correct title attribute', () => {
    render(ConnectionStatus, { props: { state: 'connected' } })
    const wrapper = screen.getByTitle('WebSocket: connected')
    expect(wrapper).toBeInTheDocument()
  })

  it('updates title for different states', () => {
    render(ConnectionStatus, { props: { state: 'disconnected' } })
    const wrapper = screen.getByTitle('WebSocket: disconnected')
    expect(wrapper).toBeInTheDocument()
  })
})
