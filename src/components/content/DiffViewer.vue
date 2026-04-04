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
