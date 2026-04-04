import { query } from '@anthropic-ai/claude-agent-sdk'
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })
let sessionId = null

function ask(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve))
}

async function send(text) {
  const opts = {
    cwd: 'C:/Users/vilum/Documents/dev',
    permissionMode: 'bypassPermissions',
  }
  if (sessionId) opts.resume = sessionId

  console.log('\x1b[90m[sending...]\x1b[0m')
  const q = query({ prompt: text, options: opts })

  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      sessionId = msg.session_id
    }
    if (msg.type === 'assistant') {
      const text = msg.message?.content?.filter(c => c.type === 'text').map(c => c.text).join('')
      if (text) process.stdout.write('\x1b[32m' + text + '\x1b[0m')
    }
    if (msg.type === 'result') {
      console.log('\n\x1b[90m[' + msg.subtype + ' | session: ' + (sessionId?.slice(0, 12) || 'none') + ']\x1b[0m')
    }
  }
}

console.log('Claude SDK direct test. Type messages, Ctrl+C to quit.\n')

while (true) {
  const text = await ask('\x1b[36m> \x1b[0m')
  if (!text.trim()) continue
  await send(text.trim())
}
