import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scanProjectFiles } from './projectFiles.js'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs/promises')
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/testuser') }))

describe('scanProjectFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finds CLAUDE.md and AGENTS.md in project root', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === '/project') return ['CLAUDE.md', 'AGENTS.md', 'src', 'package.json'] as any
      if (d === join('/project', '.claude', 'skills')) return [] as any
      return [] as any
    })
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      const p = String(path)
      if (p.endsWith('CLAUDE.md') || p.endsWith('AGENTS.md')) return { isFile: () => true, isDirectory: () => false, size: 500 } as any
      if (p.endsWith('.claude') || p.endsWith('skills') || p.endsWith('memory')) return { isFile: () => false, isDirectory: () => true, size: 0 } as any
      return { isFile: () => false, isDirectory: () => false, size: 0 } as any
    })
    vi.mocked(fs.readFile).mockResolvedValue('')

    const result = await scanProjectFiles('/project')

    const rootFiles = result.filter(f => f.category === 'root')
    expect(rootFiles.map(f => f.name)).toContain('CLAUDE.md')
    expect(rootFiles.map(f => f.name)).toContain('AGENTS.md')
  })

  it('finds memory files from ~/.claude/projects/{encoded}/memory/', async () => {
    const memoryDir = join('/home/testuser', '.claude', 'projects')
    // /project encodes to -project (no drive letter prefix on unix paths)
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === '/project') return [] as any
      if (d === memoryDir) return ['-project'] as any
      if (d.includes('memory')) return ['feedback_testing.md', 'MEMORY.md'] as any
      return [] as any
    })
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      const p = String(path)
      if (p.includes('memory') && p.endsWith('.md')) return { isFile: () => true, isDirectory: () => false, size: 200 } as any
      if (p.endsWith('memory')) return { isFile: () => false, isDirectory: () => true, size: 0 } as any
      return { isFile: () => false, isDirectory: () => false, size: 0 } as any
    })
    vi.mocked(fs.readFile).mockResolvedValue('---\nname: test\ndescription: test memory\ntype: feedback\n---\ncontent')

    const result = await scanProjectFiles('/project')

    const memoryFiles = result.filter(f => f.category === 'memory')
    // MEMORY.md should be skipped (it's an index)
    expect(memoryFiles).toHaveLength(1)
    expect(memoryFiles[0].name).toBe('feedback_testing.md')
  })

  it('finds project skills from {cwd}/.claude/skills/', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === '/project') return [] as any
      if (d === join('/project', '.claude', 'skills')) return ['my-skill'] as any
      return [] as any
    })
    vi.mocked(fs.stat).mockImplementation(async (path) => {
      const p = String(path)
      if (p.endsWith('my-skill')) return { isFile: () => false, isDirectory: () => true, size: 0 } as any
      if (p.endsWith('SKILL.md')) return { isFile: () => true, isDirectory: () => false, size: 300 } as any
      return { isFile: () => false, isDirectory: () => false, size: 0 } as any
    })
    vi.mocked(fs.readFile).mockResolvedValue('---\nname: my-skill\ndescription: A skill\n---\n# Content')

    const result = await scanProjectFiles('/project')

    const skills = result.filter(f => f.category === 'skill')
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('my-skill')
    expect(skills[0].path).toContain('SKILL.md')
  })

  it('handles missing directories gracefully', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'))

    const result = await scanProjectFiles('/nonexistent')
    expect(result).toEqual([])
  })
})
