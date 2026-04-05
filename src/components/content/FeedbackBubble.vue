<template>
  <div class="feedback-bubble-root">
    <!-- Overlay -->
    <div v-if="isOpen" class="feedback-overlay" @click="isOpen = false">
      <div class="feedback-panel" @click.stop>
        <div class="feedback-header">
          <span class="feedback-title">Feedback</span>
          <button class="feedback-close" @click="isOpen = false">&times;</button>
        </div>
        <div class="feedback-entries" ref="entriesRef">
          <div v-for="entry in entries" :key="entry.line" class="feedback-entry" :class="{ 'is-checked': entry.checked }">
            <span class="feedback-check">{{ entry.checked ? '✓' : '○' }}</span>
            <div>
              <div class="feedback-entry-text">{{ entry.text }}</div>
              <div class="feedback-entry-time">{{ entry.timestamp }}</div>
            </div>
          </div>
          <div v-if="entries.length === 0" class="feedback-empty">No feedback yet. Type below to add.</div>
        </div>
        <form class="feedback-input-row" @submit.prevent="send">
          <input
            v-model="inputText"
            class="feedback-input"
            type="text"
            placeholder="What's bugging you?"
            :disabled="sending"
            @keydown.escape="isOpen = false"
          />
          <button class="feedback-send" type="submit" :disabled="!inputText.trim() || sending">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
      </div>
    </div>

    <!-- Floating Bubble -->
    <button class="feedback-fab" @click="toggle" title="Send feedback">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span v-if="uncheckedCount > 0" class="feedback-badge">{{ uncheckedCount }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'

interface FeedbackEntry {
  text: string
  timestamp: string
  checked: boolean
  line: number
}

const isOpen = ref(false)
const entries = ref<FeedbackEntry[]>([])
const inputText = ref('')
const sending = ref(false)
const entriesRef = ref<HTMLElement | null>(null)

const uncheckedCount = computed(() => entries.value.filter(e => !e.checked).length)

async function loadEntries(): Promise<void> {
  try {
    const res = await fetch('/codex-api/feedback')
    entries.value = await res.json()
  } catch {
    entries.value = []
  }
}

function toggle(): void {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    loadEntries()
  }
}

async function send(): Promise<void> {
  const text = inputText.value.trim()
  if (!text) return
  sending.value = true
  try {
    await fetch('/codex-api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    inputText.value = ''
    await loadEntries()
    await nextTick()
    if (entriesRef.value) {
      entriesRef.value.scrollTop = entriesRef.value.scrollHeight
    }
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  loadEntries()
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') isOpen.value = false
  })
})
</script>

<style scoped>
@reference "tailwindcss";

.feedback-bubble-root {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
}

.feedback-fab {
  @apply w-12 h-12 rounded-full flex items-center justify-center cursor-pointer shadow-lg transition-transform hover:scale-110;
  background: var(--accent-primary, #3b82f6);
  color: white;
  border: none;
  position: relative;
}

.feedback-badge {
  @apply absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center;
  background: #ef4444;
  color: white;
}

.feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.feedback-panel {
  position: fixed;
  bottom: 80px;
  right: 24px;
  width: 360px;
  max-height: 440px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  background: var(--bg-primary, #1a1a2e);
  border: 1px solid var(--border-primary, #2a2a4a);
}

.feedback-header {
  @apply flex items-center justify-between px-4 py-3;
  border-bottom: 1px solid var(--border-primary, #2a2a4a);
}

.feedback-title {
  @apply text-sm font-semibold text-[var(--text-primary)];
}

.feedback-close {
  @apply text-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer;
  background: none;
  border: none;
}

.feedback-entries {
  @apply flex-1 overflow-y-auto px-4 py-3 space-y-2;
  max-height: 300px;
}

.feedback-entry {
  @apply flex gap-2 text-sm;
}

.feedback-entry.is-checked {
  @apply opacity-50;
}

.feedback-check {
  @apply flex-shrink-0 mt-0.5;
  color: var(--text-secondary);
}

.feedback-entry-text {
  color: var(--text-primary);
}

.feedback-entry-time {
  @apply text-xs mt-0.5;
  color: var(--text-secondary);
}

.feedback-empty {
  @apply text-sm text-center py-8;
  color: var(--text-secondary);
}

.feedback-input-row {
  @apply flex gap-2 px-4 py-3;
  border-top: 1px solid var(--border-primary, #2a2a4a);
}

.feedback-input {
  @apply flex-1 text-sm rounded-lg px-3 py-2;
  background: var(--bg-secondary, #16213e);
  border: 1px solid var(--border-primary, #2a2a4a);
  color: var(--text-primary);
  outline: none;
}

.feedback-input:focus {
  border-color: var(--accent-primary, #3b82f6);
}

.feedback-send {
  @apply w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer;
  background: var(--accent-primary, #3b82f6);
  color: white;
  border: none;
}

.feedback-send:disabled {
  @apply opacity-40 cursor-not-allowed;
}
</style>
