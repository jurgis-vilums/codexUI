# Backend Toggle (Codex / Claude) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle in the content header that switches the entire UI between Codex and Claude backends.

**Architecture:** The Express server maintains two bridge instances (AppServerProcess for Codex, ClaudeAdapter for Claude). An `X-Backend` header on all frontend requests tells the server which bridge to route to. The frontend stores `activeBackend` in a reactive ref and re-fetches all state on toggle.

**Tech Stack:** Vue 3, Express, existing ClaudeAdapter, Tailwind CSS

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/server/codexAppServerBridge.ts` | Express middleware, bridge routing | Modify |
| `src/api/codexRpcClient.ts` | Frontend RPC client | Modify |
| `src/App.vue` | Main app, toggle state, re-fetch on toggle | Modify |
| `src/components/content/ContentHeader.vue` | Header bar with toggle button | Modify |
| `src/server/claudeAdapter.ts` | Claude backend adapter | Modify (add model/list) |
| `src/server/claudeAdapter.test.ts` | Adapter tests | Modify (add model/list test) |

---

### Task 1: Add model/list stub to ClaudeAdapter

**Files:**
- Modify: `src/server/claudeAdapter.test.ts`
- Modify: `src/server/claudeAdapter.ts`

- [ ] **Step 1: Write failing test for model/list**

Add to the test file after the `turn/interrupt` describe block:

```typescript
describe('model/list', () => {
  it('returns Anthropic model ids', async () => {
    const result = await adapter.rpc('model/list', {}) as any

    expect(result.data).toBeInstanceOf(Array)
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.data[0]).toHaveProperty('id')
    expect(result.data.some((m: any) => m.id.includes('claude'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/claudeAdapter.test.ts`
Expected: FAIL with `Unknown method: model/list`

- [ ] **Step 3: Implement model/list in ClaudeAdapter**

In `src/server/claudeAdapter.ts`, add case in the `rpc` switch:

```typescript
case 'model/list':
  return {
    data: [
      { id: 'claude-opus-4-1', model: 'claude-opus-4-1' },
      { id: 'claude-sonnet-4-5-20250514', model: 'claude-sonnet-4-5-20250514' },
      { id: 'claude-haiku-4-5-20251001', model: 'claude-haiku-4-5-20251001' },
    ],
    nextCursor: null,
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/claudeAdapter.test.ts`
Expected: 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/claudeAdapter.ts src/server/claudeAdapter.test.ts
git commit -m "feat: add model/list stub to ClaudeAdapter"
```

---

### Task 2: Dual bridge instances in Express middleware

**Files:**
- Modify: `src/server/codexAppServerBridge.ts`

- [ ] **Step 1: Add ClaudeAdapter import and dual bridge state**

At the top of `codexAppServerBridge.ts`, add import:

```typescript
import { ClaudeAdapter } from './claudeAdapter.js'
```

- [ ] **Step 2: Modify SharedBridgeState type and getSharedBridgeState**

Change the `SharedBridgeState` type to include both backends:

```typescript
type SharedBridgeState = {
  appServer: AppServerProcess
  claudeAdapter: ClaudeAdapter
  methodCatalog: MethodCatalog
  telegramBridge: TelegramThreadBridge
}
```

In `getSharedBridgeState()`, after `const appServer = new AppServerProcess()`, add:

```typescript
const claudeAdapter = new ClaudeAdapter()
```

And add `claudeAdapter` to the `created` object.

- [ ] **Step 3: Add backend routing helper**

Add this function after `getSharedBridgeState`:

```typescript
function getBackendForRequest(req: IncomingMessage): { rpc: (method: string, params: unknown) => Promise<unknown>; onNotification: (listener: (value: { method: string; params: unknown }) => void) => () => void } {
  const header = req.headers['x-backend']
  const backend = typeof header === 'string' ? header : 'codex'
  const { appServer, claudeAdapter } = getSharedBridgeState()
  return backend === 'claude' ? claudeAdapter : appServer
}
```

- [ ] **Step 4: Route RPC calls by header**

In the middleware, find the RPC handler (line ~1583):

```typescript
if (req.method === 'POST' && url.pathname === '/codex-api/rpc') {
```

Replace `appServer.rpc(body.method, body.params ?? null)` with:

```typescript
const backend = getBackendForRequest(req)
const rpcResult = await backend.rpc(body.method, body.params ?? null)
```

- [ ] **Step 5: Route notification subscriptions by query param**

In the WebSocket/SSE handler (the `subscribeNotifications` function at the bottom of the middleware), the notification stream needs to support both backends. Find where `appServer.onNotification` is called in `subscribeNotifications` and change it to accept a backend parameter.

In the WebSocket upgrade handler, read backend from the URL query:

```typescript
const wsUrl = new URL(req.url ?? '', 'http://localhost')
const wsBackend = wsUrl.searchParams.get('backend') === 'claude' ? 'claude' : 'codex'
const { appServer, claudeAdapter } = getSharedBridgeState()
const backendForWs = wsBackend === 'claude' ? claudeAdapter : appServer
```

Then use `backendForWs.onNotification(...)` instead of `appServer.onNotification(...)`.

- [ ] **Step 6: Update dispose to clean up both backends**

In the `dispose` function of the middleware, add:

```typescript
claudeAdapter.dispose()
```

- [ ] **Step 7: Revert the require() hack from earlier**

Remove the `useClaudeBackend` / `require('./claudeAdapter.js')` conditional that was added to line 1453 in the previous session. The dual bridge approach replaces it.

- [ ] **Step 8: Build CLI to verify no compile errors**

Run: `npx tsup`
Expected: Build success

- [ ] **Step 9: Commit**

```bash
git add src/server/codexAppServerBridge.ts
git commit -m "feat: dual bridge instances with X-Backend header routing"
```

---

### Task 3: Frontend RPC client sends backend header

**Files:**
- Modify: `src/api/codexRpcClient.ts`

- [ ] **Step 1: Add activeBackend module state**

At the top of `codexRpcClient.ts`, after the imports, add:

```typescript
let _activeBackend: 'codex' | 'claude' = 'codex'

export function setActiveBackend(backend: 'codex' | 'claude'): void {
  _activeBackend = backend
}

export function getActiveBackend(): 'codex' | 'claude' {
  return _activeBackend
}
```

- [ ] **Step 2: Add X-Backend header to rpcCall**

In the `rpcCall` function, change the fetch headers from:

```typescript
headers: {
  'Content-Type': 'application/json',
},
```

to:

```typescript
headers: {
  'Content-Type': 'application/json',
  'X-Backend': _activeBackend,
},
```

- [ ] **Step 3: Add backend query param to WebSocket/SSE connections**

In `subscribeRpcNotifications`, change the WebSocket URL from:

```typescript
const socket = new WebSocket(`${protocol}//${window.location.host}/codex-api/ws`)
```

to:

```typescript
const socket = new WebSocket(`${protocol}//${window.location.host}/codex-api/ws?backend=${_activeBackend}`)
```

And change the SSE URL from:

```typescript
const source = new EventSource('/codex-api/events')
```

to:

```typescript
const source = new EventSource(`/codex-api/events?backend=${_activeBackend}`)
```

- [ ] **Step 4: Build frontend to verify no compile errors**

Run: `npx vite build`
Expected: Build success

- [ ] **Step 5: Commit**

```bash
git add src/api/codexRpcClient.ts
git commit -m "feat: RPC client sends X-Backend header and query param"
```

---

### Task 4: Backend toggle in ContentHeader

**Files:**
- Modify: `src/components/content/ContentHeader.vue`

- [ ] **Step 1: Add toggle props and emit**

Replace the script section:

```typescript
<script setup lang="ts">
defineProps<{
  title: string
  activeBackend?: 'codex' | 'claude'
}>()

defineEmits<{
  'toggle-backend': []
}>()
</script>
```

- [ ] **Step 2: Add toggle button in template**

In the template, add a toggle button inside `content-actions` slot area. Replace the `<div class="content-actions">` block:

```html
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
```

- [ ] **Step 3: Add toggle styles**

Add to the `<style scoped>` block:

```css
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
```

- [ ] **Step 4: Build frontend to verify**

Run: `npx vite build`
Expected: Build success

- [ ] **Step 5: Commit**

```bash
git add src/components/content/ContentHeader.vue
git commit -m "feat: backend toggle UI in content header"
```

---

### Task 5: Wire toggle in App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Import setActiveBackend and add reactive state**

In the `<script setup>` section, add import:

```typescript
import { setActiveBackend } from './api/codexRpcClient'
```

Add reactive state near the other refs:

```typescript
const activeBackend = ref<'codex' | 'claude'>('codex')
```

- [ ] **Step 2: Add toggle handler function**

Add this function near the other event handlers:

```typescript
async function onToggleBackend() {
  const next = activeBackend.value === 'codex' ? 'claude' : 'codex'
  activeBackend.value = next
  setActiveBackend(next)

  // Re-fetch thread list for the new backend
  selectedThreadId.value = ''
  filteredMessages.value = []
  await loadThreadGroups()
}
```

Note: `selectedThreadId`, `filteredMessages`, and `loadThreadGroups` are existing refs/functions — verify their actual names by searching the file. The intent is:
1. Clear current thread selection
2. Clear displayed messages
3. Reload thread list from the new backend

- [ ] **Step 3: Pass props and event to ContentHeader**

Find the `<ContentHeader>` usage (around line 137) and change:

```html
<ContentHeader :title="contentTitle">
```

to:

```html
<ContentHeader :title="contentTitle" :active-backend="activeBackend" @toggle-backend="onToggleBackend">
```

- [ ] **Step 4: Reconnect WebSocket on toggle**

The notification subscription in `subscribeRpcNotifications` uses the backend value at connection time. When the backend toggles, the WebSocket needs to reconnect. In the `onToggleBackend` function, after `setActiveBackend(next)`, call the existing notification unsubscribe/resubscribe:

Find where `subscribeCodexNotifications` is called in App.vue (or in `useDesktopState.ts`) and add reconnect logic. The simplest approach: store the unsubscribe function and call it, then resubscribe:

```typescript
// In onToggleBackend, after setActiveBackend:
if (notificationUnsubscribe) {
  notificationUnsubscribe()
}
notificationUnsubscribe = subscribeCodexNotifications(onNotification)
```

Verify the actual variable names by reading the file.

- [ ] **Step 5: Build and test manually**

Run: `npx vite build && npx tsup`
Expected: Both build successfully

Start the app and verify:
1. Toggle appears in header
2. Clicking "Claude" switches backend (thread list clears/reloads)
3. Clicking "Codex" switches back

- [ ] **Step 6: Commit**

```bash
git add src/App.vue
git commit -m "feat: wire backend toggle in App.vue with state management"
```

---

### Task 6: Integration smoke test

**Files:**
- No new files

- [ ] **Step 1: Full build**

```bash
cd C:/Users/vilum/Documents/dev/codexui
npx vitest run src/server/claudeAdapter.test.ts
npx vite build
npx tsup
```

Expected: All tests pass, both builds succeed.

- [ ] **Step 2: Restart codexui and verify in browser**

Kill and restart codexui, then open in browser. Verify:
1. Toggle shows "Codex" / "Claude" in the header bar
2. Default is "Codex" — existing functionality works
3. Switching to "Claude" clears threads and shows Claude sessions (may be empty)
4. Switching back to "Codex" restores Codex threads
5. Dark mode styling works for the toggle

- [ ] **Step 3: Commit all remaining changes and push**

```bash
git add -A
git status
git commit -m "feat: backend toggle between Codex and Claude"
git push
```
