# Integrated Terminal Panel

## Summary

Add an embedded terminal panel to codexUI's content area, providing a real shell session (via xterm.js + node-pty) toggled with Ctrl+`. The panel sits at the bottom of the content area (right of sidebar), is resizable, and persists its session when hidden.

## Backend

### PTY Management

- New module: `src/server/terminalPty.ts`
- Uses `node-pty` to spawn a shell process
  - Shell: user's default shell (respects `SHELL` env var, falls back to `bash` on Linux, `powershell.exe` on Windows)
  - CWD: project working directory from the current codex session
- PTY lifecycle:
  - Created on first WebSocket connection
  - Stays alive when client disconnects (5-minute grace period for reconnect)
  - Destroyed after grace period expires or on server shutdown
  - One PTY session per client (expandable later)

### WebSocket Endpoint

- New endpoint: `/ws/terminal` on the existing Express/HTTP server
- Protocol:
  - Client → Server: raw terminal input (keystrokes)
  - Server → Client: raw terminal output (PTY stdout)
  - Server → Client: JSON control messages for resize (`{ type: "resize", cols, rows }`)
  - Client → Server: JSON resize events when panel resizes
- Authentication: same as existing WebSocket connections (reuse auth middleware)

## Frontend

### Component: `TerminalPanel.vue`

- Location: `src/components/content/TerminalPanel.vue`
- Renders xterm.js terminal instance with `xterm-addon-fit`
- WebSocket connection to `/ws/terminal`
- On toggle-open: connects (or reconnects), calls `terminal.fit()`
- On toggle-close: hides panel, keeps WebSocket alive
- Theme: matches app dark/light mode via xterm custom color scheme
- On component unmount: closes WebSocket

### Layout Integration

- Panel sits at the bottom of the **content area** (right of sidebar)
- Integrated into `DesktopLayout.vue` layout structure
- Drag handle on top edge of terminal panel for resizing

### Sizing

- Default height: 30% of content area
- Min height: 100px
- Max height: 70% of content area
- Height persisted to localStorage key: `codex-web-local.terminal-height.v1`
- Calls `terminal.fit()` on resize (debounced) and sends new dimensions to server

## Keybinding & State

- **Ctrl+`** toggles terminal panel visibility
  - Added to `onWindowKeyDown()` in `App.vue`
  - `event.preventDefault()` to avoid browser default
- State in `useDesktopState.ts`:
  - `terminalOpen: ref<boolean>` — persisted to localStorage (`codex-web-local.terminal-open.v1`)
  - Defaults to `false` on first visit

## Dependencies

New npm packages:
- `xterm` — terminal emulator frontend
- `@xterm/addon-fit` — auto-fit terminal to container
- `node-pty` — native PTY bindings for Node.js

## Out of Scope

- Multiple terminal tabs/sessions (future enhancement)
- View menu bar (separate feature)
- Terminal split panes
