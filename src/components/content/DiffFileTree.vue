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
