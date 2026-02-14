/**
 * Formatting utilities for tokens, costs, time, and tool summaries.
 */

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function formatCost(usd: number | null | undefined): string | null {
  if (!usd) return null
  if (usd < 0.01) return '<$0.01'
  return '$' + usd.toFixed(2)
}

export function formatTime(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  if (isToday) return timeStr
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${timeStr}`
}

export function formatElapsed(startedAt: number): string {
  return Math.floor((Date.now() - startedAt) / 1000) + 's'
}

/**
 * Generate a short summary for a tool invocation.
 */
export function toolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const inp = input as Record<string, any>

  switch (name) {
    case 'Bash':
    case 'bash':
      return (inp.command || '').slice(0, 80)
    case 'Read':
    case 'read_file':
      return inp.file_path || inp.path || ''
    case 'Write':
    case 'write_file':
      return inp.file_path || inp.path || ''
    case 'Edit':
      return inp.file_path || ''
    case 'Grep':
    case 'grep':
      return inp.pattern || ''
    case 'Glob':
    case 'glob':
      return inp.pattern || ''
    case 'WebFetch':
      return inp.url || ''
    case 'Task':
      return inp.description || ''
    default:
      return JSON.stringify(input).slice(0, 80)
  }
}
