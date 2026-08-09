/**
 * Objective banner.
 *
 * Deliberately the most prominent thing on screen. The whole point of M6 is
 * that the player has something to aim for, and an objective buried in a
 * diagnostics list is an objective nobody reads.
 *
 * Shows accuracy as the headline, because that is the number the job is scored
 * on, and cut/fill remaining underneath because that is the number that tells
 * you what to physically do next.
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

export class JobHud {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly cut: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly time: HTMLElement;
  private readonly result: HTMLElement;

  private wasComplete = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud job-hud');
    this.root.id = 'hud-job';

    this.title = el('h2', 'job-title', 'Contract');
    this.brief = el('p', 'job-brief', '');

    const meter = el('div', 'job-meter');
    this.percent = el('span', 'job-percent', '0%');
    const track = el('div', 'job-track');
    this.bar = el('div', 'job-bar');
    track.appendChild(this.bar);
    meter.append(this.percent, track);

    const stats = el('div', 'job-stats');
    this.cut = el('span', undefined, '');
    this.fill = el('span', undefined, '');
    this.time = el('span', undefined, '');
    stats.append(this.cut, this.fill, this.time);

    this.result = el('div', 'job-result', '');
    this.result.hidden = true;

    this.root.append(this.title, this.brief, meter, stats, this.result);
    parent.appendChild(this.root);
  }

  update(job: JobRunner | null): void {
    if (!job) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;

    const p = job.current;
    const pct = p.accuracy * 100;

    this.title.textContent = job.site.title;
    this.brief.textContent = job.site.brief;
    this.percent.textContent = `${pct.toFixed(0)}%`;
    this.bar.style.width = `${Math.min(100, pct)}%`;

    // Required accuracy as a threshold marker, so "how much more?" is visible.
    this.bar.classList.toggle('is-done', p.accuracy >= job.site.requiredAccuracy);

    this.cut.innerHTML = `<b>${p.cutRemaining.toFixed(1)}</b> m³ to cut`;
    this.fill.innerHTML = `<b>${p.fillRemaining.toFixed(1)}</b> m³ to fill`;

    const over = job.elapsed > job.site.parSeconds;
    this.time.innerHTML =
      `<span class="${over ? 'job-over' : ''}">${clock(job.elapsed)}</span>` +
      ` <span class="tag">/ ${clock(job.site.parSeconds)} par</span>`;

    const result = job.result;
    if (result && !this.wasComplete) {
      this.wasComplete = true;
      this.root.classList.add('is-complete');
      this.result.hidden = false;
      this.result.innerHTML =
        `<strong>Job complete</strong>` +
        `<span>${(result.accuracy * 100).toFixed(0)}% on grade</span>` +
        `<span>${clock(result.elapsed)} ${result.underPar ? '· under par' : '· over par'}</span>` +
        `<span>${result.volumeMoved.toFixed(0)} m³ moved ` +
        `· ${(result.efficiency * 100).toFixed(0)}% efficient</span>`;
    }
  }
}
