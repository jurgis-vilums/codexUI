# Git Diff Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a git diff panel to codexUI showing unstaged/staged changes with diff rendering, file tree, and staging operations.

**Architecture:** Backend `gitService.ts` shells out to `git` CLI via `child_process.exec`, exposed over a `/ws/git` WebSocket endpoint. Frontend uses diff2html to render unified diffs in a resizable right-side panel with file tree, toolbar, and stage/revert actions.

**Tech Stack:** Vue 3, diff2html, child_process (git CLI), ws (WebSocket), Express 5, Vite 6

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/server/gitService.ts` | Shell out to git CLI, parse porcelain output |
| Create | `src/components/content/DiffPanel.vue` | Main diff panel container with tabs, toolbar, viewer |
| Create | `src/components/content/DiffViewer.vue` | diff2html rendering wrapper |
| Create | `src/components/content/DiffFileTree.vue` | Changed files tree with filter |
| Create | `src/components/icons/IconTablerGitBranch.vue` | Git branch icon for header button |
| Modify | `src/server/httpServer.ts` | Add `/ws/git` WebSocket upgrade handler |
| Modify | `vite.config.ts` | Add `/ws/git` WebSocket upgrade handler for dev server |
| Modify | `src/components/layout/DesktopLayout.vue` | Add diff panel slot with horizontal split |
| Modify | `src/App.vue` | Wire DiffPanel, keybinding, state, header button |
| Modify | `package.json` | Add diff2html dependency |

---

### Task 1: Install diff2html

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install npm package**

```bash
cd C:/Users/vilum/.config/superpowers/worktrees/codexui/feature-integrated-terminal
pnpm add diff2html
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('diff2html'); console.log('diff2html OK')"
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(diff): add diff2html dependency"
```

---

### Task 2: Git Service — `src/server/gitService.ts`

**Files:**
- Create: `src/server/gitService.ts`

- [ ] **Step 1: Create git service module**

```typescript
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export type GitFileStatus = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
  oldPath?: string
}

function parsePorcelainV2(output: string): GitFileStatus[] {
  const files: GitFileStatus[] = []
  const lines = output.split('\n').filter(Boolean)

  for (const line of lines) {
    if (line.startsWith('1 ')) {
      // Ordinary changed entry: 1 XY sub mH mI mW hH hI path
      const parts = line.split(' ')
      const xy = parts[1]
      const path = parts.slice(8).join(' ')
      const x = xy[0] // staged
      const y = xy[1] // unstaged

      if (x !== '.') {
        files.push({
          path,
          status: x === 'A' ? 'added' : x === 'D' ? 'deleted' : 'modified',
          staged: true,
        })
      }
      if (y !== '.') {
        files.push({
          path,
          status: y === 'A' ? 'added' : y === 'D' ? 'deleted' : 'modified',
          staged: false,
        })
      }
    } else if (line.startsWith('2 ')) {
      // Renamed entry: 2 XY sub mH mI mW hH hI X\tscore path\torigPath
      const parts = line.split('\t')
      const header = parts[0].split(' ')
      const xy = header[1]
      const newPath = parts[1]
      const oldPath = parts[2]

      if (xy[0] !== '.') {
        files.push({ path: newPath, status: 'renamed', staged: true, oldPath })
      }
      if (xy[1] !== '.') {
        files.push({ path: newPath, status: 'renamed', staged: false, oldPath })
      }
    } else if (line.startsWith('? ')) {
      // Untracked: ? path
      const path = line.slice(2)
      files.push({ path, status: 'untracked', staged: false })
    }
  }

  return files
}

async function gitExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${args.join(' ')}`, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

export async function gitStatus(cwd: string): Promise<GitFileStatus[]> {
  const { stdout } = await gitExec(['status', '--porcelain=v2'], cwd)
  return parsePorcelainV2(stdout)
}

export async function gitDiffUnstaged(cwd: string, path?: string): Promise<string> {
  const args = ['diff', '--no-color', '--unified=3']
  if (path) args.push('--', path)
  const { stdout } = await gitExec(args, cwd)
  return stdout
}

export async function gitDiffStaged(cwd: string, path?: string): Promise<string> {
  const args = ['diff', '--staged', '--no-color', '--unified=3']
  if (path) args.push('--', path)
  const { stdout } = await gitExec(args, cwd)
  return stdout
}

export async function gitStageFile(cwd: string, path: string): Promise<void> {
  await gitExec(['add', '--', path], cwd)
}

export async function gitUnstageFile(cwd: string, path: string): Promise<void> {
  await gitExec(['restore', '--staged', '--', path], cwd)
}

export async function gitStageAll(cwd: string): Promise<void> {
  await gitExec(['add', '-A'], cwd)
}

export async function gitUnstageAll(cwd: string): Promise<void> {
  await gitExec(['restore', '--staged', '.'], cwd)
}

export async function gitRevertFile(cwd: string, path: string): Promise<void> {
  await gitExec(['checkout', '--', path], cwd)
}

export async function gitRevertAll(cwd: string): Promise<void> {
  await gitExec(['checkout', '--', '.'], cwd)
}

export type GitAction =
  | { action: 'status' }
  | { action: 'diff'; staged?: boolean; path?: string }
  | { action: 'stage'; path: string }
  | { action: 'unstage'; path: string }
  | { action: 'stage-all' }
  | { action: 'unstage-all' }
  | { action: 'revert'; path: string }
  | { action: 'revert-all' }

export async function handleGitAction(msg: GitAction, cwd: string): Promise<{ action: string; data?: unknown; error?: string }> {
  try {
    switch (msg.action) {
      case 'status': {
        const files = await gitStatus(cwd)
        return { action: 'status', data: files }
      }
      case 'diff': {
        const diff = msg.staged ? await gitDiffStaged(cwd, msg.path) : await gitDiffUnstaged(cwd, msg.path)
        return { action: 'diff', data: diff }
      }
      case 'stage': {
        await gitStageFile(cwd, msg.path)
        return { action: 'stage' }
      }
      case 'unstage': {
        await gitUnstageFile(cwd, msg.path)
        return { action: 'unstage' }
      }
      case 'stage-all': {
        await gitStageAll(cwd)
        return { action: 'stage-all' }
      }
      case 'unstage-all': {
        await gitUnstageAll(cwd)
        return { action: 'unstage-all' }
      }
      case 'revert': {
        await gitRevertFile(cwd, msg.path)
        return { action: 'revert' }
      }
      case 'revert-all': {
        await gitRevertAll(cwd)
        return { action: 'revert-all' }
      }
      default:
        return { action: 'unknown', error: 'Unknown git action' }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { action: msg.action, error: message }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/gitService.ts
git commit -m "feat(diff): add git service with CLI-based status, diff, stage, revert"
```

---

### Task 3: WebSocket Endpoint — `/ws/git` (Production + Dev)

**Files:**
- Modify: `src/server/httpServer.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add import in httpServer.ts**

At the top of `src/server/httpServer.ts`, after the existing terminalPty import, add:

```typescript
import { handleGitAction, type GitAction } from './gitService.js'
```

- [ ] **Step 2: Add `/ws/git` handler in httpServer.ts**

Inside the `attachWebSocket` function, add a new `WebSocketServer` and pathname branch. After `const terminalWss = new WebSocketServer({ noServer: true })`, add:

```typescript
const gitWss = new WebSocketServer({ noServer: true })
```

In the `server.on('upgrade', ...)` handler, after the `/ws/terminal` block and before the `/codex-api/ws` check, add:

```typescript
    if (url.pathname === '/ws/git') {
      gitWss.handleUpgrade(req, socket, head, (ws) => {
        gitWss.emit('connection', ws, req)
      })
      return
    }
```

After the `terminalWss.on('connection', ...)` block, add:

```typescript
  gitWss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (msg: Buffer | string) => {
      const str = typeof msg === 'string' ? msg : msg.toString('utf-8')
      try {
        const parsed = JSON.parse(str) as GitAction
        const result = await handleGitAction(parsed, process.cwd())
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'git-result', _id: parsed._id, ...result }))
        }
      } catch (err: unknown) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'git-result', _id: null, action: 'error', error: String(err) }))
        }
      }
    })
  })
```

- [ ] **Step 3: Add import in vite.config.ts**

After the existing terminalPty import, add:

```typescript
import { handleGitAction, type GitAction } from './src/server/gitService.js'
```

- [ ] **Step 4: Add `/ws/git` handler in vite.config.ts**

Inside the `configureServer` block, after `const terminalWss = new WebSocketServer({ noServer: true })`, add:

```typescript
const gitWss = new WebSocketServer({ noServer: true });
```

In the `httpServer.on("upgrade", ...)` handler, after the `/ws/terminal` block, add:

```typescript
          if (requestUrl.pathname === "/ws/git") {
            gitWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
              gitWss.emit("connection", ws, req);
            });
            return;
          }
```

After the `terminalWss.on("connection", ...)` block, add:

```typescript
        gitWss.on("connection", (ws: WebSocket) => {
          ws.on("message", async (msg: Buffer | string) => {
            const str = typeof msg === "string" ? msg : msg.toString("utf-8");
            try {
              const parsed = JSON.parse(str) as GitAction;
              const result = await handleGitAction(parsed, process.cwd());
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: "git-result", _id: parsed._id, ...result }));
              }
            } catch (err: unknown) {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: "git-result", _id: null, action: "error", error: String(err) }));
              }
            }
          });
        });
```

Update the close handler to also close gitWss:

```typescript
        httpServer.once("close", () => {
          wss.close();
          terminalWss.close();
          gitWss.close();
        });
```

- [ ] **Step 5: Commit**

```bash
git add src/server/httpServer.ts vite.config.ts
git commit -m "feat(diff): add /ws/git WebSocket endpoint in prod and dev servers"
```

---

### Task 4: DiffViewer Component

**Files:**
- Create: `src/components/content/DiffViewer.vue`

- [ ] **Step 1: Create the DiffViewer component**

```vue
<template>
  <div ref="containerRef" class="diff-viewer" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { html, parse } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'

const props = defineProps<{
  diff: string
  outputFormat?: 'line-by-line' | 'side-by-side'
  wordWrap?: boolean
}>()

const containerRef = ref<HTMLElement | null>(null)

function render() {
  if (!containerRef.value) return
  if (!props.diff) {
    containerRef.value.innerHTML = '<div class="diff-empty">No changes</div>'
    return
  }

  const htmlContent = html(parse(props.diff), {
    drawFileList: false,
    outputFormat: props.outputFormat || 'line-by-line',
    matching: 'lines',
    highlight: true,
  })
  containerRef.value.innerHTML = htmlContent
}

watch(() => [props.diff, props.outputFormat], () => {
  nextTick(render)
})

onMounted(render)
</script>

<style scoped>
.diff-viewer {
  @apply overflow-auto h-full text-sm;
}

.diff-viewer :deep(.d2h-wrapper) {
  @apply text-sm;
}

.diff-viewer :deep(.d2h-file-header) {
  @apply sticky top-0 z-10;
}

.diff-empty {
  @apply flex items-center justify-center h-32 text-slate-400 text-sm;
}
</style>

<style>
/* diff2html dark mode overrides */
:root.dark .d2h-wrapper {
  --d2h-bg-color: #09090b;
  --d2h-dark-color: #e4e4e7;
}

:root.dark .d2h-file-header {
  background-color: #18181b !important;
  border-color: #27272a !important;
}

:root.dark .d2h-file-header .d2h-file-name {
  color: #e4e4e7 !important;
}

:root.dark .d2h-diff-table .d2h-code-linenumber,
:root.dark .d2h-diff-table .d2h-code-line {
  color: #a1a1aa !important;
}

:root.dark .d2h-code-line-ctn {
  color: #e4e4e7 !important;
}

:root.dark .d2h-del {
  background-color: #450a0a !important;
}

:root.dark .d2h-ins {
  background-color: #052e16 !important;
}

:root.dark .d2h-del .d2h-code-line-ctn {
  background-color: #450a0a !important;
}

:root.dark .d2h-ins .d2h-code-line-ctn {
  background-color: #052e16 !important;
}

:root.dark .d2h-info {
  background-color: #172554 !important;
  color: #93c5fd !important;
}

:root.dark .d2h-file-diff .d2h-code-side-line,
:root.dark .d2h-file-diff .d2h-code-line {
  background-color: #09090b !important;
}

:root.dark .d2h-emptyplaceholder {
  background-color: #18181b !important;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/content/DiffViewer.vue
git commit -m "feat(diff): add DiffViewer component with diff2html rendering and dark mode"
```

---

### Task 5: DiffFileTree Component

**Files:**
- Create: `src/components/content/DiffFileTree.vue`

- [ ] **Step 1: Create the DiffFileTree component**

```vue
<template>
  <div class="diff-file-tree">
    <input
      v-model="filter"
      type="text"
      class="diff-file-filter"
      placeholder="Filter files..."
    />
    <div class="diff-file-list">
      <template v-for="group in filteredGroups" :key="group.dir">
        <div class="diff-file-group-header">{{ group.dir || '.' }}</div>
        <button
          v-for="file in group.files"
          :key="file.path"
          type="button"
          class="diff-file-item"
          :class="{ 'is-selected': file.path === selectedPath }"
          @click="$emit('select', file.path)"
        >
          <span class="diff-file-status" :class="'status-' + file.status">{{ statusLabel(file.status) }}</span>
          <span class="diff-file-name">{{ file.name }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

type FileEntry = {
  path: string
  status: string
  staged: boolean
}

const props = defineProps<{
  files: FileEntry[]
  selectedPath?: string
}>()

defineEmits<{
  select: [path: string]
}>()

const filter = ref('')

type FileGroup = { dir: string; files: { path: string; name: string; status: string }[] }

const filteredGroups = computed<FileGroup[]>(() => {
  const filtered = props.files.filter(f =>
    !filter.value || f.path.toLowerCase().includes(filter.value.toLowerCase())
  )

  const groupMap = new Map<string, FileGroup>()
  for (const file of filtered) {
    const lastSlash = file.path.lastIndexOf('/')
    const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash) : ''
    const name = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path

    if (!groupMap.has(dir)) {
      groupMap.set(dir, { dir, files: [] })
    }
    groupMap.get(dir)!.files.push({ path: file.path, name, status: file.status })
  }

  return Array.from(groupMap.values()).sort((a, b) => a.dir.localeCompare(b.dir))
})

function statusLabel(status: string): string {
  switch (status) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return '?'
    default: return '?'
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.diff-file-tree {
  @apply flex flex-col w-64 border-l border-slate-200 bg-white overflow-hidden;
}

.diff-file-filter {
  @apply m-2 px-2 py-1 text-xs border border-slate-200 rounded bg-white text-slate-900 outline-none focus:border-blue-400;
}

.diff-file-list {
  @apply overflow-y-auto flex-1 px-1 pb-2;
}

.diff-file-group-header {
  @apply px-2 py-1 text-xs font-medium text-slate-500 truncate;
}

.diff-file-item {
  @apply flex items-center gap-1.5 w-full px-2 py-0.5 text-xs rounded cursor-pointer hover:bg-slate-100 truncate text-left;
}

.diff-file-item.is-selected {
  @apply bg-blue-50 text-blue-700;
}

.diff-file-status {
  @apply font-mono text-xs w-4 text-center flex-shrink-0;
}

.status-modified { @apply text-yellow-600; }
.status-added { @apply text-green-600; }
.status-deleted { @apply text-red-600; }
.status-renamed { @apply text-blue-600; }
.status-untracked { @apply text-slate-400; }

.diff-file-name {
  @apply truncate;
}

:global(:root.dark) .diff-file-tree {
  @apply border-zinc-700 bg-zinc-900;
}

:global(:root.dark) .diff-file-filter {
  @apply border-zinc-600 bg-zinc-800 text-zinc-100;
}

:global(:root.dark) .diff-file-group-header {
  @apply text-zinc-400;
}

:global(:root.dark) .diff-file-item {
  @apply hover:bg-zinc-800 text-zinc-300;
}

:global(:root.dark) .diff-file-item.is-selected {
  @apply bg-zinc-700 text-blue-300;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/content/DiffFileTree.vue
git commit -m "feat(diff): add DiffFileTree component with filter and directory grouping"
```

---

### Task 6: DiffPanel Component — Main Container

**Files:**
- Create: `src/components/content/DiffPanel.vue`

- [ ] **Step 1: Create the DiffPanel component**

```vue
<template>
  <div class="diff-panel">
    <!-- Toolbar -->
    <div class="diff-toolbar">
      <div class="diff-tabs">
        <button
          type="button"
          class="diff-tab"
          :class="{ 'is-active': activeTab === 'unstaged' }"
          @click="activeTab = 'unstaged'; refresh()"
        >
          Unstaged
          <span v-if="unstagedCount > 0" class="diff-tab-badge">{{ unstagedCount }}</span>
        </button>
        <button
          type="button"
          class="diff-tab"
          :class="{ 'is-active': activeTab === 'staged' }"
          @click="activeTab = 'staged'; refresh()"
        >
          Staged
          <span v-if="stagedCount > 0" class="diff-tab-badge">{{ stagedCount }}</span>
        </button>
      </div>
      <div class="diff-toolbar-actions">
        <button type="button" class="diff-toolbar-btn" title="Toggle file tree" @click="showFileTree = !showFileTree">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
        </button>
        <button type="button" class="diff-toolbar-btn" title="Toggle side-by-side" @click="toggleSplitView">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h18v18H3zM12 3v18"/></svg>
        </button>
        <button type="button" class="diff-toolbar-btn" title="Refresh" @click="refresh">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4m-4 4a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>
        </button>
      </div>
    </div>

    <!-- Content area -->
    <div class="diff-content">
      <div class="diff-viewer-area">
        <DiffViewer
          :diff="currentDiff"
          :output-format="splitView ? 'side-by-side' : 'line-by-line'"
        />
        <!-- Bottom actions -->
        <div v-if="currentDiff" class="diff-bottom-actions">
          <template v-if="activeTab === 'unstaged'">
            <button type="button" class="diff-action-btn diff-action-revert" @click="revertAll">Revert all</button>
            <button type="button" class="diff-action-btn diff-action-stage" @click="stageAll">Stage all</button>
          </template>
          <template v-else>
            <button type="button" class="diff-action-btn diff-action-unstage" @click="unstageAll">Unstage all</button>
          </template>
        </div>
      </div>
      <DiffFileTree
        v-if="showFileTree"
        :files="currentFiles"
        :selected-path="selectedFilePath"
        @select="onFileSelect"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import DiffViewer from './DiffViewer.vue'
import DiffFileTree from './DiffFileTree.vue'

const props = defineProps<{
  visible: boolean
}>()

type GitFileStatus = {
  path: string
  status: string
  staged: boolean
}

const activeTab = ref<'unstaged' | 'staged'>('unstaged')
const showFileTree = ref(false)
const splitView = ref(loadSplitView())
const selectedFilePath = ref<string | undefined>()

const allFiles = ref<GitFileStatus[]>([])
const unstagedDiff = ref('')
const stagedDiff = ref('')

let ws: WebSocket | null = null
let pendingCallbacks = new Map<string, (data: unknown) => void>()

const unstagedCount = computed(() => allFiles.value.filter(f => !f.staged).length)
const stagedCount = computed(() => allFiles.value.filter(f => f.staged).length)
const currentFiles = computed(() => allFiles.value.filter(f => activeTab.value === 'staged' ? f.staged : !f.staged))
const currentDiff = computed(() => activeTab.value === 'staged' ? stagedDiff.value : unstagedDiff.value)

function loadSplitView(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem('codex-web-local.diff-split-view.v1') === '1'
}

function saveSplitView(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('codex-web-local.diff-split-view.v1', value ? '1' : '0')
}

function toggleSplitView(): void {
  splitView.value = !splitView.value
  saveSplitView(splitView.value)
}

function connectWebSocket(): void {
  if (ws && ws.readyState <= 1) return

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws/git`)

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'git-result' && msg._id) {
        const cb = pendingCallbacks.get(msg._id)
        if (cb) {
          pendingCallbacks.delete(msg._id)
          cb(msg)
        }
      }
    } catch { /* ignore */ }
  }

  ws.onclose = () => { ws = null }
}

let reqId = 0

function sendGit(action: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolve({ error: 'Not connected' })
      return
    }
    const id = String(++reqId)
    pendingCallbacks.set(id, resolve)
    ws.send(JSON.stringify({ ...action, _id: id }))
  })
}

async function refresh(): Promise<void> {
  connectWebSocket()
  // Small delay to ensure connection is ready
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    await new Promise<void>(r => { ws!.onopen = () => r() })
  }

  const [statusResult, unstagedResult, stagedResult] = await Promise.all([
    sendGit({ action: 'status' }),
    sendGit({ action: 'diff', staged: false }),
    sendGit({ action: 'diff', staged: true }),
  ]) as [
    { data?: GitFileStatus[] },
    { data?: string },
    { data?: string },
  ]

  if (statusResult.data) allFiles.value = statusResult.data
  if (typeof unstagedResult.data === 'string') unstagedDiff.value = unstagedResult.data
  if (typeof stagedResult.data === 'string') stagedDiff.value = stagedResult.data
}

async function stageAll(): Promise<void> {
  await sendGit({ action: 'stage-all' })
  await refresh()
}

async function unstageAll(): Promise<void> {
  await sendGit({ action: 'unstage-all' })
  await refresh()
}

async function revertAll(): Promise<void> {
  await sendGit({ action: 'revert-all' })
  await refresh()
}

function onFileSelect(path: string): void {
  selectedFilePath.value = path
  // Scroll to file in diff viewer could be implemented later
}

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    refresh()
  }
})

onMounted(() => {
  if (props.visible) {
    connectWebSocket()
    refresh()
  }
})

onBeforeUnmount(() => {
  ws?.close()
  ws = null
  pendingCallbacks.clear()
})
</script>

<style scoped>
@reference "tailwindcss";

.diff-panel {
  @apply flex flex-col h-full overflow-hidden bg-white;
}

.diff-toolbar {
  @apply flex items-center justify-between px-2 py-1 border-b border-slate-200 flex-shrink-0;
}

.diff-tabs {
  @apply flex items-center gap-0;
}

.diff-tab {
  @apply px-3 py-1.5 text-xs font-medium text-slate-500 cursor-pointer border-b-2 border-transparent transition-colors;
}

.diff-tab.is-active {
  @apply text-slate-900 border-slate-900;
}

.diff-tab-badge {
  @apply ml-1 px-1.5 py-0.5 text-xs rounded-full bg-slate-200 text-slate-600;
}

.diff-toolbar-actions {
  @apply flex items-center gap-0.5;
}

.diff-toolbar-btn {
  @apply p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded cursor-pointer transition-colors text-base;
}

.diff-content {
  @apply flex flex-1 overflow-hidden;
}

.diff-viewer-area {
  @apply flex-1 flex flex-col overflow-hidden min-w-0;
}

.diff-bottom-actions {
  @apply flex items-center justify-center gap-2 px-3 py-2 border-t border-slate-200 flex-shrink-0;
}

.diff-action-btn {
  @apply px-3 py-1 text-xs font-medium rounded cursor-pointer transition-colors;
}

.diff-action-stage {
  @apply bg-green-600 text-white hover:bg-green-700;
}

.diff-action-revert {
  @apply bg-slate-200 text-slate-700 hover:bg-slate-300;
}

.diff-action-unstage {
  @apply bg-slate-200 text-slate-700 hover:bg-slate-300;
}

/* Dark mode */
:global(:root.dark) .diff-panel {
  @apply bg-zinc-950;
}

:global(:root.dark) .diff-toolbar {
  @apply border-zinc-700;
}

:global(:root.dark) .diff-tab {
  @apply text-zinc-400;
}

:global(:root.dark) .diff-tab.is-active {
  @apply text-zinc-100 border-zinc-100;
}

:global(:root.dark) .diff-tab-badge {
  @apply bg-zinc-700 text-zinc-300;
}

:global(:root.dark) .diff-toolbar-btn {
  @apply text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800;
}

:global(:root.dark) .diff-bottom-actions {
  @apply border-zinc-700;
}

:global(:root.dark) .diff-action-revert,
:global(:root.dark) .diff-action-unstage {
  @apply bg-zinc-700 text-zinc-200 hover:bg-zinc-600;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/content/DiffPanel.vue
git commit -m "feat(diff): add DiffPanel with tabs, toolbar, WebSocket git client, staging actions"
```

---

### Task 7: Layout Integration — `DesktopLayout.vue`

**Files:**
- Modify: `src/components/layout/DesktopLayout.vue`

The current `.desktop-main` is a flex-column (content + terminal stacked vertically). To add a right side panel, we wrap the existing content+terminal in a horizontal flex container.

- [ ] **Step 1: Add `isDiffPanelOpen` prop**

Update the props definition to include `isDiffPanelOpen`:

```typescript
const props = withDefaults(
  defineProps<{
    isSidebarCollapsed?: boolean
    isTerminalOpen?: boolean
    isDiffPanelOpen?: boolean
  }>(),
  {
    isSidebarCollapsed: false,
    isTerminalOpen: false,
    isDiffPanelOpen: false,
  },
)
```

- [ ] **Step 2: Add diff panel width state**

After the terminal height state block, add:

```typescript
const DIFF_PANEL_WIDTH_KEY = 'codex-web-local.diff-panel-width.v1'
const MIN_DIFF_PANEL_WIDTH = 300
const MAX_DIFF_PANEL_FRACTION = 0.7
const DEFAULT_DIFF_PANEL_WIDTH = 500

function loadDiffPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DIFF_PANEL_WIDTH
  const raw = window.localStorage.getItem(DIFF_PANEL_WIDTH_KEY)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_DIFF_PANEL_WIDTH
  return Math.max(MIN_DIFF_PANEL_WIDTH, parsed)
}

function saveDiffPanelWidth(value: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DIFF_PANEL_WIDTH_KEY, String(value))
}

const diffPanelWidth = ref(loadDiffPanelWidth())

function onDiffResizeHandleMouseDown(event: MouseEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = diffPanelWidth.value
  const mainEl = document.querySelector('.desktop-main') as HTMLElement | null
  const maxWidth = mainEl ? mainEl.clientWidth * MAX_DIFF_PANEL_FRACTION : 800

  const onMouseMove = (moveEvent: MouseEvent) => {
    const delta = startX - moveEvent.clientX
    diffPanelWidth.value = Math.min(maxWidth, Math.max(MIN_DIFF_PANEL_WIDTH, startWidth + delta))
  }

  const onMouseUp = () => {
    saveDiffPanelWidth(diffPanelWidth.value)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
```

- [ ] **Step 3: Update the template**

Replace the `<section class="desktop-main">` block with a horizontal wrapper:

```html
    <section class="desktop-main">
      <div class="desktop-main-left">
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
      </div>
      <template v-if="isDiffPanelOpen">
        <button
          class="diff-resize-handle"
          type="button"
          aria-label="Resize diff panel"
          @mousedown="onDiffResizeHandleMouseDown"
        />
        <div class="desktop-diff-panel" :style="{ width: diffPanelWidth + 'px' }">
          <slot name="diff" />
        </div>
      </template>
    </section>
```

- [ ] **Step 4: Add CSS**

Add to the `<style scoped>` section:

```css
.desktop-main {
  @apply flex flex-row overflow-hidden;
}

.desktop-main-left {
  @apply flex flex-col flex-1 min-w-0 overflow-hidden;
}

.diff-resize-handle {
  @apply relative w-px cursor-col-resize bg-slate-300 hover:bg-slate-400 transition flex-shrink-0;
}

.diff-resize-handle::before {
  content: '';
  @apply absolute -left-2 -right-2 top-0 bottom-0;
}

.desktop-diff-panel {
  @apply flex-shrink-0 overflow-hidden;
}

:global(:root.dark) .diff-resize-handle {
  @apply bg-zinc-700 hover:bg-zinc-600;
}
```

Also update the existing `.desktop-main` rule — remove the old `flex flex-col` since it's now `flex flex-row`. The flex-col is moved to `.desktop-main-left`.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/DesktopLayout.vue
git commit -m "feat(diff): add diff panel slot with horizontal split and resize handle"
```

---

### Task 8: Wire Everything in App.vue

**Files:**
- Modify: `src/App.vue`
- Create: `src/components/icons/IconTablerGitBranch.vue`

- [ ] **Step 1: Create git branch icon**

```vue
<template>
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 8v8m10-10v4a2 2 0 0 1-2 2H9"
    />
  </svg>
</template>
```

- [ ] **Step 2: Add imports in App.vue**

```typescript
import DiffPanel from './components/content/DiffPanel.vue'
import IconTablerGitBranch from './components/icons/IconTablerGitBranch.vue'
```

- [ ] **Step 3: Add diff panel state**

After the terminal state block, add:

```typescript
const DIFF_PANEL_OPEN_STORAGE_KEY = 'codex-web-local.diff-panel-open.v1'

function loadDiffPanelOpen(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(DIFF_PANEL_OPEN_STORAGE_KEY) === '1'
}

function saveDiffPanelOpen(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DIFF_PANEL_OPEN_STORAGE_KEY, value ? '1' : '0')
}

const isDiffPanelOpen = ref(loadDiffPanelOpen())

function toggleDiffPanel(): void {
  isDiffPanelOpen.value = !isDiffPanelOpen.value
  saveDiffPanelOpen(isDiffPanelOpen.value)
}
```

- [ ] **Step 4: Update `onWindowKeyDown()` to handle Alt+Ctrl+B**

Replace the current `onWindowKeyDown` function with:

```typescript
function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (!event.ctrlKey && !event.metaKey) return

  const key = event.key.toLowerCase()

  if (!event.shiftKey && !event.altKey) {
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

  if (event.altKey && !event.shiftKey) {
    if (key === 'b') {
      event.preventDefault()
      toggleDiffPanel()
      return
    }
  }
}
```

- [ ] **Step 5: Add diff panel button to header actions**

In the template, add the diff toggle button after the terminal toggle button in the `#actions` slot:

```html
          <template #actions>
            <button
              type="button"
              class="terminal-toggle-btn"
              :class="{ 'is-active': isTerminalOpen }"
              title="Toggle terminal (Ctrl+`)"
              @click="toggleTerminal"
            >
              <IconTablerTerminal />
            </button>
            <button
              type="button"
              class="terminal-toggle-btn"
              :class="{ 'is-active': isDiffPanelOpen }"
              title="Toggle diff panel (Alt+Ctrl+B)"
              @click="toggleDiffPanel"
            >
              <IconTablerGitBranch />
            </button>
          </template>
```

- [ ] **Step 6: Pass diff panel props and slot to DesktopLayout**

Update the `<DesktopLayout>` tag:

```html
<DesktopLayout :is-sidebar-collapsed="isSidebarCollapsed" :is-terminal-open="isTerminalOpen" :is-diff-panel-open="isDiffPanelOpen" @close-sidebar="setSidebarCollapsed(true)">
```

Add the diff slot inside DesktopLayout, after the terminal slot:

```html
        <template #diff>
          <DiffPanel :visible="isDiffPanelOpen" />
        </template>
```

- [ ] **Step 7: Commit**

```bash
git add src/components/icons/IconTablerGitBranch.vue src/App.vue
git commit -m "feat(diff): wire DiffPanel into App.vue with Alt+Ctrl+B toggle and header button"
```

---

### Task 9: Mobile Responsive Behavior

**Files:**
- Modify: `src/components/layout/DesktopLayout.vue`
- Modify: `src/App.vue`

On mobile, the diff panel replaces the main content instead of being a side panel.

- [ ] **Step 1: Update DesktopLayout template for mobile**

In the `<section class="desktop-main">` template, wrap the diff panel section with a mobile check. The `isMobile` composable is already imported. When mobile, show the diff slot instead of the content:

After the existing mobile teleport block at the top of the template, the desktop-main section should handle mobile diff differently. Update the template:

```html
    <section class="desktop-main">
      <div v-if="!(isMobile && isDiffPanelOpen)" class="desktop-main-left">
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
      </div>
      <template v-if="isDiffPanelOpen">
        <button
          v-if="!isMobile"
          class="diff-resize-handle"
          type="button"
          aria-label="Resize diff panel"
          @mousedown="onDiffResizeHandleMouseDown"
        />
        <div class="desktop-diff-panel" :style="isMobile ? {} : { width: diffPanelWidth + 'px' }">
          <slot name="diff" />
        </div>
      </template>
    </section>
```

- [ ] **Step 2: Add mobile CSS for full-width diff**

```css
.desktop-layout.is-mobile .desktop-diff-panel {
  @apply flex-1;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/DesktopLayout.vue
git commit -m "feat(diff): mobile responsive — diff panel replaces content on small screens"
```

---

### Task 10: Verify End-to-End

**Files:** None (verification only)

- [ ] **Step 1: Restart dev server**

Kill the existing Vite process and restart:

```bash
cd C:/Users/vilum/.config/superpowers/worktrees/codexui/feature-integrated-terminal
pnpm dev
```

- [ ] **Step 2: Test diff panel toggle**

Open the app in browser. Click the git branch icon in the header bar. Diff panel should appear on the right. Click again — it should hide. Test Alt+Ctrl+B keyboard shortcut.

- [ ] **Step 3: Test diff content**

Make a change to any file in the worktree. Open the diff panel. The "Unstaged" tab should show the diff with syntax highlighting.

- [ ] **Step 4: Test staging**

Click "Stage all" at the bottom. The diff should move to the "Staged" tab. Click "Unstage all" — it should move back.

- [ ] **Step 5: Test resize**

Drag the diff panel resize handle left and right. Width should change smoothly. Reload — width should persist.

- [ ] **Step 6: Test file tree**

Click the folder icon in the toolbar. File tree should appear on the right with changed files grouped by directory. Filter input should work.

- [ ] **Step 7: Test side-by-side view**

Click the split icon in the toolbar. Diff should switch to side-by-side format.

- [ ] **Step 8: Test alongside terminal**

Open both terminal (Ctrl+`) and diff panel (Alt+Ctrl+B). Both should be visible simultaneously.

- [ ] **Step 9: Take Playwright screenshot**

```bash
npx playwright screenshot http://localhost:5175 --wait-for-timeout 2000 diff-verify.png
```
