import { listSessions, query, getSessionMessages, renameSession, forkSession } from '@anthropic-ai/claude-agent-sdk'
import type { SDKSessionInfo, Query, SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { scanClaudeSkills } from './claudeSkills.js'
import { scanProjectFiles, readProjectFile, saveProjectFile } from './projectFiles.js'

type RpcParams = Record<string, unknown>
type NotificationListener = (value: { method: string; params: unknown }) => void

export class ClaudeAdapter {
  private initialized = false
  private authenticated = false
  private defaultModel: string | undefined = undefined
  private activeSessions = new Map<string, { query: Query; abortController: AbortController }>()
  private notificationListeners = new Set<NotificationListener>()

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    try {
      await listSessions({ limit: 1 })
      this.authenticated = true
    } catch (error) {
      this.authenticated = false
      console.warn(`[claude-adapter] auth check failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    await this.ensureInitialized()
    const p = (params ?? {}) as RpcParams

    switch (method) {
      case 'initialize':
        return {
          serverInfo: { name: 'claude-adapter', version: '0.1.0' },
          authenticated: this.authenticated,
        }

      case 'auth/status':
        return {
          backend: 'claude',
          authenticated: this.authenticated,
          loginCommand: this.authenticated ? null : 'claude login',
        }

      case 'thread/list':
        return this.handleThreadList(p)

      case 'thread/start':
        return this.handleThreadStart(p)

      case 'thread/read':
        return this.handleThreadRead(p)

      case 'turn/start':
        return this.handleTurnStart(p)

      case 'turn/interrupt':
        return this.handleTurnInterrupt(p)

      case 'model/list':
        return {
          data: [
            { id: 'claude-opus-4-6', model: 'claude-opus-4-6' },
            { id: 'claude-sonnet-4-6', model: 'claude-sonnet-4-6' },
            { id: 'claude-haiku-4-5-20251001', model: 'claude-haiku-4-5-20251001' },
          ],
          nextCursor: null,
        }

      case 'thread/resume':
        return this.handleThreadResume(p)

      case 'thread/archive':
        return {}

      case 'thread/name/set':
        return this.handleThreadNameSet(p)

      case 'setDefaultModel':
        this.defaultModel = typeof p.model === 'string' ? p.model : undefined
        return {}

      case 'thread/rollback':
        return this.handleThreadRollback(p)

      case 'thread/fork':
        return this.handleThreadFork(p)

      case 'config/read':
        return {
          config: {},
          origins: {},
          layers: null,
        }

      case 'config/batchWrite':
        return {}

      case 'account/rateLimits/read':
        return {
          rateLimits: { remaining: 1000, limit: 1000, resetAt: null },
          rateLimitsByLimitId: null,
        }

      case 'generate-thread-title':
        return this.handleGenerateTitle(p)

      case 'skills/list': {
        const cwds = Array.isArray(p.cwds) ? p.cwds as string[] : [process.cwd()]
        const cwd = cwds[0] ?? process.cwd()
        return scanClaudeSkills(cwd)
      }

      case 'skills/config/write':
        return {}

      case 'claude/project-files': {
        const cwd = typeof p.cwd === 'string' ? p.cwd : process.cwd()
        return { files: await scanProjectFiles(cwd) }
      }

      case 'claude/read-file': {
        const path = typeof p.path === 'string' ? p.path : ''
        const result = await readProjectFile(path)
        if (!result) return { error: 'File not found or not allowed' }
        return result
      }

      case 'claude/save-file': {
        const path = typeof p.path === 'string' ? p.path : ''
        const content = typeof p.content === 'string' ? p.content : ''
        return saveProjectFile(path, content)
      }

      default:
        console.warn(`[claude-adapter] unhandled method: ${method}`)
        return {}
    }
  }

  async respondToServerRequest(_payload: unknown): Promise<void> {
    // Phase 2: approval flow bridging
  }

  listPendingServerRequests(): unknown[] {
    // Phase 2: approval flow
    return []
  }

  dispose(): void {
    for (const session of this.activeSessions.values()) {
      session.abortController.abort()
    }
    this.activeSessions.clear()
    this.notificationListeners.clear()
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener)
    return () => { this.notificationListeners.delete(listener) }
  }

  private emitNotification(method: string, params: unknown): void {
    for (const listener of this.notificationListeners) {
      listener({ method, params })
    }
  }

  private async handleThreadList(params: RpcParams) {
    const limit = typeof params.limit === 'number' ? params.limit : 100
    const sessions = await listSessions({ limit })

    return {
      data: sessions.map((s: SDKSessionInfo) => this.sessionToThread(s)),
      nextCursor: null,
    }
  }

  private async handleThreadStart(params: RpcParams) {
    const cwd = typeof params.cwd === 'string' ? params.cwd : process.cwd()
    const model = typeof params.model === 'string' ? params.model : this.defaultModel
    const abortController = new AbortController()

    const q = query({
      prompt: '',
      options: {
        cwd,
        model,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    })

    // Drain until we get the system init message with session_id
    let sessionId = ''
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id
        break
      }
      if (msg.type === 'result') {
        break
      }
    }

    if (!sessionId) {
      throw new Error('thread/start: failed to get session id from Claude')
    }

    this.activeSessions.set(sessionId, { query: q, abortController })

    return {
      thread: { id: sessionId },
    }
  }

  private async handleThreadResume(params: RpcParams) {
    const threadId = params.threadId as string
    const abortController = new AbortController()

    const q = query({
      prompt: '',
      options: {
        resume: threadId,
        permissionMode: 'bypassPermissions',
        abortController,
      },
    })

    let sessionId = ''
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id
        break
      }
      if (msg.type === 'result') break
    }

    if (!sessionId) sessionId = threadId
    this.activeSessions.set(sessionId, { query: q, abortController })

    return { thread: { id: sessionId } }
  }

  private async handleThreadNameSet(params: RpcParams) {
    const threadId = params.threadId as string
    const name = params.name as string
    await renameSession(threadId, name, {})
    return {}
  }

  private async handleThreadFork(params: RpcParams) {
    const threadId = params.threadId as string
    const result = await forkSession(threadId, {})
    return {
      thread: { id: result.sessionId },
    }
  }

  private handleGenerateTitle(params: RpcParams) {
    const prompt = typeof params.prompt === 'string' ? params.prompt : ''
    // Generate a simple title from the first ~50 chars of the prompt
    const title = prompt.length > 50
      ? prompt.slice(0, 50).trim() + '...'
      : prompt.trim()
    return { title: title || 'New conversation' }
  }

  private async handleThreadRollback(params: RpcParams) {
    const threadId = params.threadId as string
    const numTurns = typeof params.numTurns === 'number' ? params.numTurns : 1

    // Find the UUID of the last message before the rollback point.
    // Walk raw messages, count real user messages (= turn boundaries),
    // and track the last UUID before the Nth-from-end turn starts.
    const messages = await getSessionMessages(threadId, {})

    // Find turn boundary UUIDs — each real user message starts a turn
    const turnStartIndices: number[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.type !== 'user') continue
      if (msg.parent_tool_use_id) continue
      const content = (msg.message as any)?.content
      if (Array.isArray(content) && content.every((c: any) => c.type === 'tool_result')) continue
      turnStartIndices.push(i)
    }

    const totalTurns = turnStartIndices.length
    const keepCount = Math.max(0, totalTurns - numTurns)

    if (keepCount <= 0) {
      // Rolling back everything — just create a new empty thread
      return this.handleThreadStart({ cwd: process.cwd() })
    }

    // The fork point is the last message before the turn we're removing
    const cutoffMsgIndex = turnStartIndices[keepCount]
    // Find the last message UUID before this cutoff (the previous message)
    const forkAtUuid = messages[cutoffMsgIndex - 1]?.uuid

    if (!forkAtUuid) {
      return this.handleThreadStart({ cwd: process.cwd() })
    }

    // Fork the session at this point
    const result = await forkSession(threadId, { upToMessageId: forkAtUuid })
    const newThreadId = result.sessionId

    // Read the forked session's messages and return as the new thread
    const forkedMessages = await getSessionMessages(newThreadId, {})
    const turns = this.messagesToTurns(forkedMessages)

    return {
      thread: {
        id: newThreadId,
        preview: '',
        modelProvider: 'anthropic',
        createdAt: 0,
        updatedAt: 0,
        path: null,
        cwd: '',
        cliVersion: '',
        source: 'claude-adapter',
        gitInfo: null,
        turns,
      },
    }
  }

  private async handleThreadRead(params: RpcParams) {
    const threadId = params.threadId as string
    const includeTurns = params.includeTurns !== false

    let turns: unknown[] = []
    if (includeTurns) {
      const messages = await getSessionMessages(threadId, {})
      turns = this.messagesToTurns(messages)
    }

    return {
      thread: {
        id: threadId,
        preview: '',
        modelProvider: 'anthropic',
        createdAt: 0,
        updatedAt: 0,
        path: null,
        cwd: '',
        cliVersion: '',
        source: 'claude-adapter',
        gitInfo: null,
        turns,
      },
    }
  }

  private async handleTurnStart(params: RpcParams) {
    const threadId = params.threadId as string
    const input = params.input as Array<{ type: string; text?: string }>
    const prompt = input
      .filter((i) => i.type === 'text' && i.text)
      .map((i) => i.text)
      .join('\n')

    const session = this.activeSessions.get(threadId)
    const cwd = typeof params.cwd === 'string' ? params.cwd : process.cwd()
    const abortController = session?.abortController ?? new AbortController()

    // Start a new query for this turn (resume the session)
    const q = query({
      prompt,
      options: {
        cwd,
        resume: threadId,
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        abortController,
      },
    })

    // Store the active session
    this.activeSessions.set(threadId, { query: q, abortController })

    const turnId = `turn-${Date.now()}`

    // Emit turn/started
    this.emitNotification('turn/started', {
      threadId,
      turn: { id: turnId, status: 'inProgress', items: [], error: null },
    })

    // Process stream in background — return turn ID immediately
    // Notifications stream to the frontend via WebSocket
    void this.processStream(threadId, turnId, q).catch((err) => {
      console.warn(`[claude-adapter] stream error for turn ${turnId}:`, err)
    })

    return {
      turn: { id: turnId },
    }
  }

  private async handleTurnInterrupt(params: RpcParams) {
    const threadId = params.threadId as string
    const session = this.activeSessions.get(threadId)

    if (!session) {
      throw new Error(`No active session for thread ${threadId}`)
    }

    session.abortController.abort()
    return {}
  }

  private async processStream(threadId: string, turnId: string, q: AsyncIterable<SDKMessage>) {
    // Track active text block for streaming deltas
    let activeTextItemId: string | null = null

    try {
      for await (const msg of q) {
        if (msg.type === 'stream_event') {
          const event = (msg as any).event
          const uuid = (msg as any).uuid ?? `item-${Date.now()}`

          if (event?.type === 'content_block_start' && event.content_block?.type === 'text') {
            activeTextItemId = uuid
            this.emitNotification('item/started', {
              item: { type: 'agentMessage', id: uuid, text: '' },
              threadId,
              turnId,
            })
          } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            this.emitNotification('item/agentMessage/delta', {
              threadId,
              turnId,
              itemId: activeTextItemId ?? uuid,
              delta: event.delta.text,
            })
          } else if (event?.type === 'content_block_stop' && activeTextItemId) {
            this.emitNotification('item/completed', {
              item: { type: 'agentMessage', id: activeTextItemId, text: '' },
              threadId,
              turnId,
            })
            activeTextItemId = null
          }
        } else if (msg.type === 'assistant') {
          const content = (msg as any).message?.content
          if (!Array.isArray(content)) continue

          for (const block of content) {
            if (block.type === 'text' && block.text) {
              const item = {
                type: 'agentMessage',
                id: (msg as any).uuid ?? `item-${Date.now()}`,
                text: block.text,
              }
              this.emitNotification('item/started', { item, threadId, turnId })
              this.emitNotification('item/completed', { item, threadId, turnId })
            } else if (block.type === 'tool_use') {
              this.emitToolUseItem(block, threadId, turnId)
            }
          }
        }

        if (msg.type === 'result') {
          break
        }
      }
    } finally {
      this.emitNotification('turn/completed', {
        threadId,
        turn: { id: turnId, status: 'completed', items: [], error: null },
      })
    }
  }

  private emitToolUseItem(block: any, threadId: string, turnId: string) {
    const toolName: string = block.name ?? ''
    const input = block.input ?? {}
    const id = block.id ?? `tool-${Date.now()}`

    if (toolName === 'Bash') {
      const item = {
        type: 'commandExecution',
        id,
        command: input.command ?? '',
        cwd: input.cwd ?? '',
        processId: null,
        status: 'completed',
        commandActions: [],
        aggregatedOutput: null,
        exitCode: 0,
        durationMs: null,
      }
      this.emitNotification('item/started', { item, threadId, turnId })
      this.emitNotification('item/completed', { item, threadId, turnId })
    } else if (toolName === 'Edit' || toolName === 'Write') {
      const item = {
        type: 'fileChange',
        id,
        changes: [{
          filePath: input.file_path ?? '',
          oldString: input.old_string ?? '',
          newString: input.new_string ?? input.content ?? '',
        }],
        status: 'completed',
      }
      this.emitNotification('item/started', { item, threadId, turnId })
      this.emitNotification('item/completed', { item, threadId, turnId })
    } else {
      // Other tools (Read, Grep, Glob, etc.) — emit as generic tool call
      const item = {
        type: 'mcpToolCall',
        id,
        server: 'claude',
        tool: toolName,
        status: 'completed',
        arguments: input,
        result: null,
        error: null,
        durationMs: null,
      }
      this.emitNotification('item/started', { item, threadId, turnId })
      this.emitNotification('item/completed', { item, threadId, turnId })
    }
  }

  private messagesToTurns(messages: SessionMessage[]) {
    const turns: any[] = []
    let currentItems: any[] = []
    let turnIndex = 0

    for (const msg of messages) {
      // Skip tool_result messages — user messages whose content is only tool_result blocks
      if (msg.type === 'user') {
        const content = (msg.message as any)?.content
        if (msg.parent_tool_use_id) continue
        if (Array.isArray(content) && content.length > 0 && content.every((c: any) => c.type === 'tool_result')) continue
      }

      // Skip thinking blocks
      if (msg.type === 'assistant') {
        const content = (msg.message as any)?.content
        if (Array.isArray(content) && content.length > 0 && content.every((c: any) => c.type === 'thinking')) continue
      }

      if (msg.type === 'user') {
        // A real user message starts a new turn
        if (currentItems.length > 0) {
          turns.push({
            id: `turn-${turnIndex}`,
            status: 'completed',
            error: null,
            items: currentItems,
          })
          turnIndex++
          currentItems = []
        }

        const rawContent = (msg.message as any)?.content
        const text = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : ''
        const content = typeof rawContent === 'string'
          ? [{ type: 'text', text: rawContent }]
          : Array.isArray(rawContent)
            ? rawContent
            : [{ type: 'text', text: '' }]

        if (!text) continue // Skip empty user messages

        currentItems.push({
          type: 'userMessage',
          id: msg.uuid,
          content,
        })
      } else if (msg.type === 'assistant') {
        const content = (msg.message as any)?.content
        if (!Array.isArray(content)) continue

        // Extract text blocks as agentMessage
        const textParts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
        if (textParts) {
          currentItems.push({
            type: 'agentMessage',
            id: msg.uuid,
            text: textParts,
          })
        }

        // Extract tool_use blocks as typed items
        for (const block of content) {
          if (block.type !== 'tool_use') continue
          const toolName: string = block.name ?? ''
          const input = block.input ?? {}
          const toolId = block.id ?? `tool-${Date.now()}`

          if (toolName === 'Bash') {
            currentItems.push({
              type: 'commandExecution',
              id: toolId,
              command: input.command ?? '',
              cwd: input.cwd ?? '',
              processId: null,
              status: 'completed',
              commandActions: [],
              aggregatedOutput: null,
              exitCode: 0,
              durationMs: null,
            })
          } else if (toolName === 'Edit' || toolName === 'Write') {
            currentItems.push({
              type: 'fileChange',
              id: toolId,
              changes: [{
                filePath: input.file_path ?? '',
                oldString: input.old_string ?? '',
                newString: input.new_string ?? input.content ?? '',
              }],
              status: 'completed',
            })
          } else {
            currentItems.push({
              type: 'mcpToolCall',
              id: toolId,
              server: 'claude',
              tool: toolName,
              status: 'completed',
              arguments: input,
              result: null,
              error: null,
              durationMs: null,
            })
          }
        }
      }
    }

    // Flush remaining items as final turn
    if (currentItems.length > 0) {
      turns.push({
        id: `turn-${turnIndex}`,
        status: 'completed',
        error: null,
        items: currentItems,
      })
    }

    return turns
  }

  private sessionToThread(s: SDKSessionInfo) {
    const updatedAtSec = Math.floor(s.lastModified / 1000)
    return {
      id: s.sessionId,
      preview: s.firstPrompt ?? s.summary ?? '',
      modelProvider: 'anthropic',
      createdAt: updatedAtSec,
      updatedAt: updatedAtSec,
      path: null,
      cwd: (s as any).cwd ?? '',
      cliVersion: '',
      source: 'claude-adapter',
      gitInfo: null,
      turns: [],
    }
  }
}
