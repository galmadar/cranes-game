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
  /** Ground height minus target, at the blade. Positive = cut, negative = fill. */
  gradeAtBlade: number | null;
  carriedVolume: number | null;
  /** Radians. Negative carries, positive bites. */
  bladePitch: number | null;
  /** m³ the blade holds at the current pitch. */
  bladeCapacity: number | null;
  bladeBlocked: boolean;
  gradeHold: boolean;
  gradeHoldSaturated: boolean;
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
  ['grade', 'At blade'],
  ['pitch', 'Pitch'],
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
        '<kbd>G</kbd> <span class="tag">grade overlay</span> ' +
          '<kbd>P</kbd> <span class="tag">post FX</span> ' +
          '<kbd>Esc</kbd> <span class="tag">settings</span>',
      ),
    );
    help.appendChild(
      el(
        'div',
        undefined,
        '<span class="tag">Drop the blade below grade to dig, or press ' +
          '<kbd>H</kbd> and let it hold grade while you drive. ' +
          'Any manual blade input cancels the hold.</span>',
      ),
    );

    parent.append(stats, legend, help);
  }

  update(stats: HudStats): void {
    this.title.innerHTML = `${stats.vehicleName} &middot; M3`;
    this.set('speed', `${stats.speedKph.toFixed(1)} km/h`);
    this.set('ground', stats.groundMaterial);
    this.set('traction', `×${stats.traction.toFixed(2)}`);
    // The hold flag matters more than the number it produces: a player who
    // cannot tell auto from manual cannot tell a working servo from a stuck one.
    const hold = stats.gradeHold
      ? stats.gradeHoldSaturated
        ? '  ▸ HOLD (out of travel)'
        : '  ▸ HOLD'
      : '';
    this.set(
      'blade',
      stats.bladeHeight === null
        ? '—'
        : `${stats.bladeHeight.toFixed(2)} m${stats.bladeBlocked ? '  ⛔' : ''}${hold}`,
    );
    // Names the action rather than the number: the player should not have to
    // work out that "+0.4" means "you are standing on soil that must come off".
    if (stats.gradeAtBlade === null) {
      this.set('grade', 'off site');
    } else {
      const g = stats.gradeAtBlade;
      this.set(
        'grade',
        Math.abs(g) < 0.2
          ? 'on grade'
          : `${g > 0 ? 'cut' : 'fill'} ${Math.abs(g).toFixed(2)} m`,
      );
    }
    // Names the trade rather than the angle: "-0.14 rad" tells the player
    // nothing about whether the blade is now carrying or cutting.
    if (stats.bladePitch === null) {
      this.set('pitch', '—');
    } else {
      const deg = (stats.bladePitch * 180) / Math.PI;
      const mode =
        Math.abs(deg) < 1 ? 'neutral' : deg < 0 ? 'back · carries' : 'forward · bites';
      this.set('pitch', `${deg >= 0 ? '+' : ''}${deg.toFixed(0)}° ${mode}`);
    }
    // Shown against capacity so the effect of pitch on how much the blade can
    // hold is visible at the moment it matters — while the load is building.
    this.set(
      'carried',
      stats.carriedVolume === null
        ? '—'
        : `${stats.carriedVolume.toFixed(2)} / ${(stats.bladeCapacity ?? 0).toFixed(1)} m³`,
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
