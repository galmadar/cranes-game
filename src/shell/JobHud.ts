/**
 * Objective banner.
 *
 * Deliberately the most prominent thing on screen — an objective buried in a
 * diagnostics list is an objective nobody reads.
 *
 * Two bars, not one, and the reason matters. **Accuracy alone is a dishonest
 * progress signal**: it counts cells inside tolerance, so it hardly moves
 * while the player shifts tonnes of soil and then jumps right at the end.
 * Watching it read 12% after two minutes of hard work makes a solvable job
 * feel impossible. So "Earth moved" is the reassurance — it climbs from the
 * first push — and "On grade" is the gate, with a marker showing the bar you
 * actually have to clear.
 */

import type { JobRunner } from '../sim/job/JobRunner';

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

interface Meter {
  row: HTMLElement;
  value: HTMLElement;
  bar: HTMLElement;
}

function meter(label: string, className: string): Meter {
  const row = el('div', 'job-meter');
  row.appendChild(el('span', 'job-meter-label', label));

  const track = el('div', 'job-track');
  const bar = el('div', `job-bar ${className}`);
  track.appendChild(bar);
  row.appendChild(track);

  const value = el('span', 'job-meter-value', '0%');
  row.appendChild(value);

  return { row, value, bar };
}

export class JobHud {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly moved: Meter;
  private readonly graded: Meter;
  private readonly threshold: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly result: HTMLElement;

  private wasComplete = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud job-hud');
    this.root.id = 'hud-job';

    this.title = el('h2', 'job-title', 'Contract');
    this.brief = el('p', 'job-brief', '');

    this.moved = meter('Earth moved', 'is-moved');
    this.graded = meter('On grade', 'is-graded');

    // Marker on the accuracy bar showing what actually counts as finished.
    this.threshold = el('div', 'job-threshold');
    this.graded.bar.parentElement?.appendChild(this.threshold);

    this.stats = el('div', 'job-stats');
    this.result = el('div', 'job-result', '');
    this.result.hidden = true;

    this.root.append(this.title, this.brief, this.moved.row, this.graded.row, this.stats, this.result);
    parent.appendChild(this.root);
  }

  update(job: JobRunner | null): void {
    if (!job) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;

    const p = job.current;
    const movedPct = job.earthMovedFraction * 100;
    const gradedPct = p.accuracy * 100;
    const needPct = job.site.requiredAccuracy * 100;

    this.title.textContent = job.site.title;
    this.brief.textContent = job.site.brief;

    this.moved.bar.style.width = `${movedPct}%`;
    this.moved.value.textContent = `${movedPct.toFixed(0)}%`;

    this.graded.bar.style.width = `${gradedPct}%`;
    this.graded.value.textContent = `${gradedPct.toFixed(0)}%`;
    this.graded.bar.classList.toggle('is-done', p.accuracy >= job.site.requiredAccuracy);
    this.threshold.style.left = `${needPct}%`;
    this.threshold.title = `${needPct.toFixed(0)}% needed`;

    const over = job.elapsed > job.site.parSeconds;
    this.stats.innerHTML =
      `<span><b>${p.cutRemaining.toFixed(1)}</b> m³ to cut</span>` +
      `<span><b>${p.fillRemaining.toFixed(1)}</b> m³ to fill</span>` +
      `<span class="${over ? 'job-over' : ''}">${clock(job.elapsed)}` +
      `<span class="tag"> / ${clock(job.site.parSeconds)}</span></span>`;

    const result = job.result;
    if (result && !this.wasComplete) {
      this.wasComplete = true;
      this.root.classList.add('is-complete');
      this.result.hidden = false;
      this.result.innerHTML =
        `<strong>Job complete</strong>` +
        `<span>${(result.accuracy * 100).toFixed(0)}% on grade in ${clock(result.elapsed)}` +
        ` ${result.underPar ? '· under par' : '· over par'}</span>` +
        `<span>${result.volumeMoved.toFixed(0)} m³ moved` +
        ` · ${(result.efficiency * 100).toFixed(0)}% efficient</span>`;
    }
  }
}
