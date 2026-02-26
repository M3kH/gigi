/**
 * Tests for lib/core/registry.ts — Agent Tool Registry
 */

import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  registerTool,
  registerTools,
  getTool,
  listTools,
  listToolsByContext,
  getMCPToolDefinitions,
  executeTool,
  clearRegistry,
  checkPermission,
  setPermissionPolicy,
  getPermissions,
} from '../lib/core/registry'
import type { AgentTool } from '../lib/core/registry'

// ─── Helpers ────────────────────────────────────────────────────────

const makeTool = (overrides: Partial<AgentTool> = {}): AgentTool => ({
  name: 'test.echo',
  description: 'Echo input back',
  schema: z.object({ message: z.string() }),
  handler: async (input: { message: string }) => input.message,
  context: 'server',
  permission: 'test.echo',
  ...overrides,
})

// ─── Tests ──────────────────────────────────────────────────────────

describe('Tool Registry', () => {
  beforeEach(() => {
    clearRegistry()
  })

  describe('registerTool', () => {
    it('should register a single tool', () => {
      const tool = makeTool()
      registerTool(tool)

      const found = getTool('test.echo')
      assert.ok(found)
      assert.equal(found.name, 'test.echo')
    })

    it('should throw on duplicate name', () => {
      registerTool(makeTool())
      assert.throws(
        () => registerTool(makeTool()),
        /already registered/
      )
    })
  })

  describe('registerTools', () => {
    it('should register multiple tools at once', () => {
      registerTools([
        makeTool({ name: 'a.one', permission: 'a.one' }),
        makeTool({ name: 'a.two', permission: 'a.two' }),
      ])

      assert.equal(listTools().length, 2)
    })
  })

  describe('listTools', () => {
    it('should return all registered tools', () => {
      registerTools([
        makeTool({ name: 'a', permission: 'a' }),
        makeTool({ name: 'b', permission: 'b' }),
        makeTool({ name: 'c', permission: 'c' }),
      ])
      assert.equal(listTools().length, 3)
    })
  })

  describe('listToolsByContext', () => {
    it('should filter by execution context', () => {
      registerTools([
        makeTool({ name: 'srv', context: 'server', permission: 'srv' }),
        makeTool({ name: 'cli', context: 'client', permission: 'cli' }),
        makeTool({ name: 'srv2', context: 'server', permission: 'srv2' }),
      ])

      assert.equal(listToolsByContext('server').length, 2)
      assert.equal(listToolsByContext('client').length, 1)
    })
  })

  describe('getMCPToolDefinitions', () => {
    it('should convert tools to MCP format', () => {
      registerTool(makeTool({
        name: 'test.greet',
        schema: z.object({
          name: z.string(),
          age: z.number().optional(),
        }),
        permission: 'test.greet',
      }))

      const defs = getMCPToolDefinitions()
      assert.equal(defs.length, 1)

      const def = defs[0]
      assert.equal(def.name, 'test.greet')
      assert.equal(def.description, 'Echo input back')
      assert.deepEqual(def.inputSchema, {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
        additionalProperties: false,
      })
    })

    it('should handle enum fields', () => {
      registerTool(makeTool({
        name: 'test.action',
        schema: z.object({
          action: z.enum(['create', 'delete', 'update']),
        }),
        permission: 'test.action',
      }))

      const defs = getMCPToolDefinitions()
      const props = defs[0].inputSchema.properties as Record<string, unknown>
      assert.deepEqual(props.action, { type: 'string', enum: ['create', 'delete', 'update'] })
    })
  })

  describe('executeTool', () => {
    it('should execute a registered tool', async () => {
      registerTool(makeTool({
        handler: async ({ message }: { message: string }) => `Hello, ${message}!`,
      }))

      const { result, error } = await executeTool('test.echo', { message: 'world' })
      assert.equal(error, undefined)
      assert.equal(result, 'Hello, world!')
    })

    it('should return error for unknown tool', async () => {
      const { error } = await executeTool('nonexistent', {})
      assert.ok(error)
      assert.match(error!, /Unknown tool/)
    })

    it('should validate input with Zod', async () => {
      registerTool(makeTool())

      const { error } = await executeTool('test.echo', { wrong_field: 123 })
      assert.ok(error)
      assert.match(error!, /Invalid input/)
    })
  })

  describe('Permissions', () => {
    it('should allow by default', async () => {
      const result = await checkPermission('anything')
      assert.equal(result.allowed, true)
    })

    it('should register permissions from tools', () => {
      registerTool(makeTool({ permission: 'test.special' }))

      const perms = getPermissions()
      assert.equal(perms['test.special'], 'always_allow')
    })

    it('should allow setting permission policy', async () => {
      setPermissionPolicy('test.restricted', 'ask_every_time')

      const perms = getPermissions()
      assert.equal(perms['test.restricted'], 'ask_every_time')

      // For now, all policies still return allowed: true
      const result = await checkPermission('test.restricted')
      assert.equal(result.allowed, true)
    })
  })
})
