/**
 * SystemMessage component tests
 *
 * Simple banner that displays system event text with an info icon.
 */
import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import SystemMessage from '$components/chat/SystemMessage.svelte'

describe('SystemMessage', () => {
  it('renders the text content', () => {
    render(SystemMessage, { props: { text: 'Webhook received from Gitea' } })
    expect(screen.getByText('Webhook received from Gitea')).toBeInTheDocument()
  })

  it('renders the info icon', () => {
    render(SystemMessage, { props: { text: 'Something happened' } })
    expect(screen.getByText('i')).toBeInTheDocument()
  })

  it('applies system-text class with italic styling', () => {
    render(SystemMessage, { props: { text: 'Test event' } })
    const textEl = screen.getByText('Test event')
    expect(textEl).toHaveClass('system-text')
  })

  it('renders different messages correctly', () => {
    const { unmount } = render(SystemMessage, { props: { text: 'First message' } })
    expect(screen.getByText('First message')).toBeInTheDocument()
    unmount()

    render(SystemMessage, { props: { text: 'Second message' } })
    expect(screen.getByText('Second message')).toBeInTheDocument()
  })

  it('handles empty text', () => {
    render(SystemMessage, { props: { text: '' } })
    // The component should still render, just with empty text
    const icon = screen.getByText('i')
    expect(icon).toBeInTheDocument()
  })

  it('handles text with special characters', () => {
    render(SystemMessage, { props: { text: 'PR #42 merged → deploy started' } })
    expect(screen.getByText('PR #42 merged → deploy started')).toBeInTheDocument()
  })
})
