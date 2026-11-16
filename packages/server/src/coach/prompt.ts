// Composes the coach's instructions from the agent file and the skills it names
// (.claude/agents/coach-<mode>.md → .claude/skills/<name>/SKILL.md). The files stay where
// COACH.md puts them; the supervisor reads them and hands the coach one prompt, so it sees
// exactly this and nothing from the build's CLAUDE.md (confirmed in spike S1).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type AgentSpec = { name: string; model?: string; skills: string[]; body: string };

function splitFrontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const raw of m[1]!.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      (meta[listKey] as string[]).push(item[1]!.trim());
      continue;
    }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    if (kv[2] === '') {
      meta[kv[1]!] = [];
      listKey = kv[1]!;
    } else {
      meta[kv[1]!] = kv[2]!.trim();
      listKey = null;
    }
  }
  return { meta, body: m[2]!.trim() };
}

export function loadAgent(repoRoot: string, agent: string): AgentSpec {
  const file = path.join(repoRoot, '.claude', 'agents', `${agent}.md`);
  if (!existsSync(file)) throw new Error(`coach agent file not found: ${file}`);
  const { meta, body } = splitFrontmatter(readFileSync(file, 'utf8'));
  const skills = Array.isArray(meta.skills) ? meta.skills : typeof meta.skills === 'string' ? meta.skills.split(',').map((s) => s.trim()) : [];
  return { name: agent, model: typeof meta.model === 'string' ? meta.model : undefined, skills, body };
}

export function composePrompt(repoRoot: string, agent: AgentSpec): string {
  const parts = [agent.body];
  for (const skill of agent.skills) {
    const file = path.join(repoRoot, '.claude', 'skills', skill, 'SKILL.md');
    if (!existsSync(file)) throw new Error(`coach skill not found: ${file}`);
    parts.push(splitFrontmatter(readFileSync(file, 'utf8')).body);
  }
  return parts.join('\n\n---\n\n') + '\n';
}
