/**
 * Diagnostic HUD + on-screen control hints (FR-4.3).
 *
 * Control hints are GENERATED from the active vehicle's keymap, never
 * hard-coded. A machine with a different keymap documents itself.
 *
 * Terrain volume is on screen on purpose: it is the invariant FR-3.5 is built
 * around, and in M3 you want to watch it hold steady while you push dirt, not
 * discover it drifting three days later.
 */

import { keyLabel } from '../input/Keyboard';
import type { KeyMap } from '../sim/input/actions';
import { MATERIAL_LIST } from '../sim/materials';

export interface HudStats {
  fps: number;
  frameMs: number;
  simTime: number;
  volume: number;
  drawCalls: number;
  triangles: number;

  vehicleName: string;
  speedKph: number;
  groundMaterial: string;
  traction: number;
  bladeHeight: number | null;
  carriedVolume: number | null;
  bladeBlocked: boolean;
  load: number;
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
  ['speed', 'Speed'],
  ['ground', 'Ground'],
  ['traction', 'Traction'],
  ['blade', 'Blade'],
  ['carried', 'Pushing'],
  ['load', 'Load'],
  ['fps', 'FPS'],
  ['frame', 'Frame'],
  ['time', 'Sim time'],
  ['volume', 'Volume'],
  ['draws', 'Draw calls'],
  ['tris', 'Triangles'],
] as const;

export class Hud {
  private readonly values = new Map<string, HTMLElement>();
  private readonly title: HTMLElement;

  constructor(
    parent: HTMLElement,
    keymap: KeyMap,
    hints: readonly { action: string; label: string }[],
  ) {
    // --- stats ---------------------------------------------------------------
    const stats = el('div', 'hud');
    stats.id = 'hud-stats';
    this.title = el('h2', undefined, 'Cranes Game &middot; M2');
    stats.appendChild(this.title);

    const dl = el('dl');
    for (const [key, label] of ROWS) {
      dl.appendChild(el('dt', undefined, label));
      const dd = el('dd', undefined, '—');
      this.values.set(key, dd);
      dl.appendChild(dd);
    }
    stats.appendChild(dl);

    // --- material legend ------------------------------------------------------
    const legend = el('div', 'hud');
    legend.id = 'hud-legend';
    legend.appendChild(el('h2', undefined, 'Materials'));
    for (const m of MATERIAL_LIST) {
      const rgb = m.color.map((c) => Math.round(c * 255)).join(',');
      const tag = m.diggable ? `diggable · ×${m.tractionMultiplier}` : 'solid';
      legend.appendChild(
        el(
          'div',
          'legend-row',
          `<span class="swatch" style="background:rgb(${rgb})"></span>` +
            `${m.displayName} <span class="tag">· ${tag}</span>`,
        ),
      );
    }

    // --- controls, generated from the keymap ---------------------------------
    const help = el('div', 'hud');
    help.id = 'hud-help';
    help.appendChild(el('h2', undefined, 'Controls'));
    for (const hint of hints) {
      const codes = keymap[hint.action] ?? [];
      const keys = codes.map((c) => `<kbd>${keyLabel(c)}</kbd>`).join(' / ');
      help.appendChild(el('div', 'legend-row', `${keys} <span class="tag">${hint.label}</span>`));
    }
    help.appendChild(
      el(
        'div',
        'legend-row',
        '<kbd>drag</kbd> <span class="tag">set angle (it stays)</span> ' +
          '<kbd>wheel</kbd> <span class="tag">zoom</span> ' +
          '<kbd>C</kbd> <span class="tag">recenter</span>',
      ),
    );
    help.appendChild(
      el(
        'div',
        'legend-row',
        '<kbd>Esc</kbd> <span class="tag">settings — tune every number live</span>',
      ),
    );
    help.appendChild(
      el(
        'div',
        undefined,
        '<span class="tag">Drop the blade below grade to dig. ' +
          'Volume is conserved — watch it hold steady.</span>',
      ),
    );

    parent.append(stats, legend, help);
  }

  update(stats: HudStats): void {
    this.title.innerHTML = `${stats.vehicleName} &middot; M3`;
    this.set('speed', `${stats.speedKph.toFixed(1)} km/h`);
    this.set('ground', stats.groundMaterial);
    this.set('traction', `×${stats.traction.toFixed(2)}`);
    this.set(
      'blade',
      stats.bladeHeight === null
        ? '—'
        : `${stats.bladeHeight.toFixed(2)} m${stats.bladeBlocked ? '  ⛔' : ''}`,
    );
    this.set(
      'carried',
      stats.carriedVolume === null ? '—' : `${stats.carriedVolume.toFixed(2)} m³`,
    );
    this.set('load', `${Math.round(stats.load * 100)}%`);
    this.set('fps', stats.fps.toFixed(0));
    this.set('frame', `${stats.frameMs.toFixed(1)} ms`);
    this.set('time', `${stats.simTime.toFixed(1)} s`);
    this.set('volume', `${stats.volume.toFixed(1)} m³`);
    this.set('draws', String(stats.drawCalls));
    this.set('tris', stats.triangles.toLocaleString());
  }

  private set(key: string, value: string): void {
    const node = this.values.get(key);
    if (node) node.textContent = value;
  }
}
