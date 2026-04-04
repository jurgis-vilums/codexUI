import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

export type ProjectFile = {
  name: string
  path: string
  category: 'root' | 'memory' | 'skill' | 'config'
  description?: string
  size?: number
}

const ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir) as unknown as string[]
  } catch {
    return []
  }
}

async function safeStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return result
}

/**
 * Encode a cwd path to the format Claude uses for project directories.
 * e.g., C:\Users\vilum\Documents\dev → C--Users-vilum-Documents-dev
 */
function encodeProjectPath(cwd: string): string {
  return cwd
    .replace(/^\/mnt\/([a-z])\//, (_, drive: string) => `${drive.toUpperCase()}--`)
    .replace(/^([A-Z]):[/\\]/, (_, drive: string) => `${drive}--`)
    .replace(/[/\\]/g, '-')
}

async function scanRootFiles(cwd: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []
  const entries = await safeReaddir(cwd)
  for (const name of ROOT_FILES) {
    if (!entries.includes(name)) continue
    const path = join(cwd, name)
    const s = await safeStat(path)
    if (s?.isFile()) {
      files.push({ name, path, category: 'root', size: s.size })
    }
  }
  return files
}

async function scanMemoryFiles(cwd: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []
  const projectsDir = join(homedir(), '.claude', 'projects')
  const encoded = encodeProjectPath(cwd)

  // Find matching project directory
  const projectDirs = await safeReaddir(projectsDir)
  const match = projectDirs.find(d => d.toLowerCase() === encoded.toLowerCase())
  if (!match) return files

  const memoryDir = join(projectsDir, match, 'memory')
  const entries = await safeReaddir(memoryDir)

  for (const name of entries) {
    if (!name.endsWith('.md') || name === 'MEMORY.md') continue
    const path = join(memoryDir, name)
    const s = await safeStat(path)
    if (!s?.isFile()) continue

    let description = ''
    try {
      const content = await readFile(path, 'utf-8')
      const fm = parseFrontmatter(content)
      description = fm.description ?? ''
    } catch {}

    files.push({ name, path, category: 'memory', description, size: s.size })
  }
  return files
}

async function scanProjectSkills(cwd: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []
  const skillsDir = join(cwd, '.claude', 'skills')
  const entries = await safeReaddir(skillsDir)

  for (const name of entries) {
    const skillDir = join(skillsDir, name)
    const s = await safeStat(skillDir)
    if (!s?.isDirectory()) continue

    const skillMd = join(skillDir, 'SKILL.md')
    const ss = await safeStat(skillMd)
    if (!ss?.isFile()) continue

    let description = ''
    try {
      const content = await readFile(skillMd, 'utf-8')
      const fm = parseFrontmatter(content)
      description = fm.description ?? ''
    } catch {}

    files.push({ name, path: skillMd, category: 'skill', description, size: ss.size })
  }
  return files
}

async function scanCodexConfig(cwd: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []
  const codexDir = join(cwd, '.codex')
  const entries = await safeReaddir(codexDir)
  for (const name of entries) {
    const path = join(codexDir, name)
    const s = await safeStat(path)
    if (s?.isFile()) {
      files.push({ name, path, category: 'config', size: s.size })
    }
  }
  return files
}

async function scanClaudeConfig(cwd: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []
  const claudeDir = join(cwd, '.claude')
  const entries = await safeReaddir(claudeDir)
  for (const name of entries) {
    if (name === 'skills') continue // handled separately
    const path = join(claudeDir, name)
    const s = await safeStat(path)
    if (s?.isFile()) {
      files.push({ name, path, category: 'config', size: s.size })
    }
  }
  return files
}

export async function scanProjectFiles(cwd: string): Promise<ProjectFile[]> {
  const [rootFiles, memoryFiles, skillFiles, claudeConfig, codexConfig] = await Promise.all([
    scanRootFiles(cwd),
    scanMemoryFiles(cwd),
    scanProjectSkills(cwd),
    scanClaudeConfig(cwd),
    scanCodexConfig(cwd),
  ])
  return [...rootFiles, ...memoryFiles, ...skillFiles, ...claudeConfig, ...codexConfig]
}

/**
 * Read a file's content. Only allows files under .claude/ directories or root config files.
 */
export async function readProjectFile(path: string): Promise<{ content: string } | null> {
  const norm = path.replace(/\\/g, '/')
  const allowed = norm.includes('/.claude/') || norm.includes('\\.claude\\')
    || ROOT_FILES.some(f => norm.endsWith('/' + f) || norm.endsWith('\\' + f))
  if (!allowed) return null

  try {
    const content = await readFile(path, 'utf-8')
    return { content }
  } catch {
    return null
  }
}

/**
 * Save file content. Same security restrictions as read.
 */
export async function saveProjectFile(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
  const norm = path.replace(/\\/g, '/')
  const allowed = norm.includes('/.claude/') || norm.includes('\\.claude\\')
    || ROOT_FILES.some(f => norm.endsWith('/' + f) || norm.endsWith('\\' + f))
  if (!allowed) return { ok: false, error: 'Path not allowed' }

  try {
    await writeFile(path, content, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
