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

  if (!content.includes('## Feedback')) {
    content = content.trimEnd() + '\n\n## Feedback\n\n'
  }

  content = content.trimEnd() + '\n' + entry
  await writeFile(TODO_PATH, content, 'utf-8')

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
