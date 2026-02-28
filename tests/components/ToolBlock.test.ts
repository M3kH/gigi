/**
 * ToolBlock component tests
 *
 * Collapsible tool execution block showing name, summary, status, and
 * expandable input/output.
 */
import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ToolBlock from '$components/chat/ToolBlock.svelte'

describe('ToolBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the tool name', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'ls -la' },
        status: 'done',
      },
    })
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('renders the tool summary from input', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'git status' },
        status: 'done',
      },
    })
    expect(screen.getByText('git status')).toBeInTheDocument()
  })

  it('renders the tool description when provided', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        description: 'Check git status',
        input: { command: 'git status' },
        status: 'done',
      },
    })
    expect(screen.getByText('Check git status')).toBeInTheDocument()
  })

  it('shows running status', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'npm install' },
        status: 'running',
        startedAt: Date.now(),
      },
    })
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('shows done status', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
        status: 'done',
      },
    })
    expect(screen.getByText('done')).toBeInTheDocument()
  })

  it('applies running CSS class', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: {},
        status: 'running',
        startedAt: Date.now(),
      },
    })
    const statusEl = screen.getByText('running')
    expect(statusEl).toHaveClass('running')
  })

  it('applies done CSS class', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Read',
        input: { file_path: '/test.ts' },
        status: 'done',
      },
    })
    const statusEl = screen.getByText('done')
    expect(statusEl).toHaveClass('done')
  })

  it('expands to show input on click', async () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
        status: 'done',
      },
    })

    expect(screen.queryByText('Input')).not.toBeInTheDocument()

    await fireEvent.click(screen.getByText('Bash'))
    expect(screen.getByText('Input')).toBeInTheDocument()
  })

  it('shows output when expanded and result is present', async () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
        result: 'hello',
        status: 'done',
      },
    })

    await fireEvent.click(screen.getByText('Bash'))
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('shows "(no output)" when result is empty string', async () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'true' },
        result: '',
        status: 'done',
      },
    })

    await fireEvent.click(screen.getByText('Bash'))
    expect(screen.getByText('(no output)')).toBeInTheDocument()
  })

  it('does not show Output section when result is undefined', async () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
        status: 'running',
        startedAt: Date.now(),
      },
    })

    await fireEvent.click(screen.getByText('Bash'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.queryByText('Output')).not.toBeInTheDocument()
  })

  it('collapses on second click', async () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input: { command: 'echo hello' },
        status: 'done',
      },
    })

    // Expand
    await fireEvent.click(screen.getByText('Bash'))
    expect(screen.getByText('Input')).toBeInTheDocument()

    // Collapse
    await fireEvent.click(screen.getByText('Bash'))
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('generates correct summary for Read tool', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Read',
        input: { file_path: '/workspace/gigi/src/index.ts' },
        status: 'done',
      },
    })
    expect(screen.getByText('/workspace/gigi/src/index.ts')).toBeInTheDocument()
  })

  it('generates correct summary for Grep tool', () => {
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Grep',
        input: { pattern: 'TODO' },
        status: 'done',
      },
    })
    expect(screen.getByText('TODO')).toBeInTheDocument()
  })

  it('formats input as JSON in expanded view', async () => {
    const input = { command: 'ls', description: 'list files' }
    render(ToolBlock, {
      props: {
        toolUseId: 'tool-1',
        name: 'Bash',
        input,
        status: 'done',
      },
    })

    await fireEvent.click(screen.getByText('Bash'))
    // Should contain prettified JSON
    const pre = document.querySelector('.tool-pre')
    expect(pre?.textContent).toContain('"command": "ls"')
    expect(pre?.textContent).toContain('"description": "list files"')
  })
})
