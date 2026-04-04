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
