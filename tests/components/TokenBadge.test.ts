/**
 * TokenBadge component tests
 *
 * Collapsible badge showing token usage with click-to-expand breakdown.
 */
import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import TokenBadge from '$components/chat/TokenBadge.svelte'
import type { TokenUsage } from '$lib/types/chat'

function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    ...overrides,
  }
}

describe('TokenBadge', () => {
  it('renders total token count', () => {
    render(TokenBadge, { props: { usage: makeUsage() } })
    // 1000 + 500 = 1500 → "1.5K tk"
    expect(screen.getByText(/1\.5K tk/)).toBeInTheDocument()
  })

  it('does not render when total is 0', () => {
    const { container } = render(TokenBadge, {
      props: { usage: makeUsage({ inputTokens: 0, outputTokens: 0 }) },
    })
    expect(container.querySelector('.token-badge')).not.toBeInTheDocument()
  })

  it('handles undefined token values gracefully', () => {
    const { container } = render(TokenBadge, {
      props: { usage: { inputTokens: undefined, outputTokens: undefined } as TokenUsage },
    })
    // 0 + 0 = 0 → should not render
    expect(container.querySelector('.token-badge')).not.toBeInTheDocument()
  })

  it('shows cost when costUSD is present', () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ costUSD: 0.05 }) },
    })
    expect(screen.getByText(/\$0\.05/)).toBeInTheDocument()
  })

  it('shows <$0.01 for very small costs', () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ costUSD: 0.001 }) },
    })
    expect(screen.getByText(/<\$0\.01/)).toBeInTheDocument()
  })

  it('does not show cost when costUSD is not set', () => {
    render(TokenBadge, {
      props: { usage: makeUsage() },
    })
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('expands to show details on click', async () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ costUSD: 0.10 }) },
    })

    // Details should not be visible initially
    expect(screen.queryByText('Input')).not.toBeInTheDocument()

    // Click to expand
    await fireEvent.click(screen.getByText(/1\.5K tk/))

    // Details should now be visible
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('Cost')).toBeInTheDocument()
  })

  it('collapses details on second click', async () => {
    render(TokenBadge, {
      props: { usage: makeUsage() },
    })

    const badge = screen.getByText(/1\.5K tk/)

    // Expand
    await fireEvent.click(badge)
    expect(screen.getByText('Input')).toBeInTheDocument()

    // Collapse
    await fireEvent.click(badge)
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('shows cache read tokens when present', async () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ cacheReadInputTokens: 2000 }) },
    })

    // Total is still inputTokens(1000) + outputTokens(500) = 1500 → "1.5K tk"
    // cacheReadInputTokens is metadata, not counted in the badge total
    await fireEvent.click(screen.getByText(/1\.5K tk/))
    expect(screen.getByText('Cache read')).toBeInTheDocument()
  })

  it('shows cache write tokens when present', async () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ cacheCreationInputTokens: 500 }) },
    })

    await fireEvent.click(screen.getByText(/1\.5K tk/))
    expect(screen.getByText('Cache write')).toBeInTheDocument()
  })

  it('does not show cache rows when not present', async () => {
    render(TokenBadge, { props: { usage: makeUsage() } })

    await fireEvent.click(screen.getByText(/1\.5K tk/))
    expect(screen.queryByText('Cache read')).not.toBeInTheDocument()
    expect(screen.queryByText('Cache write')).not.toBeInTheDocument()
  })

  it('shows duration when present', async () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ durationMs: 5500 }) },
    })

    await fireEvent.click(screen.getByText(/1\.5K tk/))
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('5.5s')).toBeInTheDocument()
  })

  it('shows turns when present', async () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ numTurns: 3 }) },
    })

    await fireEvent.click(screen.getByText(/1\.5K tk/))
    expect(screen.getByText('Turns')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('formats large token counts correctly', () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ inputTokens: 1_500_000, outputTokens: 500_000 }) },
    })
    // 2M tokens
    expect(screen.getByText(/2\.0M tk/)).toBeInTheDocument()
  })

  it('formats small token counts without abbreviation', () => {
    render(TokenBadge, {
      props: { usage: makeUsage({ inputTokens: 50, outputTokens: 25 }) },
    })
    expect(screen.getByText(/75 tk/)).toBeInTheDocument()
  })
})
