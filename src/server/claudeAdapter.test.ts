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
  renameSession as mockRenameSession,
  forkSession as mockForkSession,
} from '@anthropic-ai/claude-agent-sdk'

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new ClaudeAdapter()
  })

  describe('initialize / auth', () => {
    it('probes auth on first RPC call and sets authenticated: true', async () => {
      vi.mocked(mockListSessions).mockResolvedValue([])

      // Any RPC call triggers ensureInitialized
      await adapter.rpc('model/list', {})

      const status = await adapter.rpc('auth/status', {}) as any
      expect(status.authenticated).toBe(true)
      expect(mockListSessions).toHaveBeenCalledWith({ limit: 1 })
    })

    it('sets authenticated: false when listSessions throws', async () => {
      vi.mocked(mockListSessions).mockRejectedValue(new Error('Token expired'))

      await adapter.rpc('model/list', {})

      const status = await adapter.rpc('auth/status', {}) as any
      expect(status.authenticated).toBe(false)
      expect(status.loginCommand).toBe('claude login')
    })

    it('only probes once — second call does not re-check', async () => {
      vi.mocked(mockListSessions).mockResolvedValue([])

      await adapter.rpc('model/list', {})
      await adapter.rpc('model/list', {})

      // listSessions called once for auth probe, not for model/list
      expect(mockListSessions).toHaveBeenCalledTimes(1)
    })
  })

  describe('auth/status', () => {
    it('returns authenticated state after successful initialize', async () => {
      vi.mocked(mockListSessions).mockResolvedValue([])
      await adapter.rpc('initialize', { clientInfo: { name: 'test', version: '0.1.0' } })

      const result = await adapter.rpc('auth/status', {}) as any
      expect(result.authenticated).toBe(true)
      expect(result.backend).toBe('claude')
    })

    it('returns unauthenticated state with login command', async () => {
      vi.mocked(mockListSessions).mockRejectedValue(new Error('Token expired'))
      await adapter.rpc('initialize', { clientInfo: { name: 'test', version: '0.1.0' } })

      const result = await adapter.rpc('auth/status', {}) as any
      expect(result.authenticated).toBe(false)
      expect(result.loginCommand).toBeDefined()
      expect(typeof result.loginCommand).toBe('string')
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

  describe('thread/name/set', () => {
    it('calls renameSession with session id and name', async () => {
      vi.mocked(mockRenameSession).mockResolvedValue(undefined)

      await adapter.rpc('thread/name/set', {
        threadId: 'sess-rename-001',
        name: 'My Custom Title',
      })

      expect(mockRenameSession).toHaveBeenCalledWith(
        'sess-rename-001',
        'My Custom Title',
        {},
      )
    })
  })

  describe('thread/fork', () => {
    it('calls forkSession and returns new thread id', async () => {
      vi.mocked(mockForkSession).mockResolvedValue({
        sessionId: 'sess-forked-001',
        title: 'Fork of original',
      })

      const result = await adapter.rpc('thread/fork', {
        threadId: 'sess-original-001',
      }) as any

      expect(mockForkSession).toHaveBeenCalledWith(
        'sess-original-001',
        {},
      )
      expect(result.thread.id).toBe('sess-forked-001')
    })
  })

  describe('thread/resume', () => {
    it('creates a query with resume option and returns thread', async () => {
      const sessionId = 'sess-resume-001'

      const resumeQuery = (async function* () {
        yield {
          type: 'system', subtype: 'init', session_id: sessionId,
          cwd: '/project', model: 'claude-opus-4-1',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000030',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()

      vi.mocked(mockQuery).mockReturnValueOnce(resumeQuery as any)

      const result = await adapter.rpc('thread/resume', {
        threadId: sessionId,
      }) as any

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: '',
        options: expect.objectContaining({
          resume: sessionId,
          permissionMode: 'bypassPermissions',
        }),
      })

      expect(result.thread.id).toBe(sessionId)
    })
  })

  describe('setDefaultModel', () => {
    it('stores the model and uses it in subsequent thread/start calls', async () => {
      await adapter.rpc('setDefaultModel', { model: 'claude-haiku-4-5-20251001' })

      const fakeQuery = (async function* () {
        yield {
          type: 'system', subtype: 'init', session_id: 'sess-model-001',
          cwd: '/project', model: 'claude-haiku-4-5-20251001',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000040',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()

      vi.mocked(mockQuery).mockReturnValueOnce(fakeQuery as any)

      await adapter.rpc('thread/start', { cwd: '/project' })

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: '',
        options: expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
        }),
      })
    })
  })

  describe('generate-thread-title', () => {
    it('returns a title based on the prompt', async () => {
      const result = await adapter.rpc('generate-thread-title', {
        prompt: 'Fix the authentication bug in the login flow',
        cwd: '/project',
      }) as any

      // Should return a non-null title derived from the prompt
      expect(result.title).toBeDefined()
      expect(typeof result.title).toBe('string')
      expect(result.title.length).toBeGreaterThan(0)
    })
  })

  describe('streaming deltas', () => {
    it('emits item/agentMessage/delta for partial text blocks', async () => {
      const threadId = 'sess-stream-001'

      // Set up session
      const initQ = (async function* () {
        yield {
          type: 'system', subtype: 'init', session_id: threadId,
          cwd: '/project', model: 'claude-opus-4-1',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000050',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()
      vi.mocked(mockQuery).mockReturnValueOnce(initQ as any)
      await adapter.rpc('thread/start', { cwd: '/project' })

      // Turn query with stream_event (partial messages)
      const turnQ = (async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000051',
          session_id: threadId,
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000051',
          session_id: threadId,
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world!' } },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000051',
          session_id: threadId,
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_stop', index: 0 },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000051',
          session_id: threadId,
        }
        yield {
          type: 'result', subtype: 'success', session_id: threadId,
          uuid: '00000000-0000-0000-0000-000000000052',
          result: 'Hello world!', duration_ms: 100, duration_api_ms: 80,
          is_error: false, num_turns: 1, stop_reason: 'end_turn',
          total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {}, permission_denials: [],
        }
      })()
      vi.mocked(mockQuery).mockReturnValueOnce(turnQ as any)

      const notifications: Array<{ method: string; params: unknown }> = []
      adapter.onNotification((n) => notifications.push(n))

      await adapter.rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'Say hello' }],
      })

      const deltas = notifications.filter(n => n.method === 'item/agentMessage/delta')
      expect(deltas).toHaveLength(2)
      expect((deltas[0].params as any).delta).toBe('Hello ')
      expect((deltas[1].params as any).delta).toBe('world!')
    })
  })

  describe('tool use rendering', () => {
    it('emits commandExecution items for Bash tool_use blocks', async () => {
      const threadId = 'sess-tool-001'

      // Set up session
      const initQ = (async function* () {
        yield {
          type: 'system', subtype: 'init', session_id: threadId,
          cwd: '/project', model: 'claude-opus-4-1',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000060',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()
      vi.mocked(mockQuery).mockReturnValueOnce(initQ as any)
      await adapter.rpc('thread/start', { cwd: '/project' })

      // Turn with assistant message containing tool_use for Bash
      const turnQ = (async function* () {
        yield {
          type: 'assistant',
          uuid: 'tool-turn-001',
          session_id: threadId,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check the files.' },
              { type: 'tool_use', id: 'tu_001', name: 'Bash', input: { command: 'ls -la', description: 'List files' } },
            ],
            stop_reason: 'tool_use',
          },
          parent_tool_use_id: null,
        }
        yield {
          type: 'result', subtype: 'success', session_id: threadId,
          uuid: '00000000-0000-0000-0000-000000000062',
          result: '', duration_ms: 200, duration_api_ms: 150,
          is_error: false, num_turns: 1, stop_reason: 'tool_use',
          total_cost_usd: 0.02, usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {}, permission_denials: [],
        }
      })()
      vi.mocked(mockQuery).mockReturnValueOnce(turnQ as any)

      const notifications: Array<{ method: string; params: unknown }> = []
      adapter.onNotification((n) => notifications.push(n))

      await adapter.rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'List files' }],
      })

      // Should have agentMessage item for the text
      const agentItems = notifications.filter(n =>
        n.method === 'item/started' && (n.params as any).item.type === 'agentMessage'
      )
      expect(agentItems.length).toBeGreaterThanOrEqual(1)

      // Should have commandExecution item for the Bash tool_use
      const cmdItems = notifications.filter(n =>
        n.method === 'item/started' && (n.params as any).item.type === 'commandExecution'
      )
      expect(cmdItems).toHaveLength(1)
      expect((cmdItems[0].params as any).item.command).toBe('ls -la')
    })

    it('emits fileChange items for Edit tool_use blocks', async () => {
      const threadId = 'sess-tool-002'

      const initQ = (async function* () {
        yield {
          type: 'system', subtype: 'init', session_id: threadId,
          cwd: '/project', model: 'claude-opus-4-1',
          tools: [], mcp_servers: [], permissionMode: 'bypassPermissions',
          slash_commands: [], skills: [], output_style: 'concise', plugins: [],
          uuid: '00000000-0000-0000-0000-000000000070',
          claude_code_version: '1.0.0', apiKeySource: 'user',
        }
      })()
      vi.mocked(mockQuery).mockReturnValueOnce(initQ as any)
      await adapter.rpc('thread/start', { cwd: '/project' })

      const turnQ = (async function* () {
        yield {
          type: 'assistant',
          uuid: 'tool-turn-002',
          session_id: threadId,
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tu_002', name: 'Edit', input: { file_path: '/project/src/index.ts', old_string: 'foo', new_string: 'bar' } },
            ],
            stop_reason: 'tool_use',
          },
          parent_tool_use_id: null,
        }
        yield {
          type: 'result', subtype: 'success', session_id: threadId,
          uuid: '00000000-0000-0000-0000-000000000072',
          result: '', duration_ms: 100, duration_api_ms: 80,
          is_error: false, num_turns: 1, stop_reason: 'tool_use',
          total_cost_usd: 0.01, usage: { input_tokens: 30, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          modelUsage: {}, permission_denials: [],
        }
      })()
      vi.mocked(mockQuery).mockReturnValueOnce(turnQ as any)

      const notifications: Array<{ method: string; params: unknown }> = []
      adapter.onNotification((n) => notifications.push(n))

      await adapter.rpc('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'Fix the typo' }],
      })

      const fileItems = notifications.filter(n =>
        n.method === 'item/started' && (n.params as any).item.type === 'fileChange'
      )
      expect(fileItems).toHaveLength(1)
      expect((fileItems[0].params as any).item.changes[0].filePath).toBe('/project/src/index.ts')
    })
  })
})
