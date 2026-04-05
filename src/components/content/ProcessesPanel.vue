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

    <!-- Process List (grouped) -->
    <div class="processes-list">
      <div v-for="group in groupedProcesses" :key="group.type" class="process-group">
        <div class="process-group-label">{{ group.label }}</div>
        <div
          v-for="proc in group.items"
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
              @click="handleStop(proc)"
            >Stop</button>
            <span v-if="proc.type === 'unknown'" class="unknown-label">unknown type</span>
          </div>
        </div>
      </div>

      <div v-if="processes.length === 0" class="processes-empty">
        No dev server processes detected.
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="processes-toast" :class="toast.type === 'error' ? 'toast-error' : 'toast-success'">
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

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

const TYPE_ORDER: Record<string, number> = { web: 0, backend: 1, unknown: 2 }
const TYPE_LABELS: Record<string, string> = { web: 'Frontends', backend: 'Backends', unknown: 'Other' }

interface ProcessGroup {
  type: string
  label: string
  items: ProcessInfo[]
}

const groupedProcesses = computed<ProcessGroup[]>(() => {
  const groups = new Map<string, ProcessInfo[]>()
  for (const proc of processes.value) {
    const list = groups.get(proc.type) ?? []
    list.push(proc)
    groups.set(proc.type, list)
  }
  return Array.from(groups.entries())
    .sort((a, b) => (TYPE_ORDER[a[0]] ?? 9) - (TYPE_ORDER[b[0]] ?? 9))
    .map(([type, items]) => ({ type, label: TYPE_LABELS[type] ?? type, items }))
})
const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null)
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(text: string, type: 'success' | 'error'): void {
  toast.value = { text, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 3000)
}

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
        if (data.success) {
          showToast('Process stopped', 'success')
        } else if (data.error) {
          showToast(`Failed to stop: ${data.error}`, 'error')
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
  ws?.close()
}

// ── Actions ──────────────────────────────────────────────────────────────

function openProcess(proc: ProcessInfo): void {
  const host = tailscale.value.hostname ?? 'localhost'
  window.open(`http://${host}:${proc.port}`, '_blank')
}

let reqId = 0

function handleStop(proc: ProcessInfo): void {
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
  @apply px-5 pb-5;
}

.process-group {
  @apply mb-4;
}

.process-group-label {
  @apply text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2 mt-1;
}

.process-group .process-card + .process-card {
  @apply mt-2.5;
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

/* Toast */
.processes-toast {
  @apply fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-50;
}

.toast-success {
  @apply bg-green-800 text-green-100;
}

.toast-error {
  @apply bg-red-800 text-red-100;
}
</style>
