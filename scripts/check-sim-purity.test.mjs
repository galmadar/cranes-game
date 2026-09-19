import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-sim-purity.mjs');

let root;
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

/** Runs the check against a throwaway `src/` built from `files`. */
function check(files) {
  root = mkdtempSync(join(tmpdir(), 'purity-'));
  const all = { 'src/sim/ok.ts': 'export const x = 1;\n', 'src/content/ok.ts': 'export const y = 2;\n', ...files };
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

describe('purity check', () => {
  it('passes a clean tree', () => {
    expect(check({}).ok).toBe(true);
  });

  it('fails content that imports three', () => {
    const r = check({ 'src/content/bad.ts': "import * as THREE from 'three';\n" });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('src/content/bad.ts:1');
  });

  it('fails content that touches the DOM or render code', () => {
    const r = check({
      'src/content/dom.ts': 'export const w = window.innerWidth;\n',
      'src/content/r.ts': "import { R } from '../render/Renderer';\n",
    });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('src/content/dom.ts:1');
    expect(r.out).toContain('src/content/r.ts:1');
  });

  it('fails pure content that imports a view file', () => {
    const r = check({
      'src/content/a.view.ts': "import * as THREE from 'three';\n",
      'src/content/b.ts': "import { m } from './a.view';\n",
    });
    expect(r.ok).toBe(false);
    expect(r.out).toContain('src/content/b.ts:1');
  });

  it('lets *.view.ts files draw', () => {
    const r = check({
      'src/content/a.view.ts': "import * as THREE from 'three';\nimport { R } from '../render/R';\n",
    });
    expect(r.ok).toBe(true);
  });
});
