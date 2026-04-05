import * as pty from 'node-pty'
import { platform } from 'node:os'

const GRACE_PERIOD_MS = 5 * 60 * 1000 // 5 minutes

type TerminalClient = (data: string) => void

type TerminalSession = {
  ptyProcess: pty.IPty
  graceTimer: ReturnType<typeof setTimeout> | null
  clients: Set<TerminalClient>
}

let session: TerminalSession | null = null

function defaultShell(): string {
  if (platform() === 'win32') return 'pwsh.exe'
  return process.env.SHELL || '/bin/bash'
}

export function getOrCreateSession(cwd?: string): TerminalSession {
  if (session) {
    if (session.graceTimer) {
      clearTimeout(session.graceTimer)
      session.graceTimer = null
    }
    return session
  }

  const shell = defaultShell()
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || process.cwd(),
    env: process.env as Record<string, string>,
  })

  session = { ptyProcess, graceTimer: null, clients: new Set() }

  // Broadcast PTY output to all connected clients
  ptyProcess.onData((data: string) => {
    for (const client of session!.clients) {
      client(data)
    }
  })

  // Notify all clients on PTY exit
  ptyProcess.onExit(({ exitCode }) => {
    const exitMsg = JSON.stringify({ type: 'exit', code: exitCode })
    for (const client of session!.clients) {
      client(exitMsg)
    }
    session = null
  })

  return session
}

export function addClient(send: TerminalClient): () => void {
  if (!session) return () => {}
  session.clients.add(send)
  return () => {
    session?.clients.delete(send)
  }
}

export function writeToSession(data: string): void {
  if (!session) return
  session.ptyProcess.write(data)
}

export function resizeSession(cols: number, rows: number): void {
  if (!session) return
  cols = Math.max(1, Math.min(500, Math.floor(cols)))
  rows = Math.max(1, Math.min(200, Math.floor(rows)))
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
  session.ptyProcess.resize(cols, rows)
}

export function hasClients(): boolean {
  return session ? session.clients.size > 0 : false
}

export function startGracePeriod(): void {
  if (!session) return
  // Only start grace period when no clients remain
  if (session.clients.size > 0) return
  if (session.graceTimer) clearTimeout(session.graceTimer)
  session.graceTimer = setTimeout(() => {
    if (session) {
      session.ptyProcess.kill()
      session = null
    }
  }, GRACE_PERIOD_MS)
}

export function destroySession(): void {
  if (!session) return
  if (session.graceTimer) clearTimeout(session.graceTimer)
  session.clients.clear()
  session.ptyProcess.kill()
  session = null
}

process.once('SIGTERM', destroySession)
process.once('SIGINT', destroySession)
