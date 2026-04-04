# Git Diff Panel

## Summary

Add a git diff panel to codexUI that shows unstaged/staged changes with inline diff rendering, file tree navigation, staging/unstaging operations, and view options. Uses git CLI via `child_process` on the backend and diff2html for rendering.

## Backend

### Git Service — `src/server/gitService.ts`

New module that shells out to the system `git` binary via `child_process.exec`. All commands use machine-readable flags for reliable parsing.

**Operations:**

| Operation | Git Command | Returns |
|-----------|------------|---------|
| File status | `git status --porcelain=v2` | Parsed list of `{ path, status, staged }` |
| Unstaged diff | `git diff --no-color --unified=3` | Raw unified diff string |
| Staged diff | `git diff --staged --no-color --unified=3` | Raw unified diff string |
| Single file diff | `git diff --no-color -- <path>` | Raw unified diff for one file |
| Stage file | `git add -- <path>` | void |
| Unstage file | `git restore --staged -- <path>` | void |
| Stage all | `git add -A` | void |
| Unstage all | `git restore --staged .` | void |
| Revert file | `git checkout -- <path>` | void |
| Revert all | `git checkout -- .` | void |

**CWD:** Uses the project working directory (same as terminal CWD).

**Error handling:** Returns git stderr as error messages to the frontend.

### WebSocket Integration

Git operations are exposed as WebSocket messages on the existing `/ws/terminal` endpoint (or a new `/ws/git` endpoint — implementation detail). Protocol:

- Client → Server: `{ type: "git", action: "status" | "diff" | "diff-staged" | "add" | "unstage" | "revert" | ..., path?: string }`
- Server → Client: `{ type: "git-result", action: string, data: string | object, error?: string }`

## Frontend

### Components

#### `DiffPanel.vue` — Main Container
- Right side panel on desktop (splits content area horizontally)
- Replaces main content area on mobile
- Contains the toolbar, tab bar, file tree toggle, and diff viewer
- Resizable width on desktop (drag handle on left edge, same pattern as sidebar/terminal)
- Width persisted to localStorage: `codex-web-local.diff-panel-width.v1`
- Default width: 50% of content area
- Min width: 300px

#### `DiffFileTree.vue` — File Tree Popup
- Dropdown/popover showing changed files grouped by directory
- Filter search input at top
- Click a file to scroll to / show its diff
- File status indicators (M = modified, A = added, D = deleted, ? = untracked)
- Shown/hidden via folder icon button in toolbar

#### `DiffViewer.vue` — Diff Renderer
- Uses **diff2html** to render unified diff output
- Supports two modes: line-by-line (default) and side-by-side
- Syntax highlighting via diff2html's built-in highlight.js
- Shows `+N -N` stats per file in the file header
- Collapsible unmodified line regions
- Per-file "Stage" / "Revert" action buttons inline

#### `DiffToolbar.vue` — Options Menu
- Refresh button
- Split diff toggle (line-by-line vs side-by-side)
- Word wrap toggle
- Collapse all diffs toggle
- Word diffs toggle (inline word-level highlighting)
- File tree toggle (folder icon)

### Tab Bar

Two tabs at the top of the diff panel:
- **Unstaged** (count badge) — shows `git diff` output
- **Staged** (count badge) — shows `git diff --staged` output

### Actions

- **Stage all / Revert all** — buttons at bottom of unstaged tab
- **Unstage all** — button at bottom of staged tab
- **Per-file stage/revert** — inline buttons on each file's diff header

## Layout Integration

### Desktop
- Right side panel that splits the content area
- Opens alongside terminal (both can be visible)
- Drag handle on left edge for resizing (vertical, same pattern as sidebar)
- Content area shrinks to accommodate

### Mobile
- Replaces main content area (full width)
- Back button to return to conversation

## Keybinding & State

- **Alt+Ctrl+B** toggles diff panel visibility (added to `onWindowKeyDown()` in `App.vue`)
- Header bar button (git branch icon) for mouse/touch toggle
- State in App.vue:
  - `isDiffPanelOpen: ref<boolean>` — persisted to localStorage (`codex-web-local.diff-panel-open.v1`)
  - Defaults to `false`
- Diff view options persisted to localStorage:
  - `codex-web-local.diff-split-view.v1` — side-by-side vs inline
  - `codex-web-local.diff-word-wrap.v1` — word wrap on/off

## Auto-Refresh

- Refresh on panel open
- Refresh on tab switch (unstaged ↔ staged)
- Manual refresh button in toolbar
- No polling — user triggers refreshes

## Dependencies

New npm packages:
- `diff2html` — unified diff rendering (line-by-line + side-by-side, syntax highlighting)

## Out of Scope

- Hunk-level staging (stage individual lines/hunks within a file)
- Git log / commit history viewer
- Commit creation from the diff panel
- Branch management
- Merge conflict resolution UI
