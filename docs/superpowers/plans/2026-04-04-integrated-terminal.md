# Integrated Terminal Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an embedded xterm.js terminal panel to codexUI's content area with a real shell session via node-pty, toggled with Ctrl+`.

**Architecture:** A PTY process is spawned server-side via `node-pty` and exposed over a dedicated WebSocket endpoint (`/ws/terminal`). The frontend renders xterm.js in a resizable bottom panel within the content area. The PTY survives client disconnects for 5 minutes.

**Tech Stack:** Vue 3, xterm.js, @xterm/addon-fit, node-pty, ws (WebSocket), Express 5, Vite 6

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/server/terminalPty.ts` | PTY lifecycle management (spawn, resize, destroy, reconnect grace period) |
| Create | `src/components/content/TerminalPanel.vue` | xterm.js renderer, WebSocket client, theme sync, fit-on-resize |
| Modify | `src/server/httpServer.ts` | Add `/ws/terminal` WebSocket upgrade handler |
| Modify | `vite.config.ts` | Add `/ws/terminal` WebSocket upgrade handler for dev server |
| Modify | `src/components/layout/DesktopLayout.vue` | Add terminal slot, vertical split with drag handle |
| Modify | `src/App.vue` | Wire TerminalPanel into layout, add Ctrl+` keybinding, terminal open state |
| Modify | `src/style.css` | Dark mode styles for terminal panel and resize handle |
| Modify | `package.json` | Add xterm, @xterm/addon-fit, node-pty dependencies |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install npm packages**

```bash
cd C:/Users/vilum/Documents/dev/codexui
pnpm add xterm @xterm/addon-fit node-pty
```

- [ ] **Step 2: Verify installation**

```bash
cd C:/Users/vilum/Documents/dev/codexui
node -e "require('node-pty'); console.log('node-pty OK')"
node -e "require('xterm'); console.log('xterm OK')"
```

Expected: Both print OK without errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add package.json pnpm-lock.yaml
git commit -m "feat(terminal): add xterm, @xterm/addon-fit, node-pty dependencies"
```

---

### Task 2: PTY Manager — `src/server/terminalPty.ts`

**Files:**
- Create: `src/server/terminalPty.ts`

- [ ] **Step 1: Create PTY manager module**

```typescript
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
  if (platform() === 'win32') return 'powershell.exe'
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
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/server/terminalPty.ts
git commit -m "feat(terminal): add PTY manager with spawn, resize, grace period"
```

---

### Task 3: WebSocket Endpoint — Production Server

**Files:**
- Modify: `src/server/httpServer.ts:226-258`

The existing `attachWebSocket` function handles the `/codex-api/ws` upgrade. We add a second pathname check for `/ws/terminal` that routes to the PTY manager.

- [ ] **Step 1: Add import at top of httpServer.ts**

At the top of `src/server/httpServer.ts`, after the existing imports (around line 10), add:

```typescript
import { getOrCreateSession, attachDataListener, writeToSession, resizeSession, startGracePeriod } from './terminalPty.js'
```

- [ ] **Step 2: Add terminal WebSocket handler inside `attachWebSocket`**

In `src/server/httpServer.ts`, inside the `attachWebSocket` function, the `server.on('upgrade', ...)` handler currently returns early if pathname is not `/codex-api/ws`. We need to add a second WebSocket server for `/ws/terminal` before that check.

Add a new `WebSocketServer` instance and a second pathname branch. The full `attachWebSocket` function becomes:

```typescript
attachWebSocket: (server: HttpServer) => {
  const wss = new WebSocketServer({ noServer: true })
  const terminalWss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost')

    if (authSession && !authSession.isRequestAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    if (url.pathname === '/ws/terminal') {
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalWss.emit('connection', ws, req)
      })
      return
    }

    if (url.pathname !== '/codex-api/ws') {
      return
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req)
    })
  })

  terminalWss.on('connection', (ws: WebSocket) => {
    const sess = getOrCreateSession()
    attachDataListener((data: string) => {
      if (ws.readyState === 1) ws.send(data)
    })

    ws.on('message', (msg: Buffer | string) => {
      const str = typeof msg === 'string' ? msg : msg.toString('utf-8')
      try {
        const parsed = JSON.parse(str)
        if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
          resizeSession(parsed.cols, parsed.rows)
          return
        }
      } catch {
        // Not JSON — treat as raw terminal input
      }
      writeToSession(str)
    })

    ws.on('close', () => {
      startGracePeriod()
    })

    ws.on('error', () => {
      startGracePeriod()
    })
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const wsUrl = new URL(req.url ?? '', 'http://localhost')
    const wsBackend = wsUrl.searchParams.get('backend') === 'claude' ? 'claude' as const : 'codex' as const
    ws.send(JSON.stringify({ method: 'ready', params: { ok: true }, atIso: new Date().toISOString() }))
    const unsubscribe = bridge.subscribeNotifications((notification) => {
      if (ws.readyState !== 1) return
      ws.send(JSON.stringify(notification))
    }, wsBackend)

    ws.on('close', unsubscribe)
    ws.on('error', unsubscribe)
  })
}
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/server/httpServer.ts
git commit -m "feat(terminal): add /ws/terminal WebSocket endpoint in production server"
```

---

### Task 4: WebSocket Endpoint — Vite Dev Server

**Files:**
- Modify: `vite.config.ts:104-145`

The Vite dev server has its own WebSocket setup in the `codex-bridge` plugin. We add the same `/ws/terminal` handling there.

- [ ] **Step 1: Add import at top of vite.config.ts**

After the existing imports in `vite.config.ts`, add:

```typescript
import { getOrCreateSession, attachDataListener, writeToSession, resizeSession, startGracePeriod } from './src/server/terminalPty.js'
```

- [ ] **Step 2: Add terminal WebSocket handling in the `configureServer` plugin**

Inside the `configureServer(server)` block in `vite.config.ts`, after the existing `httpServer.on("upgrade", ...)` handler, add a second `WebSocketServer` for the terminal. Modify the existing upgrade handler to branch on pathname:

Add a new `WebSocketServer` instance right after the existing `const wss = new WebSocketServer({ noServer: true })`:

```typescript
const terminalWss = new WebSocketServer({ noServer: true });
```

Replace the existing `httpServer.on("upgrade", ...)` handler to also handle `/ws/terminal`:

```typescript
httpServer.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url ?? "", "http://localhost");

  if (requestUrl.pathname === "/ws/terminal") {
    terminalWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      terminalWss.emit("connection", ws, req);
    });
    return;
  }

  if (requestUrl.pathname !== "/codex-api/ws") return;
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wss.emit("connection", ws, req);
  });
});
```

Add the terminal connection handler after the existing `wss.on("connection", ...)` block:

```typescript
terminalWss.on("connection", (ws: WebSocket) => {
  const sess = getOrCreateSession();
  attachDataListener((data: string) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ws.on("message", (msg: Buffer | string) => {
    const str = typeof msg === "string" ? msg : msg.toString("utf-8");
    try {
      const parsed = JSON.parse(str);
      if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
        resizeSession(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — raw terminal input
    }
    writeToSession(str);
  });

  ws.on("close", () => startGracePeriod());
  ws.on("error", () => startGracePeriod());
});
```

Add cleanup alongside the existing `httpServer.once("close", ...)`:

```typescript
httpServer.once("close", () => {
  wss.close();
  terminalWss.close();
});
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add vite.config.ts
git commit -m "feat(terminal): add /ws/terminal WebSocket handler in Vite dev server"
```

---

### Task 5: Terminal Panel Component — `TerminalPanel.vue`

**Files:**
- Create: `src/components/content/TerminalPanel.vue`

- [ ] **Step 1: Create the TerminalPanel component**

```vue
<template>
  <div ref="terminalContainerRef" class="terminal-panel" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

const props = defineProps<{
  visible: boolean
}>()

const terminalContainerRef = ref<HTMLElement | null>(null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1e293b',
  cursor: '#1e293b',
  selectionBackground: '#94a3b833',
  black: '#1e293b',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f1f5f9',
  brightBlack: '#64748b',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
}

const DARK_THEME = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  selectionBackground: '#3f3f4633',
  black: '#09090b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#71717a',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function connectWebSocket(): void {
  if (ws && ws.readyState <= 1) return

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws/terminal`)

  ws.onopen = () => {
    if (terminal && fitAddon) {
      fitAddon.fit()
      ws!.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
  }

  ws.onmessage = (event) => {
    terminal?.write(event.data)
  }

  ws.onclose = () => {
    // Will reconnect on next toggle-open
  }
}

function initTerminal(): void {
  if (!terminalContainerRef.value || terminal) return

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, monospace",
    theme: isDark() ? DARK_THEME : LIGHT_THEME,
    convertEol: true,
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalContainerRef.value)

  terminal.onData((data: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  })

  resizeObserver = new ResizeObserver(() => {
    if (!props.visible || !fitAddon || !terminal) return
    fitAddon.fit()
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
  })
  resizeObserver.observe(terminalContainerRef.value)

  connectWebSocket()
}

watch(() => props.visible, async (isVisible) => {
  if (isVisible) {
    await nextTick()
    if (!terminal) {
      initTerminal()
    } else {
      fitAddon?.fit()
      connectWebSocket()
      terminal.focus()
    }
  }
})

watch(() => isDark(), (dark) => {
  terminal?.options && (terminal.options.theme = dark ? DARK_THEME : LIGHT_THEME)
})

onMounted(() => {
  if (props.visible) {
    initTerminal()
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  ws?.close()
  terminal?.dispose()
  terminal = null
  fitAddon = null
  ws = null
})
</script>

<style scoped>
.terminal-panel {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-panel :deep(.xterm) {
  height: 100%;
  padding: 4px 0 0 4px;
}

.terminal-panel :deep(.xterm-viewport) {
  overflow-y: auto;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/components/content/TerminalPanel.vue
git commit -m "feat(terminal): add TerminalPanel.vue with xterm.js and WebSocket client"
```

---

### Task 6: Layout Integration — `DesktopLayout.vue`

**Files:**
- Modify: `src/components/layout/DesktopLayout.vue`

Add a terminal slot below the content area with a vertical resize handle, following the same drag pattern used for the sidebar.

- [ ] **Step 1: Add terminal props and resize state**

In the `<script setup>` section of `DesktopLayout.vue`, add new props, constants, and the resize logic:

After the existing `isSidebarCollapsed` prop (line 38), add:

```typescript
const props = withDefaults(
  defineProps<{
    isSidebarCollapsed?: boolean
    isTerminalOpen?: boolean
  }>(),
  {
    isSidebarCollapsed: false,
    isTerminalOpen: false,
  },
)
```

After the sidebar width constants (line 54), add:

```typescript
const TERMINAL_HEIGHT_KEY = 'codex-web-local.terminal-height.v1'
const MIN_TERMINAL_HEIGHT = 100
const MAX_TERMINAL_FRACTION = 0.7
const DEFAULT_TERMINAL_HEIGHT = 250

function loadTerminalHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_TERMINAL_HEIGHT
  const raw = window.localStorage.getItem(TERMINAL_HEIGHT_KEY)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_HEIGHT
  return Math.max(MIN_TERMINAL_HEIGHT, parsed)
}

function saveTerminalHeight(value: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TERMINAL_HEIGHT_KEY, String(value))
}

const terminalHeight = ref(loadTerminalHeight())

function onTerminalResizeHandleMouseDown(event: MouseEvent): void {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = terminalHeight.value
  const mainEl = document.querySelector('.desktop-main') as HTMLElement | null
  const maxHeight = mainEl ? mainEl.clientHeight * MAX_TERMINAL_FRACTION : 500

  const onMouseMove = (moveEvent: MouseEvent) => {
    const delta = startY - moveEvent.clientY
    terminalHeight.value = Math.min(maxHeight, Math.max(MIN_TERMINAL_HEIGHT, startHeight + delta))
  }

  const onMouseUp = () => {
    saveTerminalHeight(terminalHeight.value)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
```

- [ ] **Step 2: Update the template**

Replace the `<section class="desktop-main">` block in the template with:

```html
<section class="desktop-main">
  <div class="desktop-main-content" :style="isTerminalOpen ? { flex: '1 1 0', minHeight: '0' } : { flex: '1 1 0' }">
    <slot name="content" />
  </div>
  <template v-if="isTerminalOpen">
    <button
      class="terminal-resize-handle"
      type="button"
      aria-label="Resize terminal"
      @mousedown="onTerminalResizeHandleMouseDown"
    />
    <div class="desktop-terminal" :style="{ height: terminalHeight + 'px' }">
      <slot name="terminal" />
    </div>
  </template>
</section>
```

- [ ] **Step 3: Add CSS for the terminal layout**

Add to the `<style scoped>` section:

```css
.desktop-main {
  @apply flex flex-col overflow-hidden;
}

.desktop-main-content {
  @apply overflow-hidden;
}

.terminal-resize-handle {
  @apply relative h-px cursor-row-resize bg-slate-300 hover:bg-slate-400 transition flex-shrink-0;
}

.terminal-resize-handle::before {
  content: '';
  @apply absolute -top-2 -bottom-2 left-0 right-0;
}

.desktop-terminal {
  @apply flex-shrink-0 overflow-hidden;
}
```

- [ ] **Step 4: Add dark mode styles for terminal**

Add in the `<style scoped>` section alongside existing dark mode rules:

```css
:global(:root.dark) .terminal-resize-handle {
  @apply bg-zinc-700 hover:bg-zinc-600;
}
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/components/layout/DesktopLayout.vue
git commit -m "feat(terminal): add terminal slot with vertical resize handle to DesktopLayout"
```

---

### Task 7: Wire Everything in App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add TerminalPanel import**

At the top of App.vue's `<script setup>`, alongside the other component imports, add:

```typescript
import TerminalPanel from './components/content/TerminalPanel.vue'
```

- [ ] **Step 2: Add terminal open state**

Near the `SIDEBAR_COLLAPSED_STORAGE_KEY` constant (line 341) and `isSidebarCollapsed` ref (line 530), add:

```typescript
const TERMINAL_OPEN_STORAGE_KEY = 'codex-web-local.terminal-open.v1'

function loadTerminalOpen(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(TERMINAL_OPEN_STORAGE_KEY) === '1'
}

function saveTerminalOpen(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TERMINAL_OPEN_STORAGE_KEY, value ? '1' : '0')
}

const isTerminalOpen = ref(loadTerminalOpen())

function toggleTerminal(): void {
  isTerminalOpen.value = !isTerminalOpen.value
  saveTerminalOpen(isTerminalOpen.value)
}
```

- [ ] **Step 3: Update `onWindowKeyDown()` to handle Ctrl+`**

Replace the existing `onWindowKeyDown` function (lines 934-941) with:

```typescript
function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return

  const key = event.key.toLowerCase()

  if (key === 'b') {
    event.preventDefault()
    setSidebarCollapsed(!isSidebarCollapsed.value)
    return
  }

  if (key === '`') {
    event.preventDefault()
    toggleTerminal()
    return
  }
}
```

- [ ] **Step 4: Pass terminal props and slot to DesktopLayout**

In the template, update the `<DesktopLayout>` usage to pass the terminal prop and add the terminal slot:

Add `:is-terminal-open="isTerminalOpen"` to the DesktopLayout component:

```html
<DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" :is-terminal-open="isTerminalOpen" @close-sidebar="setSidebarCollapsed(true)">
```

Add the terminal slot inside `<DesktopLayout>`, after the existing content slot:

```html
<template #terminal>
  <TerminalPanel :visible="isTerminalOpen" />
</template>
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/App.vue
git commit -m "feat(terminal): wire TerminalPanel into App.vue with Ctrl+\` toggle"
```

---

### Task 8: Verify End-to-End

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

```bash
cd C:/Users/vilum/Documents/dev/codexui
pnpm dev
```

Expected: Vite dev server starts on port 5173.

- [ ] **Step 2: Open browser and test Ctrl+` toggle**

Open `http://localhost:5173`. Press Ctrl+`. Terminal panel should appear at the bottom of the content area. Press Ctrl+` again — it should hide.

- [ ] **Step 3: Test terminal I/O**

With the terminal open, type `echo hello` and press Enter. The output `hello` should appear. Test `ls`, `pwd`, etc.

- [ ] **Step 4: Test resize**

Drag the terminal resize handle up and down. Height should change smoothly. Reload the page — height should persist.

- [ ] **Step 5: Test dark/light mode**

Toggle dark mode in settings. Terminal background should switch themes.

- [ ] **Step 6: Test session persistence**

Type something in the terminal. Close the panel with Ctrl+`. Reopen — shell history and state should be intact.

- [ ] **Step 7: Take Playwright screenshot for verification**

```bash
cd C:/Users/vilum/Documents/dev/codexui
npx playwright screenshot http://localhost:5173 --wait-for-timeout 2000 terminal-verify.png
```

- [ ] **Step 8: Commit verification screenshot cleanup**

Delete `terminal-verify.png` after confirming. No commit needed for this step.
