// Skills du repo (.claude/skills/*/SKILL.md) : nom, description et indice d'argument du frontmatter.
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} root
 * @returns {Promise<{name: string, description: string, argumentHint: string}[]>}
 */
export async function getSkills(root) {
  const dir = path.join(root, '.claude', 'skills');
  /** @type {string[]} */
  let names = [];
  try { names = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  const skills = [];
  for (const n of names.sort()) {
    let txt = '';
    try { txt = await fsp.readFile(path.join(dir, n, 'SKILL.md'), 'utf8'); } catch {}
    const meta = parseFrontmatter(txt);
    skills.push({ name: meta.name || n, description: meta.description || '', argumentHint: meta['argument-hint'] || '' });
  }
  return skills;
}

/** @param {string} txt */
export function parseFrontmatter(txt) {
  const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  /** @type {Record<string, string>} */
  const meta = {};
  if (fm) for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return meta;
}
