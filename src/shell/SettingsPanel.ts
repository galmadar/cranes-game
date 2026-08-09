/**
 * Live tuning panel (Esc).
 *
 * A drawer rather than a modal on purpose: you can drive with one hand and
 * drag a slider with the other, which is the only way to judge whether a
 * number is right. Nothing here pauses the simulation.
 *
 * Values persist to localStorage, so a tuning session survives a reload — and
 * `Reset` puts back the defaults that ship in the source, not whatever was
 * last saved.
 */

import type { SettingDef, SettingGroup } from './settingsSchema';

const STORAGE_KEY = 'cranes-tuning-v1';

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

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly groups: SettingGroup[];
  private readonly rows = new Map<string, { range: HTMLInputElement; number: HTMLInputElement }>();
  private open = false;

  /** Notified when the drawer opens or closes, so the HUD can get out of the way. */
  onVisibilityChange: ((open: boolean) => void) | null = null;

  /** Notified after any value changes — the grade overlay needs a repaint. */
  onChange: (() => void) | null = null;

  constructor(parent: HTMLElement, groups: SettingGroup[]) {
    this.groups = groups;

    this.root = el('aside', 'settings');
    this.root.setAttribute('aria-hidden', 'true');

    const header = el('header', 'settings-header');
    header.appendChild(el('h1', undefined, 'Settings'));
    const close = el('button', 'settings-close', '&times;');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.hide());
    header.appendChild(close);
    this.root.appendChild(header);

    const body = el('div', 'settings-body');
    for (const group of groups) {
      body.appendChild(el('h2', undefined, group.title));
      for (const setting of group.settings) body.appendChild(this.buildRow(setting));
    }
    this.root.appendChild(body);

    const footer = el('footer', 'settings-footer');
    const reset = el('button', 'settings-reset', 'Reset to defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => this.resetAll());
    footer.appendChild(reset);
    footer.appendChild(
      el('span', 'settings-note', 'Changes apply instantly and are saved locally.'),
    );
    this.root.appendChild(footer);

    parent.appendChild(this.root);
    this.load();
  }

  private buildRow(setting: SettingDef): HTMLElement {
    const row = el('div', 'settings-row');

    const label = el('label', 'settings-label');
    label.textContent = setting.label;
    row.appendChild(label);

    const controls = el('div', 'settings-controls');

    const range = el('input') as HTMLInputElement;
    range.type = 'range';
    range.min = String(setting.min);
    range.max = String(setting.max);
    range.step = String(setting.step);
    range.value = String(setting.get());

    const number = el('input') as HTMLInputElement;
    number.type = 'number';
    number.className = 'settings-number';
    number.min = String(setting.min);
    number.max = String(setting.max);
    number.step = String(setting.step);
    number.value = String(round(setting.get(), setting.step));

    const apply = (raw: number, syncRange: boolean, syncNumber: boolean): void => {
      if (!Number.isFinite(raw)) return;
      const clamped = Math.min(setting.max, Math.max(setting.min, raw));
      setting.set(clamped);
      if (syncRange) range.value = String(clamped);
      if (syncNumber) number.value = String(round(clamped, setting.step));
      this.save();
      this.onChange?.();
    };

    range.addEventListener('input', () => apply(Number(range.value), false, true));
    number.addEventListener('change', () => apply(Number(number.value), true, true));

    controls.append(range, number);
    if (setting.unit) controls.appendChild(el('span', 'settings-unit', setting.unit));
    row.appendChild(controls);

    if (setting.hint) row.appendChild(el('p', 'settings-hint', setting.hint));

    this.rows.set(setting.id, { range, number });
    return row;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.onVisibilityChange?.(true);
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    // Leaving focus in a field would keep swallowing keystrokes meant for driving.
    (document.activeElement as HTMLElement | null)?.blur();
    this.onVisibilityChange?.(false);
  }

  get isOpen(): boolean {
    return this.open;
  }

  private eachSetting(fn: (s: SettingDef) => void): void {
    for (const group of this.groups) for (const setting of group.settings) fn(setting);
  }

  private resetAll(): void {
    this.eachSetting((s) => s.reset());
    this.syncInputs();
    this.onChange?.();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — the reset still applied in memory */
    }
  }

  private syncInputs(): void {
    this.eachSetting((s) => {
      const row = this.rows.get(s.id);
      if (!row) return;
      row.range.value = String(s.get());
      row.number.value = String(round(s.get(), s.step));
    });
  }

  private save(): void {
    const data: Record<string, number> = {};
    this.eachSetting((s) => {
      data[s.id] = s.get();
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private browsing or quota — tuning just won't persist */
    }
  }

  private load(): void {
    let data: Record<string, unknown>;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // corrupt or unavailable — fall back to shipped defaults
    }

    this.eachSetting((s) => {
      const value = data[s.id];
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      s.set(Math.min(s.max, Math.max(s.min, value)));
    });
    this.syncInputs();
  }
}

function round(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(value.toFixed(decimals));
}
