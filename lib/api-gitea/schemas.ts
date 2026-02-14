/**
 * Gitea API — Zod Schemas
 *
 * Typed response schemas for all Gitea REST API entities.
 * Parsed at runtime for safety — no more `as` casts on raw JSON.
 */

import { z } from 'zod'

// ─── Primitives ──────────────────────────────────────────────────────

export const Timestamp = z.string().datetime({ offset: true }).or(z.string())

// ─── User ────────────────────────────────────────────────────────────

export const User = z.object({
  id: z.number(),
  login: z.string(),
  full_name: z.string().optional().default(''),
  email: z.string().optional().default(''),
  avatar_url: z.string().optional().default(''),
  html_url: z.string().optional().default(''),
  is_admin: z.boolean().optional().default(false),
})
export type User = z.infer<typeof User>

// ─── Organization ────────────────────────────────────────────────────

export const Organization = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string().optional().default(''),
  avatar_url: z.string().optional().default(''),
  description: z.string().optional().default(''),
  website: z.string().optional().default(''),
  location: z.string().optional().default(''),
  visibility: z.string().optional().default('public'),
})
export type Organization = z.infer<typeof Organization>

// ─── Label ───────────────────────────────────────────────────────────

export const Label = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string().optional().default(''),
  description: z.string().optional().default(''),
  exclusive: z.boolean().optional().default(false),
  is_archived: z.boolean().optional().default(false),
  url: z.string().optional().default(''),
})
export type Label = z.infer<typeof Label>

// ─── Milestone ───────────────────────────────────────────────────────

export const Milestone = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().optional().default(''),
  state: z.string().optional().default('open'),
  open_issues: z.number().optional().default(0),
  closed_issues: z.number().optional().default(0),
  created_at: Timestamp.optional(),
  updated_at: Timestamp.optional(),
  closed_at: Timestamp.nullable().optional(),
  due_on: Timestamp.nullable().optional(),
})
export type Milestone = z.infer<typeof Milestone>

// ─── Repository ──────────────────────────────────────────────────────

export const Repository = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: User,
  description: z.string().optional().default(''),
  private: z.boolean().optional().default(false),
  fork: z.boolean().optional().default(false),
  html_url: z.string().optional().default(''),
  clone_url: z.string().optional().default(''),
  ssh_url: z.string().optional().default(''),
  default_branch: z.string().optional().default('main'),
  stars_count: z.number().optional().default(0),
  forks_count: z.number().optional().default(0),
  open_issues_count: z.number().optional().default(0),
  archived: z.boolean().optional().default(false),
  created_at: Timestamp.optional(),
  updated_at: Timestamp.optional(),
})
export type Repository = z.infer<typeof Repository>

// ─── File Content ────────────────────────────────────────────────────

export const FileContent = z.object({
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  type: z.string(),
  size: z.number().optional().default(0),
  encoding: z.string().optional().default(''),
  content: z.string().optional().default(''),
  download_url: z.string().optional().default(''),
  html_url: z.string().optional().default(''),
  url: z.string().optional().default(''),
})
export type FileContent = z.infer<typeof FileContent>

export const FileResponse = z.object({
  content: FileContent.nullable().optional(),
  commit: z.object({
    sha: z.string(),
    message: z.string(),
  }).optional(),
})
export type FileResponse = z.infer<typeof FileResponse>

// ─── Issue ───────────────────────────────────────────────────────────

export const Issue = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  body: z.string().optional().default(''),
  state: z.string(),
  user: User.optional(),
  labels: z.array(Label).optional().default([]),
  assignee: User.nullable().optional(),
  assignees: z.array(User).nullable().optional(),
  milestone: Milestone.nullable().optional(),
  comments: z.number().optional().default(0),
  html_url: z.string().optional().default(''),
  created_at: Timestamp.optional(),
  updated_at: Timestamp.optional(),
  closed_at: Timestamp.nullable().optional(),
  pull_request: z.unknown().nullable().optional(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    owner: z.string(),
    full_name: z.string(),
  }).optional(),
})
export type Issue = z.infer<typeof Issue>

// ─── Comment ─────────────────────────────────────────────────────────

export const Comment = z.object({
  id: z.number(),
  body: z.string(),
  user: User.optional(),
  html_url: z.string().optional().default(''),
  created_at: Timestamp.optional(),
  updated_at: Timestamp.optional(),
})
export type Comment = z.infer<typeof Comment>

// ─── Pull Request ────────────────────────────────────────────────────

export const PullRequest = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  body: z.string().optional().default(''),
  state: z.string(),
  user: User.optional(),
  labels: z.array(Label).optional().default([]),
  assignee: User.nullable().optional(),
  assignees: z.array(User).nullable().optional(),
  milestone: Milestone.nullable().optional(),
  head: z.object({
    ref: z.string(),
    sha: z.string().optional().default(''),
    label: z.string().optional().default(''),
    repo: Repository.optional(),
  }).optional(),
  base: z.object({
    ref: z.string(),
    sha: z.string().optional().default(''),
    label: z.string().optional().default(''),
    repo: Repository.optional(),
  }).optional(),
  merged: z.boolean().optional().default(false),
  mergeable: z.boolean().nullable().optional(),
  merged_by: User.nullable().optional(),
  html_url: z.string().optional().default(''),
  diff_url: z.string().optional().default(''),
  comments: z.number().optional().default(0),
  created_at: Timestamp.optional(),
  updated_at: Timestamp.optional(),
  closed_at: Timestamp.nullable().optional(),
  merged_at: Timestamp.nullable().optional(),
})
export type PullRequest = z.infer<typeof PullRequest>

// ─── Project Board ───────────────────────────────────────────────────

export const ProjectColumn = z.object({
  id: z.number(),
  title: z.string(),
  sorting: z.number().optional().default(0),
  color: z.string().optional().default(''),
})
export type ProjectColumn = z.infer<typeof ProjectColumn>

export const ProjectCard = z.object({
  id: z.number(),
  issue: z.object({
    id: z.number().optional(),
    number: z.number(),
    title: z.string().optional().default(''),
    repository: z.object({
      name: z.string(),
      full_name: z.string().optional().default(''),
    }).optional(),
  }),
})
export type ProjectCard = z.infer<typeof ProjectCard>

export const Project = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().optional().default(''),
  board_type: z.number().optional().default(0),
  created_at: Timestamp.optional(),
  updated_at: Timestamp.optional(),
})
export type Project = z.infer<typeof Project>

// ─── Branch ──────────────────────────────────────────────────────────

export const Branch = z.object({
  name: z.string(),
  commit: z.object({
    id: z.string(),
    message: z.string().optional().default(''),
    url: z.string().optional().default(''),
    timestamp: Timestamp.optional(),
  }).optional(),
  protected: z.boolean().optional().default(false),
})
export type Branch = z.infer<typeof Branch>

// ─── API Error ───────────────────────────────────────────────────────

export const GiteaErrorResponse = z.object({
  message: z.string().optional().default('Unknown error'),
  url: z.string().optional().default(''),
})
export type GiteaErrorResponse = z.infer<typeof GiteaErrorResponse>
