import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scanClaudeSkills } from './claudeSkills.js'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs/promises')
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/testuser') }))

describe('scanClaudeSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user-level skills from ~/.claude/skills/', async () => {
    // ~/.claude/skills/ has two skill directories
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === join('/home/testuser', '.claude', 'skills')) {
        return ['timer', 'ssh-key-setup'] as any
      }
      return []
    })

    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)

    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const p = String(path)
      if (p.includes('timer')) {
        return `---
name: timer
description: Start a countdown timer overlay on screen.
---
# Timer skill content`
      }
      if (p.includes('ssh-key-setup')) {
        return `---
name: ssh-key-setup
description: Set up passwordless SSH key auth on remote servers.
---
# SSH Key Setup`
      }
      throw new Error('File not found')
    })

    const result = await scanClaudeSkills('/project')

    // Only user-level entry (project dir returns empty)
    const userEntry = result.data.find((d: any) => d.scope === 'user')
    expect(userEntry).toBeDefined()
    expect(userEntry.skills).toHaveLength(2)

    const timer = userEntry.skills.find((s: any) => s.name === 'timer')
    expect(timer).toMatchObject({
      name: 'timer',
      description: 'Start a countdown timer overlay on screen.',
      scope: 'user',
      enabled: true,
    })
    expect(timer.path).toContain('timer')
  })

  it('returns project-level skills from .claude/skills/', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === join('/project', '.claude', 'skills')) {
        return ['my-project-skill'] as any
      }
      return []
    })

    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)

    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const p = String(path)
      if (p.includes('my-project-skill')) {
        return `---
name: my-project-skill
description: A project-specific skill.
---
# Content`
      }
      throw new Error('File not found')
    })

    const result = await scanClaudeSkills('/project')

    const projectEntry = result.data.find((d: any) => d.scope === 'project')
    expect(projectEntry).toBeDefined()
    expect(projectEntry.skills).toHaveLength(1)
    expect(projectEntry.skills[0]).toMatchObject({
      name: 'my-project-skill',
      scope: 'project',
      enabled: true,
    })
  })

  it('handles missing skill directories gracefully', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'))

    const result = await scanClaudeSkills('/project')
    expect(result.data).toEqual([])
  })

  it('skips skill files with invalid frontmatter', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      const d = String(dir)
      if (d === join('/home/testuser', '.claude', 'skills')) {
        return ['good-skill', 'bad-skill'] as any
      }
      return []
    })

    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any)

    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const p = String(path)
      if (p.includes('good-skill')) {
        return `---
name: good-skill
description: Works fine.
---
# Content`
      }
      if (p.includes('bad-skill')) {
        return `No frontmatter here, just text.`
      }
      throw new Error('File not found')
    })

    const result = await scanClaudeSkills('/project')
    const userEntry = result.data.find((d: any) => d.scope === 'user')
    expect(userEntry.skills).toHaveLength(1)
    expect(userEntry.skills[0].name).toBe('good-skill')
  })
})
