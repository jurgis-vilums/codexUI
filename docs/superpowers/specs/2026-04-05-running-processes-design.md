# Running Processes Panel — Design Spec

## Overview

A new panel at `/processes` that auto-discovers running dev server processes, classifies them by type, and displays them with appropriate action buttons. Includes a Tailscale VPN hostname banner for remote access from phone.

## Navigation

- New nav entry in sidebar below Skills Hub
- Route: `/processes`
- Same content-area pattern as Skills Hub (`isProcessesRoute` in App.vue)

## UI Layout

### Tailscale Banner
- Fixed at top of the panel
- Shows Tailscale hostname (e.g., `mymachine.tail1a2b3.ts.net`) as clickable link
- Green dot when connected, fetched once via `GET /codex-api/tailscale`

### Process List
- Header: count of detected processes + manual refresh button
- Each process is a card showing:
  - **Status indicator**: green dot (running), orange dot (unknown type)
  - **Name**: friendly name derived from command line (e.g., "Vite Dev Server")
  - **Runtime label**: small gray tag (node, dotnet, python, etc.)
  - **Details line**: `:port · PID · uptime`
- Action buttons per process type:
  - `web` → **Open** (blue) + **Stop** (red)
  - `backend` → **Stop** (red) only
  - `unknown` → no buttons, dimmed, "unknown type" label

### Open Button Behavior
- Opens `http://<tailscale-hostname>:<port>` in a new browser tab
- Falls back to `http://localhost:<port>` if Tailscale is unavailable

## Backend Architecture

### Process Discovery Service (`src/server/processService.ts`)

Polls every 5 seconds using `execFile` (no shell injection):
- **Windows**: `netstat -ano` for listening ports + PIDs, then `wmic process where "ProcessId=..." get CommandLine` for command lines
- **Linux**: `ss -tlnp` for ports + PIDs, `/proc/<pid>/cmdline` for command lines

Maintains an in-memory map of `PID → ProcessInfo`:
```typescript
interface ProcessInfo {
  pid: number
  name: string           // friendly name derived from command line
  runtime: string        // node, dotnet, python, ruby, go, java, unknown
  type: 'web' | 'backend' | 'unknown'
  port: number
  commandLine: string
  firstSeen: number      // timestamp, used to calculate uptime
}
```

### Process Classifier

Pattern registry matching process name + command line:

**Web (Open + Stop):**
- `node.*vite` or `vite` → Vite Dev Server
- `node.*next` → Next.js Dev Server
- `node.*webpack.*dev` → Webpack Dev Server
- `node.*react-scripts` → Create React App
- `python.*http\.server` → Python HTTP Server
- `node.*live-server` or `node.*serve` → Static File Server

**Backend (Stop only):**
- `dotnet` → .NET Application
- `python.*(flask|uvicorn|gunicorn|django)` → Python Backend
- `node.*(express|fastify|hono|koa)` → Node.js API
- `ruby.*(rails|puma|thin)` → Ruby Backend
- `go run` or Go binaries → Go Backend

**Unknown:** anything listening on a port but not matching known patterns. No action buttons.

### WebSocket Endpoint (`/ws/processes`)

Follows existing git WebSocket pattern:
- On connection: immediately sends full process list
- Every 5 seconds: pushes updated list (full replacement, not diffs — list is small)
- Handles `{ action: 'stop', pid: number, _id: string }` → sends SIGTERM (Linux) or taskkill (Windows)
- Response: `{ type: 'process-result', _id: string, success: boolean, error?: string }`

### Tailscale Hostname (`GET /codex-api/tailscale`)

- Resolves once on first request via `tailscale status --json`
- Caches result for 5 minutes, re-fetches on cache expiry
- Returns `{ hostname: string, online: boolean }` or `{ hostname: null, online: false }` if Tailscale not installed/connected

## Frontend Component (`src/components/content/ProcessesPanel.vue`)

- Connects to `/ws/processes` on mount, same pattern as DiffPanel
- Receives process list via WebSocket, updates reactive ref
- Tailscale hostname fetched via `fetch('/codex-api/tailscale')` on mount
- Stop action sends WebSocket message, shows toast on success/failure
- Open action constructs URL from Tailscale hostname + port, opens in new tab
- Auto-reconnects WebSocket on disconnect (same pattern as terminal)

## Files to Create/Modify

**New files:**
- `src/server/processService.ts` — discovery + classification
- `src/components/content/ProcessesPanel.vue` — UI component

**Modified files:**
- `src/server/httpServer.ts` — add `/ws/processes` endpoint + `/codex-api/tailscale` route
- `src/router/index.ts` — add `/processes` route
- `src/App.vue` — add `isProcessesRoute` check + render ProcessesPanel + nav entry

## Excluded from Scope

- Process log viewing / output streaming
- CPU/memory usage metrics
- Process grouping or filtering
- Custom pattern configuration UI (patterns are hardcoded, editable in source)
- Process restart functionality
