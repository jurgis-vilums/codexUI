import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

type SkillInfo = {
  name: string
  description: string
  path: string
  scope: string
  enabled: boolean
}

type SkillsListResponse = {
  data: Array<{
    scope: string
    skills: SkillInfo[]
  }>
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}

  const yaml = match[1]
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  return { name, description }
}

async function scanDirectory(dir: string, scope: string): Promise<SkillInfo[]> {
  let entries: string[]
  try {
    entries = await readdir(dir) as unknown as string[]
  } catch {
    return []
  }

  const skills: SkillInfo[] = []

  for (const entry of entries) {
    const skillDir = join(dir, entry)
    try {
      const s = await stat(skillDir)
      if (!s.isDirectory()) continue

      const skillFile = join(skillDir, 'SKILL.md')
      const content = await readFile(skillFile, 'utf-8')
      const { name, description } = parseFrontmatter(content)

      if (!name) continue

      skills.push({
        name,
        description: description ?? '',
        path: skillDir,
        scope,
        enabled: true,
      })
    } catch {
      continue
    }
  }

  return skills
}

export async function scanClaudeSkills(cwd: string): Promise<SkillsListResponse> {
  const userSkillsDir = join(homedir(), '.claude', 'skills')
  const projectSkillsDir = join(cwd, '.claude', 'skills')

  const [userSkills, projectSkills] = await Promise.all([
    scanDirectory(userSkillsDir, 'user'),
    scanDirectory(projectSkillsDir, 'project'),
  ])

  const data: SkillsListResponse['data'] = []
  if (userSkills.length > 0) data.push({ scope: 'user', skills: userSkills })
  if (projectSkills.length > 0) data.push({ scope: 'project', skills: projectSkills })

  return { data }
}
