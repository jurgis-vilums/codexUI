import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export type GitFileStatus = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
  oldPath?: string
}

function parsePorcelainV2(output: string): GitFileStatus[] {
  const files: GitFileStatus[] = []
  const lines = output.split('\n').filter(Boolean)

  for (const line of lines) {
    if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      const path = parts.slice(8).join(' ')
      const x = xy[0]
      const y = xy[1]

      if (x !== '.') {
        files.push({
          path,
          status: x === 'A' ? 'added' : x === 'D' ? 'deleted' : 'modified',
          staged: true,
        })
      }
      if (y !== '.') {
        files.push({
          path,
          status: y === 'A' ? 'added' : y === 'D' ? 'deleted' : 'modified',
          staged: false,
        })
      }
    } else if (line.startsWith('2 ')) {
      const parts = line.split('\t')
      const header = parts[0].split(' ')
      const xy = header[1]
      const newPath = parts[1]
      const oldPath = parts[2]

      if (xy[0] !== '.') {
        files.push({ path: newPath, status: 'renamed', staged: true, oldPath })
      }
      if (xy[1] !== '.') {
        files.push({ path: newPath, status: 'renamed', staged: false, oldPath })
      }
    } else if (line.startsWith('? ')) {
      const path = line.slice(2)
      files.push({ path, status: 'untracked', staged: false })
    }
  }

  return files
}

async function gitExec(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${args.join(' ')}`, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

export async function gitStatus(cwd: string): Promise<GitFileStatus[]> {
  const { stdout } = await gitExec(['status', '--porcelain=v2'], cwd)
  return parsePorcelainV2(stdout)
}

export async function gitDiffUnstaged(cwd: string, path?: string): Promise<string> {
  const args = ['diff', '--no-color', '--unified=3']
  if (path) args.push('--', path)
  const { stdout } = await gitExec(args, cwd)
  return stdout
}

export async function gitDiffStaged(cwd: string, path?: string): Promise<string> {
  const args = ['diff', '--staged', '--no-color', '--unified=3']
  if (path) args.push('--', path)
  const { stdout } = await gitExec(args, cwd)
  return stdout
}

export async function gitStageFile(cwd: string, path: string): Promise<void> {
  await gitExec(['add', '--', path], cwd)
}

export async function gitUnstageFile(cwd: string, path: string): Promise<void> {
  await gitExec(['restore', '--staged', '--', path], cwd)
}

export async function gitStageAll(cwd: string): Promise<void> {
  await gitExec(['add', '-A'], cwd)
}

export async function gitUnstageAll(cwd: string): Promise<void> {
  await gitExec(['restore', '--staged', '.'], cwd)
}

export async function gitRevertFile(cwd: string, path: string): Promise<void> {
  await gitExec(['checkout', '--', path], cwd)
}

export async function gitRevertAll(cwd: string): Promise<void> {
  await gitExec(['checkout', '--', '.'], cwd)
}

export type GitAction =
  | { action: 'status'; _id?: string }
  | { action: 'diff'; staged?: boolean; path?: string; _id?: string }
  | { action: 'stage'; path: string; _id?: string }
  | { action: 'unstage'; path: string; _id?: string }
  | { action: 'stage-all'; _id?: string }
  | { action: 'unstage-all'; _id?: string }
  | { action: 'revert'; path: string; _id?: string }
  | { action: 'revert-all'; _id?: string }

export async function handleGitAction(msg: GitAction, cwd: string): Promise<{ action: string; data?: unknown; error?: string }> {
  try {
    switch (msg.action) {
      case 'status': {
        const files = await gitStatus(cwd)
        return { action: 'status', data: files }
      }
      case 'diff': {
        const diff = msg.staged ? await gitDiffStaged(cwd, msg.path) : await gitDiffUnstaged(cwd, msg.path)
        return { action: 'diff', data: diff }
      }
      case 'stage': {
        await gitStageFile(cwd, msg.path)
        return { action: 'stage' }
      }
      case 'unstage': {
        await gitUnstageFile(cwd, msg.path)
        return { action: 'unstage' }
      }
      case 'stage-all': {
        await gitStageAll(cwd)
        return { action: 'stage-all' }
      }
      case 'unstage-all': {
        await gitUnstageAll(cwd)
        return { action: 'unstage-all' }
      }
      case 'revert': {
        await gitRevertFile(cwd, msg.path)
        return { action: 'revert' }
      }
      case 'revert-all': {
        await gitRevertAll(cwd)
        return { action: 'revert-all' }
      }
      default:
        return { action: 'unknown', error: 'Unknown git action' }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { action: msg.action, error: message }
  }
}
