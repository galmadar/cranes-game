#!/usr/bin/env node
/**
 * Enforces NFR-1: `src/sim/` must not depend on the renderer, the shell, or
 * any content.
 *
 * This is the single architectural rule that keeps the renderer swappable and
 * the simulation headlessly testable. Rules that are only written down get
 * broken; this one fails the build.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SIM_DIR = join(process.cwd(), 'src', 'sim');

const FORBIDDEN = [
  { pattern: /from\s+['"]three(\/[^'"]*)?['"]/, why: 'imports three.js' },
  { pattern: /from\s+['"][^'"]*\/render\//, why: 'imports from render/' },
  { pattern: /from\s+['"][^'"]*\/shell\//, why: 'imports from shell/' },
  { pattern: /from\s+['"][^'"]*\/content\//, why: 'imports from content/' },
  { pattern: /\bdocument\s*\./, why: 'touches the DOM' },
  { pattern: /\bwindow\s*\./, why: 'touches window' },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(SIM_DIR);
} catch {
  console.error(`sim purity: cannot read ${SIM_DIR}`);
  process.exit(1);
}

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(line)) {
        violations.push({ file: relative(process.cwd(), file), line: i + 1, why, text: line.trim() });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('\n  sim purity check FAILED (NFR-1)\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.why}`);
    console.error(`    ${v.text}\n`);
  }
  console.error('  src/sim must stay pure: no renderer, no DOM, no content imports.\n');
  process.exit(1);
}

console.log(`sim purity OK — ${files.length} files in src/sim, no forbidden dependencies`);
