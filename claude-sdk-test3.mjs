import { query } from '@anthropic-ai/claude-agent-sdk'

let sessionId = null

async function send(text) {
  const abortController = new AbortController()
  const opts = {
    cwd: 'C:/Users/vilum/Documents/dev',
    permissionMode: 'bypassPermissions',
    includePartialMessages: true,
    abortController,
    model: undefined,
  }
  if (sessionId) opts.resume = sessionId

  console.log(`\n--- Sending: "${text}" (resume: ${sessionId?.slice(0,12) || 'none'}) ---`)
  const q = query({ prompt: text, options: opts })

  let gotResponse = false
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      sessionId = msg.session_id
      console.log('  init:', sessionId.slice(0, 12))
    }
    if (msg.type === 'stream_event') {
      const d = msg.event?.delta
      if (d?.type === 'text_delta') process.stdout.write(d.text)
    }
    if (msg.type === 'assistant') {
      const t = msg.message?.content?.filter(c => c.type === 'text').map(c => c.text).join('')
      if (t) { console.log('\n  response:', t.slice(0, 100)); gotResponse = true; }
    }
    if (msg.type === 'result') {
      console.log('  result:', msg.subtype)
    }
  }
  if (!gotResponse) console.log('  [NO RESPONSE]')
  console.log('  [stream ended]')
}

await send('Secret word is kiwi. Confirm.')
await send('What was the secret word?')

console.log('\nDone.')
process.exit(0)
