# Running Processes Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-discover running dev server processes and display them in a panel with Tailscale URL, process info, and type-appropriate action buttons (Open/Stop).

**Architecture:** Backend polls OS commands (`netstat`/`ss`) every 5 seconds to discover listening processes, classifies them via regex patterns, and pushes updates over a WebSocket. Frontend renders a card list under a Tailscale banner at the `/processes` route.

**Tech Stack:** Vue 3 Composition API, Express 5, WebSocket (ws), node `execFile`, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-04-05-running-processes-design.md`

---

## File Structure

**New files:**
| File | Responsibility |
|------|---------------|
| `src/server/processService.ts` | Process discovery (OS commands), classification (regex patterns), stop action, Tailscale hostname |
| `src/components/content/ProcessesPanel.vue` | UI component: Tailscale banner, process card list, WebSocket client, action handlers |

**Modified files:**
| File | Change |
|------|--------|
| `src/server/httpServer.ts` | Add `/ws/processes` WebSocket server + `/codex-api/tailscale` REST endpoint |
| `src/router/index.ts` | Add `/processes` route |
| `src/App.vue` | Add nav entry, `isProcessesRoute` computed, render `<ProcessesPanel />` |

---

### Task 1: Process Discovery Service — Core Types and OS Commands

**Files:**
- Create: `src/server/processService.ts`

- [ ] **Step 1: Create processService.ts with types and Windows discovery**

```typescript
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
    const match = line.match(/TCP\s+[\d.]+:(\d+)\s+[\d.]+:\d+\s+LISTENING\s+(\d+)/i)
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

async function getCommandLine(pid: number): Promise<string> {
  if (platform() === 'win32') {
    return getCommandLineWindows(pid)
  }
  return getCommandLineLinux(pid)
}

async function getCommandLineWindows(pid: number): Promise<string> {
  const stdout = await execPromise('wmic', [
    'process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/format:list',
  ])
  const match = stdout.match(/CommandLine=(.+)/)
  return match ? match[1].trim() : ''
}

async function getCommandLineLinux(pid: number): Promise<string> {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf-8')
    return raw.replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
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

  for (const [pid, port] of byPid) {
    activePids.add(pid)
    if (processMap.has(pid)) {
      // Update port if changed
      const existing = processMap.get(pid)!
      if (existing.port !== port) {
        existing.port = port
      }
      continue
    }
    // New process — resolve command line and classify
    const commandLine = await getCommandLine(pid)
    if (!commandLine) continue
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd C:/Users/vilum/Documents/dev/codexui && npx tsc --noEmit src/server/processService.ts`

If there are import issues with the tsconfig, just verify no syntax errors:
Run: `node -e "try { require('./src/server/processService.ts') } catch(e) { console.log('syntax check via tsc needed') }" && npx tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext src/server/processService.ts`

Expected: No errors (or only module resolution warnings that don't affect runtime)

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/server/processService.ts
git commit -m "feat(processes): add process discovery service with classification and Tailscale support"
```

---

### Task 2: WebSocket Endpoint and REST Route

**Files:**
- Modify: `src/server/httpServer.ts` (lines 232-234 for WSS creation, lines 236-266 for upgrade handler, and after line 312 for connection handler)

- [ ] **Step 1: Add processesWss and import processService in httpServer.ts**

At the top of `src/server/httpServer.ts`, add the import alongside existing imports:

```typescript
import { discoverProcesses, stopProcess, getTailscaleStatus, setSelfPid, type ProcessInfo } from './processService.js'
```

Where the other WebSocket servers are created (around line 232-234), add a fourth:

```typescript
const processesWss = new WebSocketServer({ noServer: true })
```

- [ ] **Step 2: Add upgrade handler for /ws/processes**

In the `server.on('upgrade')` handler (around line 236-266), add a new path check before the catch-all. Insert after the `/ws/git` block (around line 257) and before the `/codex-api/ws` block:

```typescript
    } else if (pathname === '/ws/processes') {
      processesWss.handleUpgrade(request, socket, head, (ws) => {
        processesWss.emit('connection', ws, request)
      })
```

- [ ] **Step 3: Add processes WebSocket connection handler**

After the `gitWss.on('connection')` block (after line 312), add:

```typescript
  // ── Processes WebSocket ──────────────────────────────────────────────
  let processInterval: ReturnType<typeof setInterval> | null = null
  let processClients = new Set<WebSocket>()

  setSelfPid(process.pid)

  async function broadcastProcesses(): Promise<void> {
    if (processClients.size === 0) return
    try {
      const processes = await discoverProcesses()
      const msg = JSON.stringify({ type: 'process-list', processes })
      for (const client of processClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg)
        }
      }
    } catch (err) {
      console.error('[processes] discovery error:', err)
    }
  }

  processesWss.on('connection', (ws: WebSocket) => {
    processClients.add(ws)

    // Start polling if this is the first client
    if (!processInterval) {
      processInterval = setInterval(broadcastProcesses, 5000)
      // Send immediately on first connect
      broadcastProcesses()
    } else {
      // Send current state to new client
      discoverProcesses().then((processes) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'process-list', processes }))
        }
      })
    }

    ws.on('message', async (msg: Buffer | string) => {
      try {
        const parsed = JSON.parse(typeof msg === 'string' ? msg : msg.toString())
        if (parsed.action === 'stop' && typeof parsed.pid === 'number') {
          const result = await stopProcess(parsed.pid)
          ws.send(JSON.stringify({ type: 'process-result', _id: parsed._id, ...result }))
          // Broadcast updated list immediately after stop
          await broadcastProcesses()
        }
      } catch (err) {
        console.error('[processes] message error:', err)
      }
    })

    ws.on('close', () => {
      processClients.delete(ws)
      if (processClients.size === 0 && processInterval) {
        clearInterval(processInterval)
        processInterval = null
      }
    })

    ws.on('error', () => {
      processClients.delete(ws)
    })
  })
```

- [ ] **Step 4: Add Tailscale REST endpoint**

After the existing REST routes (around line 192), add:

```typescript
  app.get('/codex-api/tailscale', async (_req, res) => {
    const status = await getTailscaleStatus()
    res.json(status)
  })
```

- [ ] **Step 5: Verify the server starts without errors**

Run: `cd C:/Users/vilum/Documents/dev/codexui && npx tsc --noEmit`

Expected: No new errors introduced

- [ ] **Step 6: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/server/httpServer.ts
git commit -m "feat(processes): add /ws/processes WebSocket endpoint and /codex-api/tailscale REST route"
```

---

### Task 3: Vue Route and Navigation Entry

**Files:**
- Modify: `src/router/index.ts` (line 24, after skills route)
- Modify: `src/App.vue` (lines 47-55 for nav, line 612 for computed, lines 177-180 for content routing)

- [ ] **Step 1: Add /processes route**

In `src/router/index.ts`, after the skills route (line 24), add:

```typescript
    {
      path: '/processes',
      name: 'processes',
      component: EmptyRouteView,
    },
```

- [ ] **Step 2: Add isProcessesRoute computed in App.vue**

In `src/App.vue`, after the `isSkillsRoute` computed (line 612), add:

```typescript
const isProcessesRoute = computed(() => route.name === 'processes')
```

- [ ] **Step 3: Add sidebar nav entry for Processes**

In `src/App.vue`, after the Skills Hub button block (lines 47-55), add a new button following the same pattern. Find the closing `</button>` of the Skills Hub nav entry and add below it:

```vue
          <button
            class="sidebar-nav-button"
            :class="{ 'is-active': isProcessesRoute }"
            @click="router.push({ name: 'processes' })"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="7" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="10" r="1" fill="currentColor"/><circle cx="17" cy="10" r="1" fill="currentColor"/></svg>
            <span>Processes</span>
          </button>
```

- [ ] **Step 4: Add content routing for ProcessesPanel**

In `src/App.vue`, in the content-body section, after the Skills Hub conditional (around line 180), add:

```vue
          <template v-else-if="isProcessesRoute">
            <ProcessesPanel />
          </template>
```

- [ ] **Step 5: Add ProcessesPanel import**

In the `<script setup>` section of `src/App.vue`, alongside the SkillsHub import, add:

```typescript
import ProcessesPanel from './components/content/ProcessesPanel.vue'
```

- [ ] **Step 6: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/router/index.ts src/App.vue
git commit -m "feat(processes): add /processes route and sidebar navigation entry"
```

---

### Task 4: ProcessesPanel Vue Component

**Files:**
- Create: `src/components/content/ProcessesPanel.vue`

- [ ] **Step 1: Create ProcessesPanel.vue**

```vue
<template>
  <div class="processes-panel">
    <!-- Header -->
    <div class="processes-header">
      <div>
        <h2 class="processes-title">Running Processes</h2>
        <p class="processes-subtitle">Auto-discovered dev servers and backends</p>
      </div>
      <button class="processes-refresh-btn" @click="refreshNow" title="Refresh">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>

    <!-- Tailscale Banner -->
    <div v-if="tailscale.hostname" class="tailscale-banner">
      <span class="tailscale-label">Tailscale</span>
      <a :href="'http://' + tailscale.hostname" target="_blank" rel="noopener" class="tailscale-link">
        {{ tailscale.hostname }}
      </a>
      <span class="tailscale-dot" :class="{ 'is-online': tailscale.online }"></span>
    </div>

    <!-- Process Count -->
    <div class="processes-count">
      {{ processes.length }} process{{ processes.length !== 1 ? 'es' : '' }} detected
    </div>

    <!-- Process List -->
    <div class="processes-list">
      <div
        v-for="proc in processes"
        :key="proc.pid"
        class="process-card"
        :class="{ 'is-unknown': proc.type === 'unknown' }"
      >
        <div class="process-info">
          <span class="process-dot" :class="'dot-' + proc.type"></span>
          <div class="process-details">
            <div class="process-name-row">
              <span class="process-name">{{ proc.name }}</span>
              <span class="process-runtime">{{ proc.runtime }}</span>
            </div>
            <div class="process-meta">
              :{{ proc.port }} &middot; PID {{ proc.pid }} &middot; {{ formatUptime(proc.firstSeen) }}
            </div>
          </div>
        </div>
        <div class="process-actions">
          <button
            v-if="proc.type === 'web'"
            class="action-btn action-open"
            @click="openProcess(proc)"
          >Open</button>
          <button
            v-if="proc.type === 'web' || proc.type === 'backend'"
            class="action-btn action-stop"
            @click="stopProcess(proc)"
          >Stop</button>
          <span v-if="proc.type === 'unknown'" class="unknown-label">unknown type</span>
        </div>
      </div>

      <div v-if="processes.length === 0" class="processes-empty">
        No dev server processes detected.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

interface ProcessInfo {
  pid: number
  name: string
  runtime: string
  type: 'web' | 'backend' | 'unknown'
  port: number
  commandLine: string
  firstSeen: number
}

const processes = ref<ProcessInfo[]>([])
const tailscale = ref<{ hostname: string | null; online: boolean }>({ hostname: null, online: false })
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

// ── WebSocket ────────────────────────────────────────────────────────────

function connectWebSocket(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws/processes`)

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'process-list') {
        processes.value = data.processes
      } else if (data.type === 'process-result') {
        if (!data.success && data.error) {
          showToast(`Failed to stop: ${data.error}`, 'error')
        } else if (data.success) {
          showToast('Process stopped', 'success')
        }
      }
    } catch { /* ignore parse errors */ }
  }

  ws.onclose = () => {
    ws = null
    reconnectTimer = setTimeout(connectWebSocket, 3000)
  }

  ws.onerror = () => {
    ws?.close()
  }
}

function refreshNow(): void {
  // Reconnect triggers an immediate broadcast from server
  ws?.close()
}

// ── Actions ──────────────────────────────────────────────────────────────

function openProcess(proc: ProcessInfo): void {
  const host = tailscale.value.hostname ?? 'localhost'
  window.open(`http://${host}:${proc.port}`, '_blank')
}

let reqId = 0

function stopProcess(proc: ProcessInfo): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const _id = String(++reqId)
  ws.send(JSON.stringify({ action: 'stop', pid: proc.pid, _id }))
}

// ── Tailscale ────────────────────────────────────────────────────────────

async function fetchTailscale(): Promise<void> {
  try {
    const res = await fetch('/codex-api/tailscale')
    tailscale.value = await res.json()
  } catch {
    tailscale.value = { hostname: null, online: false }
  }
}

// ── Toast ────────────────────────────────────────────────────────────────

const toastMessage = ref('')
const toastType = ref<'success' | 'error'>('success')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(message: string, type: 'success' | 'error'): void {
  toastMessage.value = message
  toastType.value = type
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 3000)
}

// ── Uptime Formatting ────────────────────────────────────────────────────

function formatUptime(firstSeen: number): string {
  const seconds = Math.floor((Date.now() - firstSeen) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

// ── Lifecycle ────────────────────────────────────────────────────────────

onMounted(() => {
  connectWebSocket()
  fetchTailscale()
})

onBeforeUnmount(() => {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (toastTimer) clearTimeout(toastTimer)
  ws?.close()
  ws = null
})
</script>

<style scoped>
@reference "tailwindcss";

.processes-panel {
  @apply h-full overflow-y-auto;
}

.processes-header {
  @apply flex items-center justify-between px-5 pt-5 pb-3;
}

.processes-title {
  @apply text-lg font-semibold text-[var(--text-primary)];
}

.processes-subtitle {
  @apply text-xs text-[var(--text-secondary)] mt-0.5;
}

.processes-refresh-btn {
  @apply p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors;
}

/* Tailscale Banner */
.tailscale-banner {
  @apply mx-5 mb-3 px-4 py-2.5 rounded-lg flex items-center gap-2.5;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}

.tailscale-label {
  @apply text-xs text-[var(--text-secondary)];
}

.tailscale-link {
  @apply text-sm font-mono underline;
  color: var(--accent-primary, #64b5f6);
}

.tailscale-dot {
  @apply w-2 h-2 rounded-full ml-1;
  background: var(--text-secondary);
}

.tailscale-dot.is-online {
  background: #4caf50;
}

/* Process Count */
.processes-count {
  @apply px-5 mb-3 text-xs uppercase tracking-wider text-[var(--text-secondary)];
}

/* Process List */
.processes-list {
  @apply px-5 space-y-2.5 pb-5;
}

.process-card {
  @apply flex items-center justify-between px-4 py-3 rounded-lg;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}

.process-card.is-unknown {
  @apply opacity-60;
}

.process-info {
  @apply flex items-center gap-2.5;
}

.process-dot {
  @apply w-2 h-2 rounded-full flex-shrink-0;
}

.dot-web, .dot-backend {
  background: #4caf50;
}

.dot-unknown {
  background: #ff9800;
}

.process-name-row {
  @apply flex items-center gap-2;
}

.process-name {
  @apply text-sm font-semibold text-[var(--text-primary)];
}

.process-runtime {
  @apply text-xs text-[var(--text-secondary)];
}

.process-meta {
  @apply text-xs font-mono text-[var(--text-secondary)] mt-0.5;
}

/* Actions */
.process-actions {
  @apply flex items-center gap-1.5;
}

.action-btn {
  @apply text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer;
  border: 1px solid transparent;
}

.action-open {
  @apply text-blue-400;
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.2);
}

.action-open:hover {
  background: rgba(59, 130, 246, 0.2);
}

.action-stop {
  @apply text-red-400;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
}

.action-stop:hover {
  background: rgba(239, 68, 68, 0.2);
}

.unknown-label {
  @apply text-xs text-[var(--text-secondary)];
}

.processes-empty {
  @apply text-center py-12 text-sm text-[var(--text-secondary)];
}
</style>
```

- [ ] **Step 2: Verify the component has no syntax errors**

Run: `cd C:/Users/vilum/Documents/dev/codexui && npx vue-tsc --noEmit 2>&1 | head -20`

Expected: No errors from ProcessesPanel.vue (other pre-existing warnings are OK)

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/components/content/ProcessesPanel.vue
git commit -m "feat(processes): add ProcessesPanel Vue component with Tailscale banner and process cards"
```

---

### Task 5: Integration Test — Full Stack Verification

**Files:**
- No new files — manual verification

- [ ] **Step 1: Build and start the dev server**

Read the codexui-dev skill or check `package.json` for the correct dev/start command:

Run: `cd C:/Users/vilum/Documents/dev/codexui && npm run dev`

Expected: Server starts without errors

- [ ] **Step 2: Verify /processes route loads**

Open `http://localhost:<port>/processes` in browser (or use Playwright to screenshot).

Expected: The Running Processes panel renders with:
- Header "Running Processes"
- Tailscale banner (or gracefully hidden if Tailscale not installed)
- Process cards for any detected dev servers
- Correct action buttons per process type

- [ ] **Step 3: Verify WebSocket connection**

Check browser DevTools Network tab → WS tab → should show `/ws/processes` connection receiving `process-list` messages every 5 seconds.

- [ ] **Step 4: Verify sidebar navigation**

Click "Processes" in sidebar → navigates to `/processes` and shows active state.
Click "Skills Hub" → navigates back to `/skills`.

- [ ] **Step 5: Test Stop action**

Start a test server (e.g., `python -m http.server 9876`), verify it appears in the process list, click Stop, verify it disappears.

- [ ] **Step 6: Final commit with any fixes**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add -A
git commit -m "feat(processes): wire up running processes panel — complete feature"
```
