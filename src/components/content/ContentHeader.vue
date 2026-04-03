<template>
  <header class="content-header">
    <div class="content-leading">
      <slot name="leading" />
    </div>
    <h1 class="content-title">{{ title }}</h1>
    <div class="content-actions">
      <div v-if="activeBackend" class="backend-toggle">
        <button
          class="backend-toggle-option"
          :class="{ 'is-active': activeBackend === 'codex' }"
          type="button"
          @click="activeBackend !== 'codex' && $emit('toggle-backend')"
        >
          Codex
        </button>
        <button
          class="backend-toggle-option"
          :class="{ 'is-active': activeBackend === 'claude' }"
          type="button"
          @click="activeBackend !== 'claude' && $emit('toggle-backend')"
        >
          Claude
        </button>
      </div>
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  activeBackend?: 'codex' | 'claude'
}>()

defineEmits<{
  'toggle-backend': []
}>()
</script>

<style scoped>
@reference "tailwindcss";

.content-header {
  @apply relative z-10 w-full min-h-12 sm:min-h-14 flex items-center gap-2 sm:gap-3 px-2 sm:px-3 pt-3 sm:pt-4 pb-2 bg-white;
}

.content-title {
  @apply m-0 min-w-0 flex-1 truncate text-sm font-medium leading-6 text-slate-900 max-sm:text-xs;
}

.content-actions {
  @apply flex items-center justify-end gap-1;
}

.content-leading {
  @apply flex items-center gap-1;
}

:global(:root.dark) .content-header {
  @apply bg-zinc-950;
}

:global(:root.dark) .content-title {
  @apply text-zinc-200;
}

.backend-toggle {
  @apply flex items-center rounded-lg border border-slate-200 p-0.5 gap-0;
}

.backend-toggle-option {
  @apply px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors text-slate-500;
}

.backend-toggle-option.is-active {
  @apply bg-slate-800 text-white shadow-sm;
}

:global(:root.dark) .backend-toggle {
  @apply border-zinc-700;
}

:global(:root.dark) .backend-toggle-option {
  @apply text-zinc-400;
}

:global(:root.dark) .backend-toggle-option.is-active {
  @apply bg-zinc-200 text-zinc-900;
}
</style>
