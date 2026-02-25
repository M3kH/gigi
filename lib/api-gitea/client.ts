/**
 * Gitea API — Typed REST Client
 *
 * Functional, Zod-validated client for the Gitea REST API.
 * Thin wrapper — no business logic, just typed HTTP calls.
 *
 * Usage:
 *   const gitea = createGiteaClient('http://localhost:3300', token)
 *   const repos = await gitea.repos.list()
 *   const issue = await gitea.issues.get('gigi', 'gigi', 56)
 */

import { z } from 'zod'
import { GiteaApiError, GiteaNetworkError, GiteaParseError } from './errors'
import {
  Repository, FileContent, FileResponse,
  Issue, Comment, Label,
  PullRequest,
  ProjectColumn, ProjectCard,
  User, Organization, Branch,
} from './schemas'

// ─── HTTP Layer ──────────────────────────────────────────────────────

interface RequestOptions {
  method: string
  path: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** If true, return raw text instead of parsed JSON */
  raw?: boolean
}

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string => {
  const url = new URL(`/api/v1${path}`, baseUrl)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

const makeRequest = (baseUrl: string, token: string) =>
  async <T>(opts: RequestOptions & { schema?: z.ZodType<T> }): Promise<T> => {
    const url = buildUrl(baseUrl, opts.path, opts.query)
    const fetchOpts: RequestInit = {
      method: opts.method,
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    }
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body)

    let res: Response
    try {
      res = await fetch(url, fetchOpts)
    } catch (err) {
      throw new GiteaNetworkError(opts.path, err)
    }

    if (opts.raw) {
      if (!res.ok) throw new GiteaApiError(res.status, opts.path, await res.text().catch(() => null))
      return (await res.text()) as unknown as T
    }

    const data = await res.json().catch(() => null)
    if (!res.ok) throw new GiteaApiError(res.status, opts.path, data)

    if (opts.schema) {
      const parsed = opts.schema.safeParse(data)
      if (!parsed.success) throw new GiteaParseError(opts.path, data, parsed.error.format())
      return parsed.data
    }

    return data as T
  }

// ─── Client Factory ──────────────────────────────────────────────────

export interface GiteaClientConfig {
  baseUrl: string
  token: string
}

export const createGiteaClient = (baseUrl: string, token: string) => {
  const req = makeRequest(baseUrl, token)

  return {
    /** Raw request — escape hatch for uncovered endpoints */
    request: req,

    // ─── Repos ─────────────────────────────────────────────────

    repos: {
      /** List authenticated user's repos */
      list: (opts?: { limit?: number; page?: number }) =>
        req({ method: 'GET', path: '/user/repos', query: { limit: opts?.limit ?? 50, page: opts?.page }, schema: z.array(Repository) }),

      /** Get a single repo */
      get: (owner: string, name: string) =>
        req({ method: 'GET', path: `/repos/${owner}/${name}`, schema: Repository }),

      /** Create a repo for the authenticated user */
      create: (opts: { name: string; description?: string; private?: boolean; auto_init?: boolean; default_branch?: string }) =>
        req({ method: 'POST', path: '/user/repos', body: opts, schema: Repository }),

      /** Get file contents */
      getContents: (owner: string, name: string, filepath: string, ref?: string) =>
        req({ method: 'GET', path: `/repos/${owner}/${name}/contents/${filepath}`, query: { ref }, schema: FileContent }),

      /** Create a file */
      createFile: (owner: string, name: string, filepath: string, opts: { content: string; message: string; branch?: string }) =>
        req({ method: 'POST', path: `/repos/${owner}/${name}/contents/${filepath}`, body: { ...opts, content: Buffer.from(opts.content).toString('base64') }, schema: FileResponse }),

      /** Update a file */
      updateFile: (owner: string, name: string, filepath: string, opts: { content: string; message: string; sha: string; branch?: string }) =>
        req({ method: 'PUT', path: `/repos/${owner}/${name}/contents/${filepath}`, body: { ...opts, content: Buffer.from(opts.content).toString('base64') }, schema: FileResponse }),

      /** Delete a file */
      deleteFile: (owner: string, name: string, filepath: string, opts: { sha: string; message: string; branch?: string }) =>
        req({ method: 'DELETE', path: `/repos/${owner}/${name}/contents/${filepath}`, body: opts, schema: FileResponse }),

      /** List branches */
      listBranches: (owner: string, name: string) =>
        req({ method: 'GET', path: `/repos/${owner}/${name}/branches`, schema: z.array(Branch) }),

      /** Get a branch */
      getBranch: (owner: string, name: string, branch: string) =>
        req({ method: 'GET', path: `/repos/${owner}/${name}/branches/${branch}`, schema: Branch }),

      /** List labels for a repo */
      listLabels: (owner: string, name: string) =>
        req({ method: 'GET', path: `/repos/${owner}/${name}/labels`, schema: z.array(Label) }),

      /** Create a label for a repo */
      createLabel: (owner: string, name: string, opts: { name: string; color: string; description?: string; exclusive?: boolean }) =>
        req({ method: 'POST', path: `/repos/${owner}/${name}/labels`, body: opts, schema: Label }),
    },

    // ─── Issues ────────────────────────────────────────────────

    issues: {
      /** List issues for a repo */
      list: (owner: string, repo: string, opts?: { state?: string; limit?: number; page?: number; labels?: string; type?: string; milestone?: string }) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/issues`, query: { state: opts?.state ?? 'open', limit: opts?.limit ?? 20, page: opts?.page, labels: opts?.labels, type: opts?.type, milestone: opts?.milestone }, schema: z.array(Issue) }),

      /** Get a single issue */
      get: (owner: string, repo: string, number: number) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/issues/${number}`, schema: Issue }),

      /** Create an issue */
      create: (owner: string, repo: string, opts: { title: string; body?: string; labels?: number[]; milestone?: number; assignees?: string[] }) =>
        req({ method: 'POST', path: `/repos/${owner}/${repo}/issues`, body: opts, schema: Issue }),

      /** Edit an issue */
      edit: (owner: string, repo: string, number: number, opts: { title?: string; body?: string; state?: string; assignees?: string[] }) =>
        req({ method: 'PATCH', path: `/repos/${owner}/${repo}/issues/${number}`, body: opts, schema: Issue }),

      /** List comments on an issue */
      listComments: (owner: string, repo: string, number: number) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/issues/${number}/comments`, schema: z.array(Comment) }),

      /** Create a comment on an issue */
      createComment: (owner: string, repo: string, number: number, body: string) =>
        req({ method: 'POST', path: `/repos/${owner}/${repo}/issues/${number}/comments`, body: { body }, schema: Comment }),

      /** Edit a comment */
      editComment: (owner: string, repo: string, commentId: number, body: string) =>
        req({ method: 'PATCH', path: `/repos/${owner}/${repo}/issues/comments/${commentId}`, body: { body }, schema: Comment }),

      /** Get labels for an issue */
      getLabels: (owner: string, repo: string, number: number) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/issues/${number}/labels`, schema: z.array(Label) }),

      /** Replace all labels on an issue */
      setLabels: (owner: string, repo: string, number: number, labels: number[]) =>
        req({ method: 'PUT', path: `/repos/${owner}/${repo}/issues/${number}/labels`, body: { labels }, schema: z.array(Label) }),

      /** Replace all labels by name (Gitea supports label names in PUT body) */
      setLabelsByName: (owner: string, repo: string, number: number, labels: string[]) =>
        req({ method: 'PUT', path: `/repos/${owner}/${repo}/issues/${number}/labels`, body: { labels }, schema: z.array(Label) }),
    },

    // ─── Pull Requests ─────────────────────────────────────────

    pulls: {
      /** List pull requests for a repo */
      list: (owner: string, repo: string, opts?: { state?: string; limit?: number; page?: number; sort?: string }) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/pulls`, query: { state: opts?.state ?? 'open', limit: opts?.limit ?? 20, page: opts?.page, sort: opts?.sort }, schema: z.array(PullRequest) }),

      /** Get a single pull request */
      get: (owner: string, repo: string, number: number) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/pulls/${number}`, schema: PullRequest }),

      /** Create a pull request */
      create: (owner: string, repo: string, opts: { title: string; body?: string; head: string; base: string; labels?: number[]; milestone?: number; assignees?: string[] }) =>
        req({ method: 'POST', path: `/repos/${owner}/${repo}/pulls`, body: opts, schema: PullRequest }),

      /** Edit a pull request */
      edit: (owner: string, repo: string, number: number, opts: { title?: string; body?: string; state?: string; assignees?: string[] }) =>
        req({ method: 'PATCH', path: `/repos/${owner}/${repo}/pulls/${number}`, body: opts, schema: PullRequest }),

      /** Get PR diff as text */
      getDiff: (owner: string, repo: string, number: number) =>
        req<string>({ method: 'GET', path: `/repos/${owner}/${repo}/pulls/${number}.diff`, raw: true }),

      /** Merge a pull request */
      merge: (owner: string, repo: string, number: number, opts?: { style?: 'merge' | 'rebase' | 'squash'; title?: string; message?: string }) =>
        req({ method: 'POST', path: `/repos/${owner}/${repo}/pulls/${number}/merge`, body: { Do: opts?.style ?? 'merge', merge_message_field: opts?.title, merge_commit_message_field: opts?.message } }),

      /** List PR comments (review comments) */
      listComments: (owner: string, repo: string, number: number) =>
        req({ method: 'GET', path: `/repos/${owner}/${repo}/pulls/${number}/comments`, schema: z.array(Comment) }),
    },

    // ─── Projects (Board) ──────────────────────────────────────

    projects: {
      /** List columns on a project board */
      listColumns: (projectId: number) =>
        req({ method: 'GET', path: `/projects/${projectId}/columns`, schema: z.array(ProjectColumn) }),

      /** List cards/issues on a project board */
      listCards: (projectId: number) =>
        req({ method: 'GET', path: `/projects/${projectId}/issues`, schema: z.array(ProjectCard) }),

      /** Add an issue to a project board */
      addIssue: (projectId: number, issueId: number) =>
        req({ method: 'POST', path: `/projects/${projectId}/issues`, body: { issue_id: issueId } }),

      /** Move a card to a column */
      moveCard: (projectId: number, columnId: number, cardId: number, position?: number) =>
        req({ method: 'POST', path: `/projects/${projectId}/columns/${columnId}/cards/${cardId}/move`, body: { position: position ?? 0 } }),
    },

    // ─── Users ─────────────────────────────────────────────────

    users: {
      /** Get the authenticated user */
      me: () =>
        req({ method: 'GET', path: '/user', schema: User }),

      /** Get a user by username */
      get: (username: string) =>
        req({ method: 'GET', path: `/users/${username}`, schema: User }),

      /** List repos for a user */
      listRepos: (username: string, opts?: { limit?: number; page?: number }) =>
        req({ method: 'GET', path: `/users/${username}/repos`, query: { limit: opts?.limit ?? 50, page: opts?.page }, schema: z.array(Repository) }),
    },

    // ─── Organizations ─────────────────────────────────────────

    orgs: {
      /** List orgs for the authenticated user */
      list: () =>
        req({ method: 'GET', path: '/user/orgs', schema: z.array(Organization) }),

      /** Get an organization */
      get: (name: string) =>
        req({ method: 'GET', path: `/orgs/${name}`, schema: Organization }),

      /** List repos for an org */
      listRepos: (name: string, opts?: { limit?: number; page?: number }) =>
        req({ method: 'GET', path: `/orgs/${name}/repos`, query: { limit: opts?.limit ?? 50, page: opts?.page }, schema: z.array(Repository) }),

      /** List members of an org */
      listMembers: (name: string) =>
        req({ method: 'GET', path: `/orgs/${name}/members`, schema: z.array(User) }),
    },
  }
}

export type GiteaClient = ReturnType<typeof createGiteaClient>
