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
