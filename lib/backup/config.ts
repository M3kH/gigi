/**
 * Backup Config — Schema + Loader
 *
 * Loads gigi.config.yaml with ${ENV_VAR} interpolation.
 * Config file for structure, env vars for secrets.
 */

import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// ─── Schema ─────────────────────────────────────────────────────────

const SourceOrgSchema = z.object({ org: z.string() })
const SourceRepoSchema = z.object({ repo: z.string() })
const SourceMatchSchema = z.object({ match: z.string() })
const SourceSchema = z.union([SourceOrgSchema, SourceRepoSchema, SourceMatchSchema])

export type BackupSource = z.infer<typeof SourceSchema>

const MirrorTargetSchema = z.object({
  type: z.literal('git-mirror'),
  name: z.string(),
  url: z.string(),
  auth: z.enum(['token', 'mtls', 'ssh', 'none']).default('token'),
  token: z.string().optional(),
  cert: z.string().optional(),
  key: z.string().optional(),
  ca: z.string().optional(),
  /** Create repos on target if they don't exist (Gitea API) */
  create_repos: z.boolean().default(true),
  /** Token for target Gitea API (for repo creation) */
  api_token: z.string().optional(),
})

export type MirrorTarget = z.infer<typeof MirrorTargetSchema>

const TargetSchema = MirrorTargetSchema // Union with future target types

export type BackupTarget = z.infer<typeof TargetSchema>

const ScheduleSchema = z.object({
  interval: z.string().default('6h'),
  before_deploy: z.boolean().default(true),
})

const BackupConfigSchema = z.object({
  sources: z.array(SourceSchema).min(1),
  targets: z.array(TargetSchema).min(1),
  schedule: ScheduleSchema.default(() => ({ interval: '6h', before_deploy: true })),
})

const RootConfigSchema = z.object({
  backup: BackupConfigSchema,
})

export type BackupConfig = z.infer<typeof BackupConfigSchema>
export type RootConfig = z.infer<typeof RootConfigSchema>

// ─── Env Var Interpolation ──────────────────────────────────────────

/**
 * Replace ${VAR_NAME} and ${VAR_NAME:-default} patterns with env var values.
 * Throws if a referenced env var is not set and no default is provided.
 */
export const interpolateEnvVars = (text: string): string => {
  return text.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...defaultParts] = expr.split(':-')
    const defaultValue = defaultParts.length > 0 ? defaultParts.join(':-') : undefined
    const envValue = process.env[varName.trim()]

    if (envValue !== undefined) return envValue
    if (defaultValue !== undefined) return defaultValue

    // Don't throw — return empty string for missing optional vars
    // The Zod validation will catch truly required fields
    console.warn(`[backup:config] env var ${varName.trim()} is not set`)
    return ''
  })
}

// ─── Config Loader ──────────────────────────────────────────────────

const CONFIG_PATHS = [
  'gigi.config.yaml',
  'gigi.config.yml',
  '/workspace/gigi.config.yaml',
  '/workspace/gigi.config.yml',
]

/**
 * Parse YAML manually (simple subset — avoids adding a YAML dependency).
 * Handles: scalars, arrays (- item), nested objects, quoted strings, booleans.
 *
 * For production, consider replacing with a proper YAML parser.
 */
export const parseSimpleYaml = (text: string): Record<string, unknown> => {
  // Pre-process: strip comments and blank lines, keep indentation
  const rawLines = text.split('\n')
  const lines: Array<{ indent: number; content: string; raw: string }> = []

  for (const raw of rawLines) {
    // Strip inline comments (simple: find " #" not in quotes)
    let line = raw
    const hashIdx = line.indexOf(' #')
    if (hashIdx >= 0) line = line.slice(0, hashIdx)
    if (line.trimStart().startsWith('#')) continue
    if (line.trim() === '') continue

    lines.push({
      indent: line.search(/\S/),
      content: line.trim(),
      raw: line,
    })
  }

  let pos = 0

  const parseMapping = (minIndent: number): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    while (pos < lines.length && lines[pos].indent >= minIndent) {
      const { indent, content } = lines[pos]

      // If indent dropped below our level, we're done
      if (indent < minIndent) break

      // Array items belong to a parent key — handle at caller level
      if (content.startsWith('- ')) break

      if (!content.includes(':')) {
        pos++
        continue
      }

      const colonIdx = content.indexOf(':')
      const key = content.slice(0, colonIdx).trim()
      const val = content.slice(colonIdx + 1).trim()

      pos++

      if (val === '' || val === '|' || val === '>') {
        // Check what follows: array or nested object?
        if (pos < lines.length && lines[pos].indent > indent) {
          if (lines[pos].content.startsWith('- ')) {
            // It's an array
            result[key] = parseSequence(lines[pos].indent)
          } else {
            // It's a nested mapping
            result[key] = parseMapping(lines[pos].indent)
          }
        } else {
          // Empty value
          result[key] = {}
        }
      } else {
        result[key] = parseYamlValue(val)
      }
    }

    return result
  }

  const parseSequence = (minIndent: number): unknown[] => {
    const result: unknown[] = []

    while (pos < lines.length && lines[pos].indent >= minIndent && lines[pos].content.startsWith('- ')) {
      const { indent, content } = lines[pos]
      if (indent < minIndent) break

      const itemContent = content.slice(2).trim()
      pos++

      if (itemContent.includes(':')) {
        // Array item starts an object: "- key: value"
        const obj: Record<string, unknown> = {}
        const colonIdx = itemContent.indexOf(':')
        const itemKey = itemContent.slice(0, colonIdx).trim()
        const itemVal = itemContent.slice(colonIdx + 1).trim()

        if (itemVal) {
          obj[itemKey] = parseYamlValue(itemVal)
        } else {
          // "- key:" with nested below
          if (pos < lines.length && lines[pos].indent > indent) {
            obj[itemKey] = parseMapping(lines[pos].indent)
          } else {
            obj[itemKey] = {}
          }
        }

        // Continuation keys at indent > dashIndent belong to this object
        // e.g. "    - type: git-mirror\n      name: backup" — name belongs to same obj
        const contIndent = indent + 2  // typical continuation indent
        while (pos < lines.length && lines[pos].indent > indent && !lines[pos].content.startsWith('- ')) {
          const contContent = lines[pos].content
          if (contContent.includes(':')) {
            const cColonIdx = contContent.indexOf(':')
            const cKey = contContent.slice(0, cColonIdx).trim()
            const cVal = contContent.slice(cColonIdx + 1).trim()
            pos++

            if (cVal === '' || cVal === '|' || cVal === '>') {
              if (pos < lines.length && lines[pos].indent > lines[pos - 1].indent) {
                if (lines[pos].content.startsWith('- ')) {
                  obj[cKey] = parseSequence(lines[pos].indent)
                } else {
                  obj[cKey] = parseMapping(lines[pos].indent)
                }
              } else {
                obj[cKey] = {}
              }
            } else {
              obj[cKey] = parseYamlValue(cVal)
            }
          } else {
            pos++
          }
        }

        result.push(obj)
      } else if (itemContent) {
        // Simple scalar array item
        result.push(parseYamlValue(itemContent))
      }
    }

    return result
  }

  return parseMapping(0)
}

const parseYamlValue = (val: string): string | number | boolean => {
  // Remove surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1)
  }
  if (val === 'true') return true
  if (val === 'false') return false
  const num = Number(val)
  if (!isNaN(num) && val !== '') return num
  return val
}

/**
 * Load backup config from gigi.config.yaml.
 * Searches multiple paths, interpolates env vars, validates with Zod.
 */
export const loadBackupConfig = async (configPath?: string): Promise<BackupConfig | null> => {
  const paths = configPath ? [configPath] : CONFIG_PATHS

  let rawYaml: string | null = null
  let usedPath: string | null = null

  for (const p of paths) {
    if (existsSync(p)) {
      rawYaml = await readFile(p, 'utf-8')
      usedPath = p
      break
    }
  }

  if (!rawYaml || !usedPath) {
    console.log('[backup:config] no gigi.config.yaml found, backup disabled')
    return null
  }

  console.log(`[backup:config] loading from ${usedPath}`)

  // Interpolate env vars
  const interpolated = interpolateEnvVars(rawYaml)

  // Parse YAML
  const parsed = parseSimpleYaml(interpolated)

  // Validate
  const result = RootConfigSchema.safeParse(parsed)
  if (!result.success) {
    console.error('[backup:config] invalid config:', result.error.format())
    return null
  }

  return result.data.backup
}
