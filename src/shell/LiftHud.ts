/**
 * Lift objective banner.
 *
 * The grading HUD's problem was a progress number that barely moves while you
 * work. A lift job has the opposite problem: progress is four discrete steps,
 * so a bar alone tells you almost nothing — 25%, then nothing for two minutes.
 *
 * So the pads are listed individually, and an open pad shows how far off the
 * nearest matching load is. That turns "not done" into "eleven metres out and
 * forty degrees round", which is a thing you can go and fix.
 */

import type { LiftRunner } from '../sim/payload/LiftJob';

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

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const degrees = (radians: number): number => (radians * 180) / Math.PI;

export class LiftHud {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly list: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly result: HTMLElement;

  private rows: HTMLElement[] = [];
  private wasComplete = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud job-hud');
    this.root.id = 'hud-lift';
    this.root.hidden = true;

    this.title = el('h2', 'job-title', 'Lift');
    this.brief = el('p', 'job-brief', '');
    this.list = el('div', 'lift-list');
    this.stats = el('div', 'job-stats');
    this.result = el('div', 'job-result', '');
    this.result.hidden = true;

    this.root.append(this.title, this.brief, this.list, this.stats, this.result);
    parent.appendChild(this.root);
  }

  update(lift: LiftRunner | null): void {
    if (!lift) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;

    this.title.textContent = lift.title;
    this.brief.textContent = lift.brief;

    const progress = lift.current;

    if (this.rows.length !== progress.statuses.length) {
      this.list.replaceChildren();
      this.rows = progress.statuses.map(() => {
        const row = el('div', 'lift-row');
        this.list.appendChild(row);
        return row;
      });
    }

    progress.statuses.forEach((status, i) => {
      const row = this.rows[i];
      if (!row) return;
      row.classList.toggle('is-placed', status.placed);

      let detail = 'no load';
      if (status.placed) {
        detail = 'set';
      } else if (status.distance !== null) {
        const off = `${status.distance.toFixed(1)} m`;
        // Only mention bearing once position is close enough for it to be the
        // thing standing between the player and a finished pad.
        const turned =
          status.yawError !== null && status.distance <= status.target.radius * 2.5
            ? ` · ${degrees(status.yawError).toFixed(0)}° round`
            : '';
        detail = `${off}${turned}`;
      }

      row.innerHTML =
        `<span class="lift-mark">${status.placed ? '✓' : '○'}</span>` +
        `<span class="lift-label">${status.target.label}</span>` +
        `<span class="lift-detail">${detail}</span>`;
    });

    const over = lift.elapsed > lift.parSeconds;
    this.stats.innerHTML =
      `<span><b>${progress.placed}</b> / ${progress.total} set</span>` +
      `<span>${lift.dropped} dropped</span>` +
      `<span class="${over ? 'job-over' : ''}">${clock(lift.elapsed)}` +
      `<span class="tag"> / ${clock(lift.parSeconds)}</span></span>`;

    const result = lift.result;
    if (result && !this.wasComplete) {
      this.wasComplete = true;
      this.root.classList.add('is-complete');
      this.result.hidden = false;
      this.result.innerHTML =
        `<strong>All loads set</strong>` +
        `<span>${clock(result.elapsed)} ${result.underPar ? '· under par' : '· over par'}</span>` +
        `<span>${result.dropped === 0 ? 'nothing dropped' : `${result.dropped} dropped`}</span>`;
    }
  }
}
