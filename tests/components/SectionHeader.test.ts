/**
 * SectionHeader component tests
 *
 * Reusable header with icon and optional title.
 */
import { render, screen } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import SectionHeader from '$components/ui/SectionHeader.svelte'

describe('SectionHeader', () => {
  it('renders the icon', () => {
    render(SectionHeader, { props: { icon: '📋' } })
    expect(screen.getByText('📋')).toBeInTheDocument()
  })

  it('renders the title when provided', () => {
    render(SectionHeader, { props: { icon: '📋', title: 'Kanban' } })
    expect(screen.getByText('Kanban')).toBeInTheDocument()
  })

  it('renders title as an h2 heading', () => {
    render(SectionHeader, { props: { icon: '📋', title: 'Kanban' } })
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Kanban')
  })

  it('does not render heading when title is omitted', () => {
    render(SectionHeader, { props: { icon: '🔧' } })
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders with different icons', () => {
    render(SectionHeader, { props: { icon: '💬', title: 'Chat' } })
    expect(screen.getByText('💬')).toBeInTheDocument()
    expect(screen.getByText('Chat')).toBeInTheDocument()
  })

  it('renders the header element', () => {
    render(SectionHeader, { props: { icon: '📋', title: 'Test' } })
    const header = document.querySelector('.section-header')
    expect(header).toBeInTheDocument()
  })
})
