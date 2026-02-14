/**
 * Domain Projects — project and issue tracking types.
 */

export interface Project {
  id: number
  title: string
  description: string
}

export interface Issue {
  id: number
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: Label[]
  milestone: Milestone | null
  html_url: string
  repository: { name: string; owner: string; full_name: string }
}

export interface Label {
  id: number
  name: string
  color: string
  description: string
}

export interface Milestone {
  id: number
  title: string
  description: string
  state: 'open' | 'closed'
}

export interface PullRequest {
  id: number
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  merged: boolean
  head: { ref: string }
  base: { ref: string }
  html_url: string
}
