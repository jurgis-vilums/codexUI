<template>
  <div class="desktop-layout" :class="{ 'is-mobile': isMobile }" :style="layoutStyle">
    <Teleport v-if="isMobile" to="body">
      <Transition name="drawer">
        <div v-if="!isSidebarCollapsed" class="mobile-drawer-backdrop" @click="$emit('close-sidebar')">
          <aside class="mobile-drawer" @click.stop>
            <slot name="sidebar" />
          </aside>
        </div>
      </Transition>
    </Teleport>

    <template v-if="!isMobile">
      <aside v-if="!isSidebarCollapsed" class="desktop-sidebar">
        <slot name="sidebar" />
      </aside>
      <button
        v-if="!isSidebarCollapsed"
        class="desktop-resize-handle"
        type="button"
        aria-label="Resize sidebar"
        @mousedown="onResizeHandleMouseDown"
      />
    </template>

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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMobile } from '../../composables/useMobile'

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

defineEmits<{
  'close-sidebar': []
}>()

const { isMobile } = useMobile()

const SIDEBAR_WIDTH_KEY = 'codex-web-local.sidebar-width.v1'
const MIN_SIDEBAR_WIDTH = 260
const MAX_SIDEBAR_WIDTH = 620
const DEFAULT_SIDEBAR_WIDTH = 320

function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
}

function loadSidebarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH
  return clampSidebarWidth(parsed)
}

const sidebarWidth = ref(loadSidebarWidth())
const layoutStyle = computed(() => {
  if (isMobile.value || props.isSidebarCollapsed) {
    return {
      '--sidebar-width': '0px',
      '--layout-columns': 'minmax(0, 1fr)',
    }
  }
  return {
    '--sidebar-width': `${sidebarWidth.value}px`,
    '--layout-columns': 'var(--sidebar-width) 1px minmax(0, 1fr)',
  }
})

function saveSidebarWidth(value: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(value))
}

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

function onResizeHandleMouseDown(event: MouseEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = sidebarWidth.value

  const onMouseMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX
    sidebarWidth.value = clampSidebarWidth(startWidth + delta)
  }

  const onMouseUp = () => {
    saveSidebarWidth(sidebarWidth.value)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
</script>

<style scoped>
@reference "tailwindcss";

.desktop-layout {
  @apply grid bg-slate-100 text-slate-900 overflow-hidden;
  height: 100vh;
  height: 100dvh;
  grid-template-columns: var(--layout-columns);
}

.desktop-sidebar {
  @apply bg-slate-100 min-h-0 overflow-hidden;
}

.desktop-resize-handle {
  @apply relative w-px cursor-col-resize bg-slate-300 hover:bg-slate-400 transition;
}

.desktop-resize-handle::before {
  content: '';
  @apply absolute -left-2 -right-2 top-0 bottom-0;
}

.desktop-main {
  @apply flex flex-row bg-white min-h-0 overflow-hidden;
}

.desktop-main-left {
  @apply flex flex-col flex-1 min-w-0 overflow-hidden;
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

.mobile-drawer-backdrop {
  @apply fixed inset-0 z-40 bg-black/40;
}

.mobile-drawer {
  @apply absolute top-0 left-0 bottom-0 w-[85vw] max-w-80 bg-slate-100 overflow-hidden shadow-2xl;
}

.drawer-enter-active,
.drawer-leave-active {
  @apply transition-opacity duration-200;
}

.drawer-enter-active .mobile-drawer,
.drawer-leave-active .mobile-drawer {
  transition: transform 200ms ease;
}

.drawer-enter-from {
  @apply opacity-0;
}

.drawer-enter-from .mobile-drawer {
  transform: translateX(-100%);
}

.drawer-leave-to {
  @apply opacity-0;
}

.drawer-leave-to .mobile-drawer {
  transform: translateX(-100%);
}

:global(:root.dark) .desktop-layout {
  @apply bg-zinc-900 text-zinc-100;
}

:global(:root.dark) .desktop-sidebar,
:global(:root.dark) .mobile-drawer {
  @apply bg-zinc-900;
}

:global(:root.dark) .desktop-resize-handle {
  @apply bg-zinc-700 hover:bg-zinc-600;
}

:global(:root.dark) .desktop-main {
  @apply bg-zinc-950;
}

:global(:root.dark) .terminal-resize-handle {
  @apply bg-zinc-700 hover:bg-zinc-600;
}

:global(:root.dark) .diff-resize-handle {
  @apply bg-zinc-700 hover:bg-zinc-600;
}
</style>
