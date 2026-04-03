import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeAdapter } from './claudeAdapter.js'

// Mock the Claude Agent SDK — we don't want real API calls in unit tests.
// The adapter's job is to translate between Codex JSON-RPC shapes and SDK calls.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  listSessions: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionInfo: vi.fn(),
  renameSession: vi.fn(),
  forkSession: vi.fn(),
}))

import {
  query as mockQuery,
  listSessions as mockListSessions,
  getSessionMessages as mockGetSessionMessages,
} from '@anthropic-ai/claude-agent-sdk'

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new ClaudeAdapter()
  })

  describe('initialize', () => {
    it('returns server info on initialize call', async () => {
      const result = await adapter.rpc('initialize', {
        clientInfo: { name: 'codex-web-local', version: '0.1.0' },
      })

      expect(result).toEqual({
        serverInfo: {
          name: 'claude-adapter',
          version: '0.1.0',
        },
      })
    })

    it('marks adapter as initialized after first call', async () => {
      await adapter.rpc('initialize', {
        clientInfo: { name: 'codex-web-local', version: '0.1.0' },
      })

      // Second call should work without error
      const result = await adapter.rpc('initialize', {
        clientInfo: { name: 'codex-web-local', version: '0.1.0' },
      })
      expect(result).toBeDefined()
    })
  })

  describe('thread/list', () => {
    it('translates listSessions response to ThreadListResponse shape', async () => {
      const mockSessions = [
        {
          sessionId: 'sess-001',
          summary: 'Fix auth bug',
          lastModified: 1712188800000,
          cwd: '/home/user/project',
          firstPrompt: 'Fix the login bug',
          gitBranch: 'main',
        },
        {
          sessionId: 'sess-002',
          summary: 'Add dark mode',
          lastModified: 1712102400000,
          cwd: '/home/user/project',
          firstPrompt: 'Add dark mode to the UI',
          gitBranch: 'feat/dark-mode',
        },
      ]

      vi.mocked(mockListSessions).mockResolvedValue(mockSessions)

      const result = await adapter.rpc('thread/list', {
        archived: false,
        limit: 100,
        sortKey: 'updated_at',
      }) as any

      expect(mockListSessions).toHaveBeenCalledWith({
        limit: 100,
      })

      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toMatchObject({
        id: 'sess-001',
        preview: 'Fix the login bug',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        cwd: '/home/user/project',
        turns: [],
      })
      expect(result.nextCursor).toBeNull()
    })

    it('returns empty data array when no sessions exist', async () => {
      vi.mocked(mockListSessions).mockResolvedValue([])

      const result = await adapter.rpc('thread/list', {
        archived: false,
        limit: 100,
        sortKey: 'updated_at',
      }) as any

      expect(result.data).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })

  describe('thread/start', () => {
    it('creates a new session and returns thread id', async () => {
      // query() returns an async generator that yields SDKSystemMessage first
      const fakeSessionId = 'sess-new-001'
      const fakeQuery = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: fakeSessionId,
          cwd: '/home/user/project',
          model: 'claude-opus-4-1',
          tools: [],
          mcp_servers: [],
          permissionMode: 'bypassPermissions',
          slash_commands: [],
          skills: [],
          output_style: 'concise',
          plugins: [],
          uuid: '00000000-0000-0000-0000-000000000001',
          claude_code_version: '1.0.0',
          apiKeySource: 'user',
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: fakeSessionId,
          result: '',
          uuid: '00000000-0000-0000-0000-000000000002',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: false,
          num_turns: 0,
          stop_reason: null,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
        }
      })()

      vi.mocked(mockQuery).mockReturnValue(fakeQuery as any)

      const result = await adapter.rpc('thread/start', {
        cwd: '/home/user/project',
      }) as any

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: '',
        options: expect.objectContaining({
          cwd: '/home/user/project',
          permissionMode: 'bypassPermissions',
        }),
      })

      expect(result.thread.id).toBe(fakeSessionId)
    })
  })

  describe('thread/read', () => {
    it('reconstructs Thread with Turns from flat SessionMessages', async () => {
      const sessionId = 'sess-read-001'

      vi.mocked(mockGetSessionMessages).mockResolvedValue([
        {
          type: 'user',
          uuid: 'msg-u1',
          session_id: sessionId,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Hello Claude' }],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-a1',
          session_id: sessionId,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello! How can I help?' }],
            stop_reason: 'end_turn',
          },
          parent_tool_use_id: null,
        },
        {
          type: 'user',
          uuid: 'msg-u2',
          session_id: sessionId,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Explain TypeScript generics' }],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-a2',
          session_id: sessionId,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Generics allow you to write reusable code...' }],
            stop_reason: 'end_turn',
          },
          parent_tool_use_id: null,
        },
      ])

      const result = await adapter.rpc('thread/read', {
        threadId: sessionId,
        includeTurns: true,
      }) as any

      expect(mockGetSessionMessages).toHaveBeenCalledWith(sessionId, {})

      // Should have a thread with the right id
      expect(result.thread.id).toBe(sessionId)

      // Should have 2 turns (each user+assistant pair = 1 turn)
      expect(result.thread.turns).toHaveLength(2)

      // Turn 1
      const turn1 = result.thread.turns[0]
      expect(turn1.id).toBeDefined()
      expect(turn1.status).toBe('completed')
      expect(turn1.items).toHaveLength(2)
      expect(turn1.items[0].type).toBe('userMessage')
      expect(turn1.items[1].type).toBe('agentMessage')
      expect(turn1.items[1].text).toBe('Hello! How can I help?')

      // Turn 2
      const turn2 = result.thread.turns[1]
      expect(turn2.items).toHaveLength(2)
      expect(turn2.items[0].type).toBe('userMessage')
      expect(turn2.items[1].text).toBe('Generics allow you to write reusable code...')
    })

    it('returns empty turns when includeTurns is false', async () => {
      vi.mocked(mockGetSessionMessages).mockResolvedValue([])

      const result = await adapter.rpc('thread/read', {
        threadId: 'sess-read-002',
        includeTurns: false,
      }) as any

      expect(result.thread.turns).toEqual([])
    })
  })

  describe('turn/start', () => {
    it('sends prompt via query and emits turn notifications', async () => {
      const threadId = 'sess-turn-001'
      const turnId = 'turn-new-001'

      // First we need a session to exist (via thread/start)
      const initQuery = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: threadId,
          cwd: '/project',
          model: 'claude-opus-4-1',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000010',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()

      vi.mocked(mockQuery).mockReturnValueOnce(initQuery as any)
      await adapter.rpc('thread/start', { cwd: '/project' })

      // Now mock query for the turn
      const turnQuery = (async function* () {
        yield {
          type: 'assistant',
          uuid: turnId,
          session_id: threadId,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Here is my response about TypeScript.' }],
            stop_reason: 'end_turn',
          },
          parent_tool_use_id: null,
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: threadId,
          uuid: '00000000-0000-0000-0000-000000000012',
          result: 'Here is my response about TypeScript.',
          duration_ms: 500,
          duration_api_ms: 400,
          is_error: false,
          num_turns: 1,
          stop_reason: 'end_turn',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
        }
      })()

      vi.mocked(mockQuery).mockReturnValueOnce(turnQuery as any)

      // Collect notifications
      const notifications: Array<{ method: string; params: unknown }> = []
      adapter.onNotification((n) => notifications.push(n))

      const result = await adapter.rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'Explain TypeScript' }],
      }) as any

      // Should return a turn object
      expect(result.turn).toBeDefined()
      expect(result.turn.id).toBeDefined()

      // Should have emitted turn/started
      const turnStarted = notifications.find(n => n.method === 'turn/started')
      expect(turnStarted).toBeDefined()
      expect((turnStarted!.params as any).threadId).toBe(threadId)

      // Should have emitted item/started for agentMessage
      const itemStarted = notifications.find(n => n.method === 'item/started')
      expect(itemStarted).toBeDefined()
      expect((itemStarted!.params as any).item.type).toBe('agentMessage')

      // Should have emitted turn/completed
      const turnCompleted = notifications.find(n => n.method === 'turn/completed')
      expect(turnCompleted).toBeDefined()
    })
  })

  describe('model/list', () => {
    it('returns a list of Anthropic model objects with id fields containing "claude"', async () => {
      const result = await adapter.rpc('model/list', {}) as any

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.nextCursor).toBeNull()

      for (const model of result.data) {
        expect(model).toHaveProperty('id')
        expect(model.id).toContain('claude')
      }
    })

    it('includes claude-opus-4-1, claude-sonnet-4-5-20250514, and claude-haiku-4-5-20251001', async () => {
      const result = await adapter.rpc('model/list', {}) as any
      const ids = result.data.map((m: { id: string }) => m.id)

      expect(ids).toContain('claude-opus-4-1')
      expect(ids).toContain('claude-sonnet-4-5-20250514')
      expect(ids).toContain('claude-haiku-4-5-20251001')
    })
  })

  describe('turn/interrupt', () => {
    it('aborts the active session query', async () => {
      const threadId = 'sess-interrupt-001'
      const abortController = new AbortController()

      // Set up a session via thread/start
      const initQuery = (async function* () {
        yield {
          type: 'system', subtype: 'init', session_id: threadId,
          cwd: '/project', model: 'claude-opus-4-1',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000020',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()

      vi.mocked(mockQuery).mockReturnValueOnce(initQuery as any)
      await adapter.rpc('thread/start', { cwd: '/project' })

      // Now call turn/interrupt
      const result = await adapter.rpc('turn/interrupt', {
        threadId,
        turnId: 'some-turn-id',
      })

      // Should not throw
      expect(result).toBeDefined()
    })

    it('throws when interrupting unknown thread', async () => {
      await expect(
        adapter.rpc('turn/interrupt', {
          threadId: 'nonexistent',
          turnId: 'some-turn',
        })
      ).rejects.toThrow()
    })
  })
})
