/**
 * Markdown rendering utility
 *
 * Configures marked.js with highlight.js for syntax highlighting.
 */

import { Marked } from 'marked'
import hljs from 'highlight.js/lib/core'

// Register languages
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import go from 'highlight.js/lib/languages/go'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import diff from 'highlight.js/lib/languages/diff'
import markdown from 'highlight.js/lib/languages/markdown'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('go', go)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('svelte', xml) // close enough

const marked = new Marked({
  breaks: true,
  gfm: true,
})

/**
 * Render markdown to HTML with syntax-highlighted code blocks.
 */
export function renderMarkdown(text: string): string {
  if (!text) return ''
  const html = marked.parse(text)
  if (typeof html !== 'string') return ''
  return html
}

/**
 * Highlight a code block (used after DOM mount).
 */
export function highlightElement(el: HTMLElement): void {
  hljs.highlightElement(el)
}

/**
 * Highlight all code blocks within a container after rendering.
 */
export function highlightAll(container: HTMLElement): void {
  const blocks = container.querySelectorAll<HTMLElement>('pre code')
  blocks.forEach((block) => {
    if (!block.dataset.highlighted) {
      hljs.highlightElement(block)
    }
  })
}
