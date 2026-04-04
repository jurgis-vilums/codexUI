<template>
  <div class="file-editor">
    <div class="file-editor-header">
      <span class="file-editor-name">{{ name }}</span>
      <div class="file-editor-actions">
        <template v-if="isEditing">
          <button class="file-editor-btn file-editor-btn-save" type="button" @click="onSave">Save</button>
          <button class="file-editor-btn file-editor-btn-cancel" type="button" @click="onCancel">Cancel</button>
        </template>
        <button v-else class="file-editor-btn" type="button" @click="isEditing = true">Edit</button>
      </div>
    </div>
    <div v-if="isLoading" class="file-editor-loading">Loading...</div>
    <div v-else-if="error" class="file-editor-error">{{ error }}</div>
    <template v-else>
      <textarea
        v-if="isEditing"
        v-model="draft"
        class="file-editor-textarea"
        spellcheck="false"
      />
      <pre v-else class="file-editor-content">{{ content }}</pre>
    </template>
    <span v-if="saveStatus" class="file-editor-save-status">{{ saveStatus }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { rpcCall } from '../../api/codexRpcClient'

const props = defineProps<{
  path: string
  name: string
}>()

const content = ref('')
const draft = ref('')
const isLoading = ref(true)
const isEditing = ref(false)
const error = ref('')
const saveStatus = ref('')

async function loadFile() {
  isLoading.value = true
  error.value = ''
  try {
    const result = await rpcCall<{ content?: string; error?: string }>('claude/read-file', { path: props.path })
    if (result.error) {
      error.value = result.error
    } else {
      content.value = result.content ?? ''
      draft.value = content.value
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load file'
  } finally {
    isLoading.value = false
  }
}

async function onSave() {
  saveStatus.value = 'Saving...'
  try {
    const result = await rpcCall<{ ok: boolean; error?: string }>('claude/save-file', {
      path: props.path,
      content: draft.value,
    })
    if (result.ok) {
      content.value = draft.value
      isEditing.value = false
      saveStatus.value = 'Saved'
      setTimeout(() => { saveStatus.value = '' }, 2000)
    } else {
      saveStatus.value = result.error ?? 'Save failed'
    }
  } catch (e) {
    saveStatus.value = e instanceof Error ? e.message : 'Save failed'
  }
}

function onCancel() {
  draft.value = content.value
  isEditing.value = false
}

watch(() => props.path, () => {
  isEditing.value = false
  loadFile()
}, { immediate: true })
</script>

<style scoped>
@reference "tailwindcss";

.file-editor {
  @apply flex flex-col h-full;
}

.file-editor-header {
  @apply flex items-center justify-between px-4 py-3 border-b border-slate-200;
}

.file-editor-name {
  @apply font-mono text-sm font-medium text-slate-700;
}

.file-editor-actions {
  @apply flex gap-2;
}

.file-editor-btn {
  @apply px-3 py-1 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer;
}

.file-editor-btn-save {
  @apply border-green-300 text-green-700 hover:bg-green-50;
}

.file-editor-btn-cancel {
  @apply text-slate-400 hover:bg-slate-50;
}

.file-editor-loading {
  @apply flex-1 flex items-center justify-center text-sm text-slate-400;
}

.file-editor-error {
  @apply m-4 p-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700;
}

.file-editor-textarea {
  @apply flex-1 w-full p-4 font-mono text-sm leading-relaxed resize-none border-0 outline-none bg-white text-slate-800;
  tab-size: 2;
}

.file-editor-textarea:focus {
  @apply ring-1 ring-inset ring-blue-300;
}

.file-editor-content {
  @apply flex-1 overflow-auto m-0 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-slate-800;
}

.file-editor-save-status {
  @apply px-4 py-1 text-xs text-green-600;
}

:global(:root.dark) .file-editor-header {
  @apply border-zinc-700;
}

:global(:root.dark) .file-editor-name {
  @apply text-zinc-200;
}

:global(:root.dark) .file-editor-btn {
  @apply border-zinc-600 text-zinc-300 hover:bg-zinc-800;
}

:global(:root.dark) .file-editor-btn-save {
  @apply border-green-700 text-green-400 hover:bg-green-900/30;
}

:global(:root.dark) .file-editor-textarea {
  @apply bg-zinc-900 text-zinc-200;
}

:global(:root.dark) .file-editor-textarea:focus {
  @apply ring-blue-600;
}

:global(:root.dark) .file-editor-content {
  @apply text-zinc-200;
}

:global(:root.dark) .file-editor-error {
  @apply border-rose-800 bg-rose-900/30 text-rose-300;
}
</style>
