# Feedback Bubble & Nightly Self-Improvement Agent — Design Spec

## Overview

Two-part system for continuous codexui improvement: (1) a floating feedback bubble that captures user complaints into TODO.md, and (2) a nightly agent that picks one item, fixes it via TDD + code review, and ships a PR.

## Part 1: Feedback Bubble

### UI
- Floating circular button fixed to bottom-right corner, visible on all routes
- Click expands into a chat-like overlay (~350px wide x 400px tall)
- Contains: scrollable log of past TODO entries + text input + send button
- Badge on bubble shows count of unchecked items
- Close via click outside or Escape

### Behavior
- On send: appends `- [ ] [YYYY-MM-DD HH:mm]: <complaint text>` to `TODO.md` in repo root
- Auto-commits with message `feedback: <first 50 chars>`
- Log view reads existing TODO.md entries via REST endpoint
- Text-only input (no voice for now)

### Backend
- `GET /codex-api/feedback` — reads TODO.md, returns array of entries with checked status
- `POST /codex-api/feedback` — appends entry to TODO.md, commits via git

### Files
- Create: `src/components/content/FeedbackBubble.vue`
- Modify: `src/server/httpServer.ts` — add REST endpoints
- Modify: `src/server/vite.config.ts` — add REST endpoints for dev mode
- Modify: `src/App.vue` — mount FeedbackBubble globally
- Create: `TODO.md` — the backlog file (if not exists)

## Part 2: Nightly Self-Improvement Agent

### Trigger
- Windows Task Scheduler job runs at 3:00 AM nightly
- Executes `scripts/nightly-improve.ps1` which invokes Claude Code CLI with RALPH loop

### Agent Workflow
1. **Analyze** — Read TODO.md, pick first unchecked item, explore codebase to understand the issue
2. **Decide** — Log assumptions and decisions to `decisions/<date>-<slug>.md`
3. **Plan** — Break fix into tasks using writing-plans skill
4. **Implement** — TDD for each task via subagents
5. **Review** — Code review the implementation
6. **Fix review issues** — Address findings
7. **Simplify** — Clean up code
8. **Re-test** — Run full test suite to verify nothing broke
9. **Ship** — Create PR via `gh pr create`, mark TODO item as checked, send Pushover notification with PR link + decisions summary
10. **On failure** — Leave item unchecked, append failure note to TODO.md under the item, send Pushover notification with failure reason + decisions log

### RALPH Loop
- Wraps the entire workflow with `--completion-promise "DONE" --max-iterations 10`
- If tests fail after simplify, or fix doesn't work, RALPH feeds the same prompt again
- Agent sees its previous work and self-corrects
- Max runtime: 60 minutes (enforced by PowerShell script)

### Notifications
- **Pushover** — HTTP POST to Pushover API for push notifications to phone
  - Success: PR link + decisions summary + what was fixed
  - Failure: what was attempted + why it failed + decisions log
- **Notion** — Create a page in the codexui project with full details (via Notion API)

### Guardrails
- Only 1 TODO item per night
- Never pushes to main — always creates PR from a worktree branch
- Max 10 RALPH iterations
- 60-minute timeout
- Creates git worktree for isolation

### Files
- Create: `scripts/nightly-improve.ps1` — PowerShell script for Task Scheduler
- Create: `scripts/nightly-improve-prompt.md` — The agent's prompt (fed by RALPH loop)
- Create: `decisions/` directory — for decision logs
- Modify: Windows Task Scheduler — register the nightly job

## Excluded from Scope

- Voice input (future enhancement)
- AI conversation in the bubble (bubble is dumb text input only)
- Multiple TODO items per night
- Real-time fix streaming to the bubble UI
- Notion database for backlog (backlog is TODO.md only; Notion is notification-only)
