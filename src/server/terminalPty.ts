import * as pty from 'node-pty'
import { platform } from 'node:os'

const GRACE_PERIOD_MS = 5 * 60 * 1000 // 5 minutes

type TerminalSession = {
  ptyProcess: pty.IPty
  graceTimer: ReturnType<typeof setTimeout> | null
  onData: ((data: string) => void) | null
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

  session = { ptyProcess, graceTimer: null, onData: null }

  ptyProcess.onExit(() => {
    session = null
  })

  return session
}

export function attachDataListener(listener: (data: string) => void): void {
  if (!session) return
  session.onData = listener
  session.ptyProcess.onData(listener)
}

export function writeToSession(data: string): void {
  if (!session) return
  session.ptyProcess.write(data)
}

export function resizeSession(cols: number, rows: number): void {
  if (!session) return
  session.ptyProcess.resize(cols, rows)
}

export function startGracePeriod(): void {
  if (!session) return
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
  session.ptyProcess.kill()
  session = null
}

process.once('SIGTERM', destroySession)
process.once('SIGINT', destroySession)
