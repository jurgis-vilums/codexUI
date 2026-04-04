import { query } from '@anthropic-ai/claude-agent-sdk'

let sessionId = null

async function send(text) {
  const opts = {
    cwd: 'C:/Users/vilum/Documents/dev',
    permissionMode: 'bypassPermissions',
  }
  if (sessionId) opts.resume = sessionId

  console.log(`\n--- Sending: "${text}" (resume: ${sessionId?.slice(0,12) || 'none'}) ---`)
  const q = query({ prompt: text, options: opts })

  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      sessionId = msg.session_id
      console.log('  init:', sessionId.slice(0, 12))
    }
    if (msg.type === 'assistant') {
      const t = msg.message?.content?.filter(c => c.type === 'text').map(c => c.text).join('')
      if (t) console.log('  response:', t.slice(0, 100))
    }
    if (msg.type === 'result') {
      console.log('  result:', msg.subtype)
    }
  }
  console.log('  [stream ended]')
}

await send('The secret word is mango. Confirm.')
await send('What was the secret word?')

console.log('\nDone.')
process.exit(0)
