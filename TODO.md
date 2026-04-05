# TODO

## Terminal

- [ ] Add mobile Ctrl+C button — visible action button in terminal panel that sends interrupt signal for phone users
- [ ] Terminal too small on mobile — default 250px height leaves little usable space on phone viewports; consider larger default or maximize button

## Diff Panel

- [ ] "No changes" text low contrast in dark mode — `.diff-empty` uses `text-slate-400`, needs dark mode override
- [ ] Terminal colored output lost on theme switch — existing ANSI-colored text loses formatting when MutationObserver updates xterm theme

## UI Polish

- [ ] Header buttons lack visual separation — terminal and git icons sit tight against Codex/Claude toggle with no gap
- [ ] Hide conf UI when collapsed — collapsed state should fully remove the extra panel/content
