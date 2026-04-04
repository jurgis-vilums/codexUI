# Multi-turn Message Bug in Claude Adapter

## Problem
Second message in a Claude mode conversation gets an empty stream — `turn/started` → `turn/completed` immediately with no response.

## What works
- First message in a new thread: works perfectly (SDK `query()` → streaming deltas → response displayed)
- SDK resume directly: works perfectly (see `claude-sdk-test3.mjs` — two sequential `query()` calls with `resume` produce correct responses)

## What fails
- Second message via the adapter: `query({ resume: sessionId })` returns an empty stream (no `assistant` messages, goes straight to `result` or ends)

## Root cause (narrowed down)
The adapter's `processStream` runs as **fire-and-forget** (background Promise). When Turn 2 calls `query({ resume })`, the first turn's generator may not be fully closed/garbage collected. The SDK might see a conflicting session state.

**Proof:** `claude-sdk-test3.mjs` works because it `await`s each `for await` loop sequentially — the first generator is fully consumed and closed before the second `query()` starts. The adapter doesn't guarantee this.

## Key files
- `src/server/claudeAdapter.ts` — `handleTurnStart()` (line ~343) and `processStream()` (line ~421)
- `claude-sdk-test3.mjs` — working direct SDK test (two turns, same options as adapter)
- `claude-chat-test.html` — browser test app (in `dist/`)

## What's been tried
1. ~~Breaking on `result` message~~ → removed, let stream end naturally
2. ~~Aborting previous query before resume~~ → made it worse (corrupted session)
3. ~~Waiting 1s after abort~~ → didn't help
4. ~~Tracking `activeStreams` Promise and awaiting it~~ → key mismatch (pending ID vs real ID), fixed but untested

## The fix should be
Make `handleTurnStart` for Turn 2 **actually wait** for Turn 1's `processStream` to fully complete before calling `query({ resume })`. The `activeStreams` Map now tracks promises under both pending and real IDs. The wait logic is at line ~352. Needs verification.

## How to test
1. `http://localhost:5999/claude-chat-test.html` — send two messages, check WebSocket log
2. Or: `node claude-sdk-test3.mjs` (works — proves SDK is fine)
3. Expected: Turn 2 should show `[ws] item/agentMessage/delta` with response text, not just `[ws] turn/completed`
