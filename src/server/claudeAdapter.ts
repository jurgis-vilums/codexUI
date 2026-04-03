import { listSessions, query, getSessionMessages, renameSession, forkSession } from '@anthropic-ai/claude-agent-sdk'
import type { SDKSessionInfo, Query, SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'

type RpcParams = Record<string, unknown>
type NotificationListener = (value: { method: string; params: unknown }) => void

export class ClaudeAdapter {
  private initialized = false
  private authenticated = false
  private defaultModel: string | undefined = undefined
  private activeSessions = new Map<string, { query: Query; abortController: AbortController }>()
  private notificationListeners = new Set<NotificationListener>()

  async rpc(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as RpcParams

    switch (method) {
      case 'initialize': {
        this.initialized = true
        try {
          await listSessions({ limit: 1 })
          this.authenticated = true
          return {
            serverInfo: { name: 'claude-adapter', version: '0.1.0' },
            authenticated: true,
          }
        } catch (error) {
          this.authenticated = false
          const authError = error instanceof Error ? error.message : String(error)
          console.warn(`[claude-adapter] auth check failed: ${authError}`)
          return {
            serverInfo: { name: 'claude-adapter', version: '0.1.0' },
            authenticated: false,
            authError,
          }
        }
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
            { id: 'claude-opus-4-1', model: 'claude-opus-4-1' },
            { id: 'claude-sonnet-4-5-20250514', model: 'claude-sonnet-4-5-20250514' },
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
        return { thread: { id: p.threadId, turns: [] } }

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

      case 'skills/list':
        return { data: [] }

      case 'skills/config/write':
        return {}

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

    // Process stream and emit notifications before returning
    await this.processStream(threadId, turnId, q)

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
    try {
      for await (const msg of q) {
        if (msg.type === 'assistant') {
          const content = (msg as any).message?.content
          const text = Array.isArray(content)
            ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : ''

          const item = {
            type: 'agentMessage',
            id: (msg as any).uuid ?? `item-${Date.now()}`,
            text,
          }

          this.emitNotification('item/started', {
            item,
            threadId,
            turnId,
          })

          this.emitNotification('item/completed', {
            item,
            threadId,
            turnId,
          })
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

  private messagesToTurns(messages: SessionMessage[]) {
    const turns: any[] = []
    let currentItems: any[] = []
    let turnIndex = 0

    for (const msg of messages) {
      if (msg.type === 'user') {
        // A user message starts a new turn if we have accumulated items
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

        const content = (msg.message as any)?.content
        const textParts = Array.isArray(content)
          ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : ''

        currentItems.push({
          type: 'userMessage',
          id: msg.uuid,
          content: Array.isArray(content) ? content : [{ type: 'text', text: textParts }],
        })
      } else if (msg.type === 'assistant') {
        const content = (msg.message as any)?.content
        const textParts = Array.isArray(content)
          ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : ''

        currentItems.push({
          type: 'agentMessage',
          id: msg.uuid,
          text: textParts,
        })
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
