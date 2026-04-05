// src/server/processService.ts
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { platform } from 'node:os'

// ── Types ────────────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number
  name: string        // friendly name, e.g. "Vite Dev Server"
  runtime: string     // node, dotnet, python, ruby, go, java, unknown
  type: 'web' | 'backend' | 'unknown'
  port: number
  commandLine: string
  firstSeen: number   // Date.now() when first discovered
}

interface RawListening {
  pid: number
  port: number
}

// ── Pattern Registry ─────────────────────────────────────────────────────

interface PatternEntry {
  pattern: RegExp
  name: string
  runtime: string
  type: 'web' | 'backend'
}

const PATTERNS: PatternEntry[] = [
  // Web (Open + Stop)
  { pattern: /vite/i,                    name: 'Vite Dev Server',      runtime: 'node',   type: 'web' },
  { pattern: /next/i,                    name: 'Next.js Dev Server',   runtime: 'node',   type: 'web' },
  { pattern: /webpack.*dev/i,            name: 'Webpack Dev Server',   runtime: 'node',   type: 'web' },
  { pattern: /react-scripts/i,           name: 'Create React App',     runtime: 'node',   type: 'web' },
  { pattern: /python.*http\.server/i,    name: 'Python HTTP Server',   runtime: 'python', type: 'web' },
  { pattern: /live-server|serve\b/i,     name: 'Static File Server',   runtime: 'node',   type: 'web' },
  { pattern: /angular.*serve/i,          name: 'Angular Dev Server',   runtime: 'node',   type: 'web' },
  { pattern: /nuxt/i,                    name: 'Nuxt Dev Server',      runtime: 'node',   type: 'web' },
  { pattern: /astro\s+dev/i,             name: 'Astro Dev Server',     runtime: 'node',   type: 'web' },
  // Backend (Stop only)
  { pattern: /dotnet/i,                  name: '.NET Application',     runtime: 'dotnet', type: 'backend' },
  { pattern: /flask/i,                   name: 'Flask Backend',        runtime: 'python', type: 'backend' },
  { pattern: /uvicorn/i,                 name: 'Uvicorn Backend',      runtime: 'python', type: 'backend' },
  { pattern: /gunicorn/i,               name: 'Gunicorn Backend',     runtime: 'python', type: 'backend' },
  { pattern: /django/i,                  name: 'Django Backend',       runtime: 'python', type: 'backend' },
  { pattern: /express/i,                 name: 'Express API',          runtime: 'node',   type: 'backend' },
  { pattern: /fastify/i,                 name: 'Fastify API',          runtime: 'node',   type: 'backend' },
  { pattern: /hono/i,                    name: 'Hono API',             runtime: 'node',   type: 'backend' },
  { pattern: /koa/i,                     name: 'Koa API',              runtime: 'node',   type: 'backend' },
  { pattern: /rails|puma|thin/i,         name: 'Ruby Backend',         runtime: 'ruby',   type: 'backend' },
  { pattern: /go\s+run/i,               name: 'Go Backend',           runtime: 'go',     type: 'backend' },
]

// ── Classifier ───────────────────────────────────────────────────────────

function classifyProcess(commandLine: string): { name: string; runtime: string; type: 'web' | 'backend' | 'unknown' } {
  for (const entry of PATTERNS) {
    if (entry.pattern.test(commandLine)) {
      return { name: entry.name, runtime: entry.runtime, type: entry.type }
    }
  }
  // Try to guess runtime from executable name
  const runtime = guessRuntime(commandLine)
  return { name: commandLine.slice(0, 60), runtime, type: 'unknown' }
}

function guessRuntime(cmd: string): string {
  if (/\bnode\b/i.test(cmd)) return 'node'
  if (/\bpython\d?\b/i.test(cmd)) return 'python'
  if (/\bdotnet\b/i.test(cmd)) return 'dotnet'
  if (/\bruby\b/i.test(cmd)) return 'ruby'
  if (/\bjava\b/i.test(cmd)) return 'java'
  if (/\bgo\b/i.test(cmd)) return 'go'
  return 'unknown'
}

// ── OS Commands ──────────────────────────────────────────────────────────

function execPromise(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

async function getListeningPorts(): Promise<RawListening[]> {
  if (platform() === 'win32') {
    return getListeningPortsWindows()
  }
  return getListeningPortsLinux()
}

async function getListeningPortsWindows(): Promise<RawListening[]> {
  const stdout = await execPromise('netstat', ['-ano'])
  const results: RawListening[] = []
  for (const line of stdout.split('\n')) {
    // Match lines like:  TCP    0.0.0.0:5173    0.0.0.0:0    LISTENING    12840
    const match = line.match(/TCP\s+(?:[\d.]+|\[[\d:a-f]+\]):(\d+)\s+.*LISTENING\s+(\d+)/i)
    if (match) {
      const port = parseInt(match[1], 10)
      const pid = parseInt(match[2], 10)
      if (pid > 0 && port > 0) {
        results.push({ pid, port })
      }
    }
  }
  return results
}

async function getListeningPortsLinux(): Promise<RawListening[]> {
  const stdout = await execPromise('ss', ['-tlnp'])
  const results: RawListening[] = []
  for (const line of stdout.split('\n')) {
    // Match lines like: LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=1234,fd=19))
    const portMatch = line.match(/:(\d+)\s/)
    const pidMatch = line.match(/pid=(\d+)/)
    if (portMatch && pidMatch) {
      const port = parseInt(portMatch[1], 10)
      const pid = parseInt(pidMatch[1], 10)
      if (pid > 0 && port > 0) {
        results.push({ pid, port })
      }
    }
  }
  return results
}

async function getCommandLinesBatch(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (pids.length === 0) return result

  if (platform() === 'win32') {
    return getCommandLinesBatchWindows(pids)
  }
  return getCommandLinesBatchLinux(pids)
}

async function getCommandLinesBatchWindows(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  try {
    const filter = pids.map(pid => `ProcessId=${pid}`).join(' OR ')
    const stdout = await execPromise('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`,
    ])
    for (const line of stdout.split('\n')) {
      const sepIndex = line.indexOf('|')
      if (sepIndex < 0) continue
      const pid = parseInt(line.slice(0, sepIndex).trim(), 10)
      const cmdLine = line.slice(sepIndex + 1).trim()
      if (pid > 0 && cmdLine) {
        result.set(pid, cmdLine)
      }
    }
  } catch {
    // PowerShell failed — return empty map
  }
  return result
}

async function getCommandLinesBatchLinux(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  await Promise.all(pids.map(async (pid) => {
    try {
      const raw = await readFile(`/proc/${pid}/cmdline`, 'utf-8')
      const cmdLine = raw.replace(/\0/g, ' ').trim()
      if (cmdLine) result.set(pid, cmdLine)
    } catch {
      // Process may have exited
    }
  }))
  return result
}

// ── Process Map ──────────────────────────────────────────────────────────

const processMap = new Map<number, ProcessInfo>()
let selfPid = process.pid

export function setSelfPid(pid: number): void {
  selfPid = pid
}

export async function discoverProcesses(): Promise<ProcessInfo[]> {
  const listening = await getListeningPorts()

  // Deduplicate by PID (a process may listen on multiple ports — keep lowest port)
  const byPid = new Map<number, number>()
  for (const { pid, port } of listening) {
    if (pid === selfPid) continue // skip ourselves
    const existing = byPid.get(pid)
    if (existing === undefined || port < existing) {
      byPid.set(pid, port)
    }
  }

  const now = Date.now()
  const activePids = new Set<number>()
  const newPids: number[] = []

  for (const [pid, port] of byPid) {
    activePids.add(pid)
    if (processMap.has(pid)) {
      const existing = processMap.get(pid)!
      if (existing.port !== port) {
        existing.port = port
      }
    } else {
      newPids.push(pid)
    }
  }

  // Batch-fetch command lines for all new PIDs in one call
  if (newPids.length > 0) {
    const commandLines = await getCommandLinesBatch(newPids)
    for (const pid of newPids) {
      const commandLine = commandLines.get(pid)
      if (!commandLine) continue
      const port = byPid.get(pid)!
      const classification = classifyProcess(commandLine)
      processMap.set(pid, {
        pid,
        name: classification.name,
        runtime: classification.runtime,
        type: classification.type,
        port,
        commandLine,
        firstSeen: now,
      })
    }
  }

  // Remove processes that are no longer listening
  for (const pid of processMap.keys()) {
    if (!activePids.has(pid)) {
      processMap.delete(pid)
    }
  }

  return Array.from(processMap.values()).sort((a, b) => a.port - b.port)
}

// ── Stop Process ─────────────────────────────────────────────────────────

export async function stopProcess(pid: number): Promise<{ success: boolean; error?: string }> {
  const proc = processMap.get(pid)
  if (!proc) {
    return { success: false, error: 'Process not found' }
  }
  if (proc.type === 'unknown') {
    return { success: false, error: 'Cannot stop unknown process type' }
  }
  try {
    if (platform() === 'win32') {
      await execPromise('taskkill', ['/PID', String(pid), '/F'])
    } else {
      process.kill(pid, 'SIGTERM')
    }
    processMap.delete(pid)
    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

// ── Tailscale ────────────────────────────────────────────────────────────

let tailscaleCache: { hostname: string | null; online: boolean; fetchedAt: number } | null = null
const TAILSCALE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getTailscaleStatus(): Promise<{ hostname: string | null; online: boolean }> {
  if (tailscaleCache && Date.now() - tailscaleCache.fetchedAt < TAILSCALE_CACHE_TTL) {
    return { hostname: tailscaleCache.hostname, online: tailscaleCache.online }
  }
  try {
    const tailscaleCmd = platform() === 'win32' ? 'tailscale.exe' : 'tailscale'
    const stdout = await execPromise(tailscaleCmd, ['status', '--json'])
    const status = JSON.parse(stdout)
    const self = status.Self
    const hostname = self?.DNSName?.replace(/\.$/, '') ?? null
    const online = self?.Online ?? false
    tailscaleCache = { hostname, online, fetchedAt: Date.now() }
    return { hostname, online }
  } catch {
    tailscaleCache = { hostname: null, online: false, fetchedAt: Date.now() }
    return { hostname: null, online: false }
  }
}
