/**
 * ChannelBadge component tests
 *
 * Renders a small colored badge showing the message channel origin.
 */
import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import ChannelBadge from '$components/chat/ChannelBadge.svelte'

describe('ChannelBadge', () => {
  it('renders the web channel correctly', () => {
    render(ChannelBadge, { props: { channel: 'web' } })
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(screen.getByText('💬')).toBeInTheDocument()
  })

  it('renders the telegram channel', () => {
    render(ChannelBadge, { props: { channel: 'telegram' } })
    expect(screen.getByText('Telegram')).toBeInTheDocument()
    expect(screen.getByText('📱')).toBeInTheDocument()
  })

  it('renders the gitea_comment channel', () => {
    render(ChannelBadge, { props: { channel: 'gitea_comment' } })
    expect(screen.getByText('Gitea')).toBeInTheDocument()
  })

  it('renders the gitea_review channel', () => {
    render(ChannelBadge, { props: { channel: 'gitea_review' } })
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('👀')).toBeInTheDocument()
  })

  it('renders the webhook channel', () => {
    render(ChannelBadge, { props: { channel: 'webhook' } })
    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.getByText('⚡')).toBeInTheDocument()
  })

  it('renders the system channel', () => {
    render(ChannelBadge, { props: { channel: 'system' } })
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('⚙️')).toBeInTheDocument()
  })

  it('falls back to channel name for unknown channels', () => {
    render(ChannelBadge, { props: { channel: 'custom_channel' } })
    expect(screen.getByText('custom_channel')).toBeInTheDocument()
    // Falls back to web icon
    expect(screen.getByText('💬')).toBeInTheDocument()
  })

  it('shows direction arrow for outbound messages', () => {
    render(ChannelBadge, { props: { channel: 'telegram', direction: 'outbound' } })
    expect(screen.getByText('→')).toBeInTheDocument()
  })

  it('does not show direction arrow for inbound messages', () => {
    render(ChannelBadge, { props: { channel: 'telegram', direction: 'inbound' } })
    expect(screen.queryByText('→')).not.toBeInTheDocument()
  })

  it('does not show direction arrow when direction is omitted', () => {
    render(ChannelBadge, { props: { channel: 'web' } })
    expect(screen.queryByText('→')).not.toBeInTheDocument()
  })

  it('applies correct CSS class for telegram channel', () => {
    render(ChannelBadge, { props: { channel: 'telegram' } })
    const badge = document.querySelector('.channel-badge')
    expect(badge).toHaveClass('ch-telegram')
  })

  it('applies correct CSS class for gitea channel', () => {
    render(ChannelBadge, { props: { channel: 'gitea_comment' } })
    const badge = document.querySelector('.channel-badge')
    expect(badge).toHaveClass('ch-gitea')
  })

  it('shows outbound title tooltip', () => {
    render(ChannelBadge, { props: { channel: 'telegram', direction: 'outbound' } })
    const badge = document.querySelector('.channel-badge')
    expect(badge).toHaveAttribute('title', 'Telegram (outbound)')
  })

  it('shows inbound title tooltip without outbound marker', () => {
    render(ChannelBadge, { props: { channel: 'web' } })
    const badge = document.querySelector('.channel-badge')
    expect(badge).toHaveAttribute('title', 'Web')
  })
})
