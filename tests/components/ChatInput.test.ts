/**
 * ChatInput component tests
 *
 * Text input with auto-resize, Enter-to-send (desktop), draft persistence,
 * and per-conversation draft loading.
 */
import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChatInput from '$components/chat/ChatInput.svelte'

// Mock the draft utilities — we don't want real localStorage side-effects
vi.mock('$lib/utils/draft', () => ({
  saveDraft: vi.fn(),
  loadDraft: vi.fn(() => null),
  clearDraft: vi.fn(),
  cleanStaleDrafts: vi.fn(),
}))

// Mock responsive helper — default to desktop (not mobile)
vi.mock('$lib/actions/responsive.svelte', () => ({
  getIsMobile: vi.fn(() => false),
}))

import { saveDraft, clearDraft, loadDraft } from '$lib/utils/draft'
import { getIsMobile } from '$lib/actions/responsive.svelte'

describe('ChatInput', () => {
  let sendFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendFn = vi.fn()
    vi.clearAllMocks()
  })

  it('renders the textarea with default placeholder', () => {
    render(ChatInput, { props: { onsend: sendFn } })
    expect(screen.getByPlaceholderText('Message Gigi...')).toBeInTheDocument()
  })

  it('renders with custom placeholder', () => {
    render(ChatInput, { props: { onsend: sendFn, placeholder: 'Type here...' } })
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument()
  })

  it('renders the send button', () => {
    render(ChatInput, { props: { onsend: sendFn } })
    expect(screen.getByTitle('Send message')).toBeInTheDocument()
  })

  it('disables send button when input is empty', () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const sendBtn = screen.getByTitle('Send message')
    expect(sendBtn).toBeDisabled()
  })

  it('enables send button when input has text', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: 'Hello' } })
    const sendBtn = screen.getByTitle('Send message')
    expect(sendBtn).not.toBeDisabled()
  })

  it('calls onsend when send button is clicked', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: 'Hello world' } })
    await fireEvent.click(screen.getByTitle('Send message'))
    expect(sendFn).toHaveBeenCalledWith('Hello world')
  })

  it('clears input after sending', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...') as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'Hello' } })
    await fireEvent.click(screen.getByTitle('Send message'))
    expect(textarea.value).toBe('')
  })

  it('calls onsend on Enter key (desktop)', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: 'Hello' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(sendFn).toHaveBeenCalledWith('Hello')
  })

  it('does not send on Shift+Enter (allows newline)', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: 'Hello' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('does not send on Enter when on mobile', async () => {
    vi.mocked(getIsMobile).mockReturnValue(true)
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: 'Hello' } })
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('does not send empty/whitespace messages', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: '   ' } })
    await fireEvent.click(screen.getByTitle('Send message'))
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('disables textarea when disabled prop is true', () => {
    render(ChatInput, { props: { onsend: sendFn, disabled: true } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    expect(textarea).toBeDisabled()
  })

  it('clears draft after sending', async () => {
    render(ChatInput, { props: { onsend: sendFn, conversationId: 'conv-1' } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: 'Hello' } })
    await fireEvent.click(screen.getByTitle('Send message'))
    expect(clearDraft).toHaveBeenCalledWith(localStorage, 'conv-1')
  })

  it('trims whitespace before sending', async () => {
    render(ChatInput, { props: { onsend: sendFn } })
    const textarea = screen.getByPlaceholderText('Message Gigi...')
    await fireEvent.input(textarea, { target: { value: '  Hello world  ' } })
    await fireEvent.click(screen.getByTitle('Send message'))
    expect(sendFn).toHaveBeenCalledWith('Hello world')
  })
})
