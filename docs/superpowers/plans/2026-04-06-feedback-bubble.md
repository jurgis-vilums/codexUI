# Feedback Bubble & Nightly Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating feedback bubble to codexui that appends complaints to TODO.md, plus a nightly agent script that picks one item and fixes it via RALPH loop.

**Architecture:** Thin Vue component for the bubble overlay + REST endpoints for TODO.md read/write + PowerShell script for nightly Task Scheduler job.

**Tech Stack:** Vue 3 Composition API, Express 5, Tailwind CSS 4, PowerShell, Claude Code CLI, RALPH loop

**Spec:** `docs/superpowers/specs/2026-04-06-feedback-bubble-design.md`

---

## File Structure

**New files:**
| File | Responsibility |
|------|---------------|
| `src/components/content/FeedbackBubble.vue` | Floating button + chat overlay + text input |
| `src/server/feedbackService.ts` | Read/write TODO.md, parse entries, git commit |
| `scripts/nightly-improve.ps1` | PowerShell script for Windows Task Scheduler |
| `scripts/nightly-improve-prompt.md` | Agent prompt fed by RALPH loop |
| `decisions/.gitkeep` | Directory for nightly agent decision logs |

**Modified files:**
| File | Change |
|------|--------|
| `src/server/httpServer.ts` | Add `GET/POST /codex-api/feedback` endpoints |
| `vite.config.ts` | Add feedback middleware for dev mode |
| `src/App.vue` | Mount `<FeedbackBubble />` globally |

---

### Task 1: Feedback Service — Read/Write TODO.md

**Files:**
- Create: `src/server/feedbackService.ts`

- [ ] **Step 1: Create feedbackService.ts**

```typescript
// src/server/feedbackService.ts
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

export interface FeedbackEntry {
  text: string
  timestamp: string
  checked: boolean
  line: number
}

const TODO_PATH = join(process.cwd(), 'TODO.md')

export async function readFeedback(): Promise<FeedbackEntry[]> {
  try {
    const content = await readFile(TODO_PATH, 'utf-8')
    const entries: FeedbackEntry[] = []
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^- \[([ x])\] \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]: (.+)$/)
      if (match) {
        entries.push({
          checked: match[1] === 'x',
          timestamp: match[2],
          text: match[3],
          line: i + 1,
        })
      }
    }
    return entries
  } catch {
    return []
  }
}

export async function appendFeedback(text: string): Promise<void> {
  const now = new Date()
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const entry = `- [ ] [${timestamp}]: ${text.trim()}\n`

  let content = ''
  try {
    content = await readFile(TODO_PATH, 'utf-8')
  } catch {
    // File doesn't exist yet
  }

  // Append under a "## Feedback" section, creating it if needed
  if (!content.includes('## Feedback')) {
    content = content.trimEnd() + '\n\n## Feedback\n\n'
  }

  content = content.trimEnd() + '\n' + entry
  await writeFile(TODO_PATH, content, 'utf-8')

  // Git commit
  const shortText = text.trim().slice(0, 50)
  await gitCommit(TODO_PATH, `feedback: ${shortText}`)
}

function gitCommit(filePath: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('git', ['add', filePath], { cwd: process.cwd() }, () => {
      execFile('git', ['commit', '-m', message], { cwd: process.cwd() }, () => {
        resolve()
      })
    })
  })
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd C:/Users/vilum/Documents/dev/codexui && npx tsc --noEmit src/server/feedbackService.ts 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/server/feedbackService.ts
git commit -m "feat(feedback): add feedbackService for TODO.md read/write"
```

---

### Task 2: REST Endpoints for Feedback

**Files:**
- Modify: `src/server/httpServer.ts` (after line 199, before line 201)
- Modify: `vite.config.ts` (before line 452)

- [ ] **Step 1: Add import in httpServer.ts**

After the processService import (line 13), add:

```typescript
import { readFeedback, appendFeedback } from './feedbackService.js'
```

- [ ] **Step 2: Add REST endpoints in httpServer.ts**

After the `/codex-api/tailscale` endpoint (line 199), add:

```typescript
  // Feedback endpoints
  app.get('/codex-api/feedback', async (_req, res) => {
    const entries = await readFeedback()
    res.json(entries)
  })

  app.post('/codex-api/feedback', express.json(), async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text) {
      res.status(400).json({ error: 'Text is required' })
      return
    }
    await appendFeedback(text)
    res.json({ ok: true })
  })
```

- [ ] **Step 3: Add feedback middleware in vite.config.ts**

Add the import at the top alongside existing processService import:

```typescript
import { readFeedback, appendFeedback } from "./src/server/feedbackService.js";
```

Add middleware before `server.middlewares.use(bridge)` (before line 452):

```typescript
        // Feedback endpoints
        server.middlewares.use(async (req, res, next) => {
          if (!req.url) return next();
          const url = new URL(req.url, "http://localhost");
          if (url.pathname === "/codex-api/feedback" && req.method === "GET") {
            const entries = await readFeedback();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(entries));
            return;
          }
          if (url.pathname === "/codex-api/feedback" && req.method === "POST") {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            req.on("end", async () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                const text = typeof body?.text === "string" ? body.text.trim() : "";
                if (!text) {
                  res.statusCode = 400;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "Text is required" }));
                  return;
                }
                await appendFeedback(text);
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: true }));
              } catch {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Invalid JSON" }));
              }
            });
            return;
          }
          next();
        });
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/server/httpServer.ts vite.config.ts
git commit -m "feat(feedback): add GET/POST /codex-api/feedback REST endpoints"
```

---

### Task 3: FeedbackBubble Vue Component

**Files:**
- Create: `src/components/content/FeedbackBubble.vue`

- [ ] **Step 1: Create FeedbackBubble.vue**

```vue
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
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/components/content/FeedbackBubble.vue
git commit -m "feat(feedback): add FeedbackBubble floating overlay component"
```

---

### Task 4: Mount FeedbackBubble in App.vue

**Files:**
- Modify: `src/App.vue` (import + template)

- [ ] **Step 1: Add import**

In the script section alongside other component imports (around line 348), add:

```typescript
import FeedbackBubble from './components/content/FeedbackBubble.vue'
```

- [ ] **Step 2: Add to template**

Just before `</DesktopLayout>` (line 341), add:

```vue
    <FeedbackBubble />
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add src/App.vue
git commit -m "feat(feedback): mount FeedbackBubble globally in App.vue"
```

---

### Task 5: Nightly Agent Scripts

**Files:**
- Create: `scripts/nightly-improve.ps1`
- Create: `scripts/nightly-improve-prompt.md`
- Create: `decisions/.gitkeep`

- [ ] **Step 1: Create decisions directory**

```bash
cd C:/Users/vilum/Documents/dev/codexui
mkdir -p decisions
touch decisions/.gitkeep
```

- [ ] **Step 2: Create nightly-improve-prompt.md**

```markdown
# Nightly Self-Improvement Agent

You are a nightly improvement agent for the codexui project. Your job is to pick ONE unchecked item from TODO.md and fix it.

## Workflow

1. **Read TODO.md** — Find the first unchecked `- [ ]` entry under `## Feedback`
2. **Analyze** — Explore the codebase to understand the issue described in the complaint
3. **Decide** — Log your assumptions and decisions to `decisions/YYYY-MM-DD-<slug>.md`
4. **Create worktree** — Use `git worktree add` to create an isolated workspace
5. **Plan** — Break the fix into small tasks
6. **Implement with TDD** — Write failing tests first, then implement
7. **Code review** — Review your own implementation for quality issues and fix them
8. **Simplify** — Clean up any unnecessarily complex code
9. **Re-test** — Run the full test suite to verify nothing is broken
10. **Create PR** — Use `gh pr create` with a clear description
11. **Mark done** — Check the TODO item as `- [x]` in TODO.md and commit
12. **Notify** — Send results via Pushover and create a Notion page

## Pushover Notification

```bash
curl -s -F "token=YOUR_APP_TOKEN" -F "user=YOUR_USER_KEY" -F "title=CodexUI Nightly" -F "message=<summary>" https://api.pushover.net/1/messages.json
```

## Success Criteria

When you have created a PR and sent notifications, output:
<promise>DONE</promise>

## On Failure

If you cannot fix the item after multiple attempts:
1. Append a note under the TODO item explaining what you tried and why it failed
2. Send a Pushover notification with the failure reason
3. Output: <promise>DONE</promise>

## Rules

- Only work on ONE item
- Never push directly to main
- Always create a PR
- Log all decisions to the decisions/ directory
- Max effort: if after several iterations you can't make progress, fail gracefully
```

- [ ] **Step 3: Create nightly-improve.ps1**

```powershell
# nightly-improve.ps1 — Runs the nightly self-improvement agent
# Registered as a Windows Task Scheduler job

$ErrorActionPreference = "Stop"
$RepoDir = "C:\Users\vilum\Documents\dev\codexui"
$MaxMinutes = 60
$LogFile = Join-Path $RepoDir "decisions\nightly-$(Get-Date -Format 'yyyy-MM-dd').log"

Set-Location $RepoDir

# Ensure we're on main and up to date
git checkout main 2>$null
git pull --ff-only 2>$null

# Check if there are unchecked feedback items
$todo = Get-Content "TODO.md" -Raw
if ($todo -notmatch '- \[ \] \[') {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') No unchecked feedback items. Exiting." | Out-File $LogFile -Append
    exit 0
}

"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting nightly improvement agent..." | Out-File $LogFile -Append

# Run Claude Code with RALPH loop
$promptFile = Join-Path $RepoDir "scripts\nightly-improve-prompt.md"
$prompt = Get-Content $promptFile -Raw

$process = Start-Process -FilePath "claude" -ArgumentList @(
    "--print",
    "--dangerously-skip-permissions",
    "-p", $prompt,
    "--max-turns", "100"
) -WorkingDirectory $RepoDir -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $RepoDir "decisions\nightly-stdout.log") -RedirectStandardError (Join-Path $RepoDir "decisions\nightly-stderr.log")

# Wait with timeout
if (-not $process.WaitForExit($MaxMinutes * 60 * 1000)) {
    $process.Kill()
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Agent timed out after $MaxMinutes minutes." | Out-File $LogFile -Append
}

"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Nightly agent finished with exit code: $($process.ExitCode)" | Out-File $LogFile -Append
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/vilum/Documents/dev/codexui
git add decisions/.gitkeep scripts/nightly-improve.ps1 scripts/nightly-improve-prompt.md
git commit -m "feat(feedback): add nightly self-improvement agent scripts"
```

---

### Task 6: Integration Test — Verify Bubble Works

- [ ] **Step 1: Restart vite dev server**

Kill existing vite and restart.

- [ ] **Step 2: Open /codex-api/feedback endpoint**

```bash
curl -s http://localhost:5174/codex-api/feedback
```

Expected: JSON array of existing TODO entries

- [ ] **Step 3: Post a test feedback entry**

```bash
curl -s -X POST http://localhost:5174/codex-api/feedback -H "Content-Type: application/json" -d '{"text":"Test feedback entry from integration test"}'
```

Expected: `{"ok":true}`

- [ ] **Step 4: Screenshot the bubble**

Open http://localhost:5174 in browser, take screenshot showing the floating bubble in bottom-right. Click it and screenshot the overlay.

- [ ] **Step 5: Verify git committed the feedback**

```bash
git log --oneline -1
```

Expected: `feedback: Test feedback entry from integration`

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A && git commit -m "feat(feedback): complete feedback bubble integration"
```
