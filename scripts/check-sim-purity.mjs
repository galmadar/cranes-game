#!/usr/bin/env node
/**
 * Enforces NFR-1: `src/sim/` must not depend on the renderer, the DOM, or any
 * layer above it.
 *
 * This is the single architectural rule that keeps the renderer swappable and
 * the simulation headlessly testable. Rules that are only written down get
 * broken; this one fails the build.
 *
 * Relative imports are RESOLVED rather than pattern-matched — `../input/` means
 * different things from different depths, and a regex cannot tell the pure
 * `src/sim/input/actions` apart from the DOM adapter in `src/input/`.
 *
 * Test files are scanned for renderer/DOM leakage but are allowed to import
 * content: exercising the real bulldozer definition is the point of the test,
 * and test code never ships.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const SIM = join(SRC, 'sim');

const FORBIDDEN_PACKAGES = [{ test: (s) => s === 'three' || s.startsWith('three/'), why: 'three.js' }];

const DOM_GLOBALS = [
  { pattern: /(^|[^.\w])document\s*\./, why: 'touches the DOM (document)' },
  { pattern: /(^|[^.\w])window\s*\./, why: 'touches the DOM (window)' },
  { pattern: /(^|[^.\w])navigator\s*\./, why: 'touches the DOM (navigator)' },
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

/** Every import/export specifier in a source file, with its line number. */
function* specifiers(source) {
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(line)) !== null) {
      yield { specifier: match[1], line: i + 1, text: trimmed };
    }
  }
}

let files;
try {
  files = walk(SIM);
} catch {
  console.error(`sim purity: cannot read ${SIM}`);
  process.exit(1);
}

const violations = [];

for (const file of files) {
  const isTest = file.endsWith('.test.ts');
  const source = readFileSync(file, 'utf8');
  const where = relative(ROOT, file);

  for (const { specifier, line, text } of specifiers(source)) {
    const pkg = FORBIDDEN_PACKAGES.find((p) => p.test(specifier));
    if (pkg) {
      violations.push({ where, line, why: `imports ${pkg.why}`, text });
      continue;
    }

    if (!specifier.startsWith('.')) continue;

    const target = resolve(dirname(file), specifier);
    if (target.startsWith(SIM + sep)) continue; // inside sim — fine

    // Escapes sim. Tests may reach into content for fixtures; nothing else may.
    const rel = relative(SRC, target).split(sep)[0];
    if (isTest && rel === 'content') continue;

    violations.push({ where, line, why: `imports from ${rel}/ — outside sim`, text });
  }

  if (isTest) continue;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    for (const { pattern, why } of DOM_GLOBALS) {
      if (pattern.test(lines[i])) violations.push({ where, line: i + 1, why, text: trimmed });
    }
  }
}

if (violations.length > 0) {
  console.error('\n  sim purity check FAILED (NFR-1)\n');
  for (const v of violations) {
    console.error(`  ${v.where}:${v.line} — ${v.why}`);
    console.error(`    ${v.text}\n`);
  }
  console.error('  src/sim must stay pure: no renderer, no DOM, no upward imports.\n');
  process.exit(1);
}

console.log(`sim purity OK — ${files.length} files in src/sim, no forbidden dependencies`);
