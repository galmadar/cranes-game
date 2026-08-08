/**
 * Diagnostic HUD.
 *
 * Terrain volume is on screen from day one on purpose: it is the invariant
 * FR-3.5 is built around, and in M3 you want to watch it hold steady while you
 * push dirt, not discover it drifting three days later.
 */

import { MATERIAL_LIST } from '../sim/materials';

export interface HudStats {
  fps: number;
  frameMs: number;
  steps: number;
  simTime: number;
  cells: number;
  volume: number;
  drawCalls: number;
  triangles: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const ROWS = [
  ['fps', 'FPS'],
  ['frame', 'Frame'],
  ['steps', 'Sim steps'],
  ['time', 'Sim time'],
  ['cells', 'Cells'],
  ['volume', 'Volume'],
  ['draws', 'Draw calls'],
  ['tris', 'Triangles'],
] as const;

export class Hud {
  private readonly values = new Map<string, HTMLElement>();
  private readonly root: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly help: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud');
    this.root.id = 'hud-stats';
    this.root.appendChild(el('h2', undefined, 'Cranes Game &middot; M1'));

    const dl = el('dl');
    for (const [key, label] of ROWS) {
      dl.appendChild(el('dt', undefined, label));
      const dd = el('dd', undefined, '—');
      this.values.set(key, dd);
      dl.appendChild(dd);
    }
    this.root.appendChild(dl);

    this.legend = el('div', 'hud');
    this.legend.id = 'hud-legend';
    this.legend.appendChild(el('h2', undefined, 'Materials'));
    for (const m of MATERIAL_LIST) {
      const rgb = m.color.map((c) => Math.round(c * 255)).join(',');
      const tag = m.diggable ? 'diggable' : 'solid';
      this.legend.appendChild(
        el(
          'div',
          'legend-row',
          `<span class="swatch" style="background:rgb(${rgb})"></span>` +
            `${m.displayName} <span class="tag">· ${tag}</span>`,
        ),
      );
    }

    this.help = el('div', 'hud');
    this.help.id = 'hud-help';
    this.help.appendChild(el('h2', undefined, 'Camera'));
    this.help.appendChild(
      el(
        'div',
        undefined,
        '<kbd>drag</kbd> orbit &nbsp; <kbd>wheel</kbd> zoom &nbsp; <kbd>right-drag</kbd> pan',
      ),
    );
    this.help.appendChild(
      el('div', undefined, '<span style="color:var(--hud-dim)">Driving arrives in M2.</span>'),
    );

    parent.append(this.root, this.legend, this.help);
  }

  update(stats: HudStats): void {
    this.set('fps', stats.fps.toFixed(0));
    this.set('frame', `${stats.frameMs.toFixed(1)} ms`);
    this.set('steps', stats.steps.toLocaleString());
    this.set('time', `${stats.simTime.toFixed(1)} s`);
    this.set('cells', stats.cells.toLocaleString());
    this.set('volume', `${stats.volume.toFixed(1)} m³`);
    this.set('draws', String(stats.drawCalls));
    this.set('tris', stats.triangles.toLocaleString());
  }

  private set(key: string, value: string): void {
    const node = this.values.get(key);
    if (node) node.textContent = value;
  }
}
