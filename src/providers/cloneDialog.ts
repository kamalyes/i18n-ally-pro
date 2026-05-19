import { getLocaleFlagCssClass } from '../i18n'
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '../core/constants'

export interface CloneLocaleItem {
  locale: string
  name: string
  flagCss: string
  exists: boolean
}

export function buildCloneLocaleData(existingLocales: string[]): CloneLocaleItem[] {
  return SUPPORTED_LOCALES.map(l => ({
    locale: l,
    name: LOCALE_NAMES[l] || l,
    flagCss: getLocaleFlagCssClass(l),
    exists: existingLocales.includes(l),
  }))
}

export function getCloneDialogCss(): string {
  return `
    .clone-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100; justify-content: center; align-items: center; }
    .clone-overlay.show { display: flex; }
    .clone-dialog { background: var(--bg-card); border: 1px solid var(--color-success); border-radius: var(--radius-md); padding: var(--space-2xl); min-width: 480px; max-width: 600px; }
    .clone-dialog h3 { color: var(--color-success); margin-bottom: var(--space-lg); font-size: 15px; font-weight: 600; }
    .clone-dialog .clone-label { color: var(--text-secondary); font-size: 12px; display: block; margin-bottom: var(--space-xs); }
    .clone-dialog select { width: 100%; padding: var(--space-sm) var(--space-md); background: var(--bg-elevated); border: 1px solid var(--border-focus); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; margin-bottom: var(--space-lg); outline: none; }
    .clone-dialog select:focus { border-color: var(--color-success); }
    .clone-target-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-xs); margin-bottom: var(--space-lg); max-height: 240px; overflow-y: auto; }
    .clone-target-item { display: flex; align-items: center; gap: 6px; padding: var(--space-sm) var(--space-xs); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; transition: all 0.15s; }
    .clone-target-item:hover { border-color: var(--color-success); background: var(--bg-hover); }
    .clone-target-item.selected { border-color: var(--color-success); background: rgba(76,175,80,0.12); }
    .clone-target-item.exists { opacity: 0.5; }
    .clone-target-item .flag-icon-wrap { width: 20px; height: 14px; border-radius: 1px; overflow: hidden; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.08); }
    .clone-target-item .flag-icon-wrap .fi { width: 20px; height: 14px; display: block; background-size: contain; background-position: center; background-repeat: no-repeat; }
    .clone-target-item .locale-code { color: var(--text-primary); }
    .clone-target-item .locale-label { color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .clone-target-item .exists-badge { color: var(--color-warning); font-size: 9px; margin-left: auto; }
    .clone-dialog .clone-checkbox { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-lg); color: var(--text-secondary); font-size: 12px; }
    .clone-dialog .clone-checkbox input { accent-color: var(--color-success); }
    .clone-dialog .clone-actions { display: flex; gap: var(--space-sm); justify-content: flex-end; }
    .clone-dialog .btn-cancel { padding: 5px 14px; background: var(--bg-elevated); border: 1px solid var(--border-focus); border-radius: var(--radius-sm); color: var(--text-primary); cursor: pointer; font-size: 12px; }
    .clone-dialog .btn-cancel:hover { background: var(--bg-hover); }
    .clone-dialog .btn-confirm { padding: 5px 14px; background: rgba(76,175,80,0.15); border: 1px solid var(--color-success); border-radius: var(--radius-sm); color: var(--color-success); cursor: pointer; font-size: 12px; }
    .clone-dialog .btn-confirm:hover { background: rgba(76,175,80,0.25); }
  `
}

export function getCloneDialogHtml(): string {
  return `
    <div class="clone-overlay" id="cloneOverlay">
      <div class="clone-dialog">
        <h3>Clone Locale</h3>
        <label class="clone-label">Source locale:</label>
        <select id="cloneSource"></select>
        <label class="clone-label">Target locales (click to select multiple):</label>
        <div class="clone-target-grid" id="cloneTargetGrid"></div>
        <div class="clone-checkbox">
          <input type="checkbox" id="cloneOverwrite" />
          <label for="cloneOverwrite" style="margin:0;display:inline">Overwrite existing translations</label>
        </div>
        <div class="clone-actions">
          <button class="btn-cancel" onclick="hideCloneDialog()">Cancel</button>
          <button class="btn-confirm" onclick="doClone()">Clone</button>
        </div>
      </div>
    </div>
  `
}

export function getCloneDialogJs(cloneLocaleData: CloneLocaleItem[], existingLocales: string[], sourceLocale: string): string {
  return `
    const CLONE_LOCALE_DATA = ${JSON.stringify(cloneLocaleData)};
    const CLONE_EXISTING_LOCALES = ${JSON.stringify(existingLocales)};
    const CLONE_SOURCE_LOCALE = ${JSON.stringify(sourceLocale)};
    let cloneSourceLocale = '';
    let cloneSelectedTargets = new Set();

    function showCloneDialog(initSourceLocale) {
      cloneSourceLocale = initSourceLocale || CLONE_SOURCE_LOCALE;
      cloneSelectedTargets = new Set();
      const sourceSelect = document.getElementById('cloneSource');
      sourceSelect.innerHTML = CLONE_EXISTING_LOCALES.map(l =>
        '<option value="' + l + '"' + (l === cloneSourceLocale ? ' selected' : '') + '>' + l + (l === CLONE_SOURCE_LOCALE ? ' (source)' : '') + '</option>'
      ).join('');
      sourceSelect.onchange = function() { cloneSourceLocale = this.value; renderCloneTargets(); };
      renderCloneTargets();
      document.getElementById('cloneOverwrite').checked = false;
      document.getElementById('cloneOverlay').classList.add('show');
    }

    function renderCloneTargets() {
      const grid = document.getElementById('cloneTargetGrid');
      grid.innerHTML = CLONE_LOCALE_DATA.filter(l => l.locale !== cloneSourceLocale).map(l => {
        const sel = cloneSelectedTargets.has(l.locale) ? ' selected' : '';
        const ex = l.exists ? ' exists' : '';
        return '<div class="clone-target-item' + sel + ex + '" data-locale="' + l.locale + '" onclick="toggleCloneTarget(this, \\'' + l.locale + '\\')">' +
          '<span class="flag-icon-wrap"><span class="fi ' + l.flagCss + '"></span></span>' +
          '<span class="locale-code">' + l.locale + '</span>' +
          '<span class="locale-label">' + l.name + '</span>' +
          (l.exists ? '<span class="exists-badge">⚡</span>' : '') +
          '</div>';
      }).join('');
    }

    function toggleCloneTarget(el, locale) {
      if (cloneSelectedTargets.has(locale)) {
        cloneSelectedTargets.delete(locale);
        el.classList.remove('selected');
      } else {
        cloneSelectedTargets.add(locale);
        el.classList.add('selected');
      }
    }

    function hideCloneDialog() {
      document.getElementById('cloneOverlay').classList.remove('show');
      cloneSourceLocale = '';
      cloneSelectedTargets = new Set();
    }

    function doClone() {
      const targets = Array.from(cloneSelectedTargets);
      if (targets.length === 0) {
        if (typeof showToast === 'function') { showToast('Please select at least one target locale', 'warn'); }
        return;
      }
      const overwrite = document.getElementById('cloneOverwrite').checked;
      const src = cloneSourceLocale;
      hideCloneDialog();
      for (const target of targets) {
        if (typeof showToast === 'function') { showToast('Cloning ' + src + ' → ' + target + '...'); }
        vscode.postMessage({ type: 'cloneLocale', sourceLocale: src, targetLocale: target, overwrite });
      }
    }
  `
}
