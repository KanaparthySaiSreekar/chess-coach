// `npm run check:docs` (PLAN, WP 3.1; ARCHITECTURE §17):
//   1. every feature ID in docs/FEATURES.md sits in exactly one phase of docs/PLAN.md, the phase
//      FEATURES names for it; a parked feature sits in none;
//   2. every link between the docs resolves: the file exists and so does the heading it points at.
// Exits 1 and lists what is wrong, so it can run before a commit.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = /^[A-K]\d+$/;

/** Feature rows of FEATURES.md: `| A1 | … | owner | 3 | agreed |` → id, phase, status. */
export function featuresIn(markdown) {
  const out = [];
  let phaseCol = -1;
  let statusCol = -1;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      phaseCol = statusCol = -1;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'ID') {
      phaseCol = cells.indexOf('Phase');
      statusCol = cells.indexOf('Status');
      continue;
    }
    if (phaseCol < 0 || !ID.test(cells[0] ?? '')) continue;
    out.push({ id: cells[0], phase: cells[phaseCol] ?? '', status: (cells[statusCol] ?? '').replace(/`/g, '') });
  }
  return out;
}

/** PLAN.md: the "Home of features" table, and each phase section's own **Features:** line. */
export function planPhases(markdown) {
  const table = new Map();
  const sections = new Map();
  let section = null;
  for (const line of markdown.split(/\r?\n/)) {
    const row = line.match(/^\|\s*(\d+)\s*\|[^|]*\|([^|]*)\|\s*$/);
    if (row) table.set(row[1], row[2].split(',').map((x) => x.trim()).filter((x) => ID.test(x)));
    const head = line.match(/^## Phase (\d+):/);
    if (head) section = head[1];
    const feats = line.match(/^\*\*Features:\*\*(.*)$/);
    if (feats && section) sections.set(section, feats[1].split(',').map((x) => x.trim()).filter((x) => ID.test(x)));
  }
  return { table, sections };
}

export function checkFeatures(featuresMd, planMd) {
  const problems = [];
  const features = featuresIn(featuresMd);
  const { table, sections } = planPhases(planMd);
  const seen = new Map();
  for (const f of features) {
    if (seen.has(f.id)) problems.push(`FEATURES: ${f.id} is listed twice`);
    seen.set(f.id, f);
  }
  const home = new Map();
  for (const [phase, ids] of table) {
    for (const id of ids) {
      if (home.has(id)) problems.push(`PLAN: ${id} is in two phases (${home.get(id)} and ${phase})`);
      else home.set(id, phase);
      if (!seen.has(id)) problems.push(`PLAN: ${id} (phase ${phase}) is not in FEATURES`);
    }
  }
  for (const f of seen.values()) {
    const parked = f.status.startsWith('parked');
    const at = home.get(f.id);
    if (parked) {
      if (at) problems.push(`${f.id} is parked in FEATURES but still sits in phase ${at} of PLAN`);
      continue;
    }
    if (!at) problems.push(`${f.id} is in FEATURES (phase ${f.phase || '?'}) but in no phase of PLAN`);
    else if (f.phase !== at) problems.push(`${f.id}: FEATURES says phase ${f.phase}, PLAN's table says phase ${at}`);
  }
  for (const [phase, ids] of sections) {
    const inTable = table.get(phase) ?? [];
    const a = [...ids].sort().join(', ');
    const b = [...inTable].sort().join(', ');
    if (a !== b) problems.push(`PLAN: phase ${phase}'s "Features:" line (${a || 'none'}) differs from the table (${b || 'none'})`);
  }
  return { problems, count: seen.size };
}

/** The anchor GitHub gives a heading. A second heading with the same text gets "-1", and so on. */
export function anchorsOf(markdown) {
  const anchors = new Set();
  const counts = new Map();
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // a link in a heading counts by its text
      .replace(/[`*_]/g, '');
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const n = counts.get(slug) ?? 0;
    counts.set(slug, n + 1);
    anchors.add(n ? `${slug}-${n}` : slug);
  }
  return anchors;
}

/** Links of a markdown file that point inside the repo: `[text](file.md#anchor)`, `[text](#anchor)`. */
export function linksIn(markdown) {
  const out = [];
  let fenced = false;
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const text = line.replace(/`[^`]*`/g, ''); // not inside code
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/i.test(target)) continue;
      out.push({ line: i + 1, target });
    }
  });
  return out;
}

export function checkLinks(files, read = (f) => readFileSync(f, 'utf8'), exists = existsSync) {
  const problems = [];
  const anchorCache = new Map();
  const anchors = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(read(file)));
    return anchorCache.get(file);
  };
  let checked = 0;
  for (const file of files) {
    for (const link of linksIn(read(file))) {
      checked++;
      const [rawPath, hash] = link.target.split('#');
      const target = rawPath ? path.resolve(path.dirname(file), decodeURIComponent(rawPath)) : file;
      if (!exists(target)) {
        problems.push(`${file}:${link.line}: "${link.target}" points at a file that does not exist`);
        continue;
      }
      if (hash && /\.md$/i.test(target) && !anchors(target).has(decodeURIComponent(hash).toLowerCase())) {
        problems.push(`${file}:${link.line}: "${link.target}" points at a heading that does not exist`);
      }
    }
  }
  return { problems, checked };
}

/** The docs that are kept in step: the top-level ones, docs/, and the coach's agent and skill files. */
export function docFiles(root) {
  const out = [];
  for (const f of ['CLAUDE.md', 'TRACKER.md']) if (existsSync(path.join(root, f))) out.push(path.join(root, f));
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(path.join(root, 'docs'));
  walk(path.join(root, '.claude', 'agents'));
  walk(path.join(root, '.claude', 'skills'));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const features = checkFeatures(readFileSync(path.join(root, 'docs', 'FEATURES.md'), 'utf8'), readFileSync(path.join(root, 'docs', 'PLAN.md'), 'utf8'));
  const files = docFiles(root);
  const links = checkLinks(files);
  const problems = [...features.problems, ...links.problems.map((p) => p.replace(root + path.sep, '').replaceAll('\\', '/'))];
  if (problems.length) {
    console.error(`check:docs found ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`check:docs: ${features.count} features each in one phase; ${links.checked} links in ${files.length} files resolve`);
}
