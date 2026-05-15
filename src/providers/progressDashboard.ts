import { window, ViewColumn, commands, env } from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, getLocaleName, getLocaleFlagCssClass, t } from '../i18n'
import { buildCloneLocaleData, getCloneDialogCss, getCloneDialogHtml, getCloneDialogJs } from './cloneDialog'
import type { TranslatorService } from '../services/translator'

export class ProgressDashboard {
  private store: TranslationStore
  private translatorService: TranslatorService | null
  private panel: import('vscode').WebviewPanel | null = null
  private onRefresh: (() => void) | null = null

  constructor(store: TranslationStore, translatorService?: TranslatorService, onRefresh?: () => void) {
    this.store = store
    this.translatorService = translatorService || null
    this.onRefresh = onRefresh || null
  }

  show() {
    if (this.panel) {
      this.panel.reveal()
      this.update()
      return
    }

    this.panel = window.createWebviewPanel(
      'i18nAllyPro.dashboard',
      '📊 i18n Progress Dashboard',
      ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.onDidDispose(() => { this.panel = null })
    this.panel.webview.onDidReceiveMessage(async (msg: { type: string; category?: string; key?: string; sourceLocale?: string; targetLocale?: string; overwrite?: boolean; target?: 'codex' | 'copilot' }) => {
      if (msg.type === 'refresh') {
        try {
          await this.store.refresh()
          this.update()
          if (this.onRefresh) this.onRefresh()
          window.showInformationMessage(t('dashboard.refreshed'))
        } catch (err: any) {
          window.showErrorMessage(t('dashboard.refresh_failed', err.message))
        }
      }
      if (msg.type === 'formatAll') {
        try {
          const result = await this.store.formatAllFiles('nested')
          this.update()
          if (this.onRefresh) this.onRefresh()
          if (result.errors.length > 0) {
            window.showWarningMessage(`Formatted ${result.formatted} file(s), ${result.errors.length} failed`)
          } else {
            window.showInformationMessage(`Formatted ${result.formatted} file(s), ${result.unchanged} unchanged`)
          }
          this.panel?.webview.postMessage({
            type: 'formatDone',
            formatted: result.formatted,
            unchanged: result.unchanged,
            errors: result.errors.length,
          })
        } catch (err: any) {
          window.showErrorMessage(`Format failed - ${err.message}`)
          this.panel?.webview.postMessage({ type: 'formatDone', error: true })
        }
      }
      if (msg.type === 'autoTranslate') {
        try {
          await commands.executeCommand('i18nAllyPro.autoTranslate')
          await this.store.refresh()
          this.update()
          if (this.onRefresh) this.onRefresh()
          this.panel?.webview.postMessage({ type: 'translateDone' })
        } catch (err: any) {
          window.showErrorMessage(t('dashboard.auto_translate_failed', err.message))
          this.panel?.webview.postMessage({ type: 'translateDone', error: true })
        }
      }
      if (msg.type === 'openAIPrompt') {
        await this.openAIPrompt(msg.target || 'codex')
      }
      if (msg.type === 'cloneLocale' && msg.sourceLocale && msg.targetLocale) {
        try {
          const result = await this.store.cloneLocale(msg.sourceLocale, msg.targetLocale, msg.overwrite || false)
          await this.store.refresh()
          this.update()
          if (this.onRefresh) this.onRefresh()
          window.showInformationMessage(
            t('dashboard.clone_result', msg.sourceLocale, msg.targetLocale, String(result.cloned), String(result.skipped))
          )
          this.panel?.webview.postMessage({ type: 'cloneDone', cloned: result.cloned, skipped: result.skipped })
          if (this.translatorService && msg.sourceLocale !== msg.targetLocale) {
            const translateResult = await this.translatorService.translateLocale(msg.sourceLocale, msg.targetLocale, msg.overwrite || false)
            await this.store.refresh()
            this.update()
            if (this.onRefresh) this.onRefresh()
            window.showInformationMessage(
              `🌐 Translated ${msg.sourceLocale} → ${msg.targetLocale}: ${translateResult.translated} keys translated`
            )
            this.panel?.webview.postMessage({ type: 'translateDone' })
          }
        } catch (err: any) {
          window.showErrorMessage(t('dashboard.clone_failed', err.message))
          this.panel?.webview.postMessage({ type: 'cloneDone', error: true })
        }
      }
      if (msg.type === 'openCategory' && msg.category) {
        const keys = this.store.getAllKeys().filter(k => {
          const parts = k.split('.')
          const cat = parts.length >= 2 ? parts.slice(0, 2).join('.') : parts[0]
          return cat === msg.category
        })
        if (keys.length > 0) {
          const key = keys[0]
          await commands.executeCommand('i18nAllyPro.openKeyAndFile', key)
        }
      }
      if (msg.type === 'openKey' && msg.key) {
        await commands.executeCommand('i18nAllyPro.openKeyAndFile', msg.key)
      }
    })

    this.update()
  }

  refresh() {
    this.update()
  }

  private async openAIPrompt(target: 'codex' | 'copilot') {
    const prompt = this.buildDashboardPrompt(target)
    await env.clipboard.writeText(prompt)

    const commandsToTry = target === 'codex'
      ? ['chatgpt.newCodexPanel', 'workbench.action.chat.open']
      : ['workbench.action.chat.open', 'chatgpt.newCodexPanel']

    for (const command of commandsToTry) {
      if (await this.tryOpenAICommand(command, prompt)) {
        window.showInformationMessage(`i18n AI prompt copied and opened ${target === 'codex' ? 'Codex' : 'Copilot/Chat'}`)
        return
      }
    }

    window.showInformationMessage('i18n AI prompt copied to clipboard')
  }

  private async tryOpenAICommand(command: string, prompt: string): Promise<boolean> {
    try {
      await commands.executeCommand(command, prompt)
      return true
    } catch {
      try {
        await commands.executeCommand(command, { query: prompt })
        return true
      } catch {
        try {
          await commands.executeCommand(command)
          return true
        } catch {
          return false
        }
      }
    }
  }

  private buildDashboardPrompt(target: 'codex' | 'copilot'): string {
    const config = this.store.projectConfig
    const locales = this.store.locales
    const allKeys = this.store.getAllKeys().sort()
    const diagnostics = this.store.getDiagnostics().filter(d => d.type === 'missing' || d.type === 'empty')
    const missingRows = diagnostics.slice(0, 200).map(d => {
      const sourceValue = this.store.getTranslation(config.sourceLanguage, d.key) || ''
      return `- ${d.type}: ${d.key} -> ${d.locale || '(unknown locale)'} | source(${config.sourceLanguage}): ${sourceValue || '(empty)'}`
    })

    const localeSummaries = locales.map(locale => {
      const filled = allKeys.filter(key => {
        const value = this.store.getTranslation(locale, key)
        return value !== undefined && value !== ''
      }).length
      const pct = allKeys.length > 0 ? Math.round(filled / allKeys.length * 100) : 100
      return `- ${locale}: ${filled}/${allKeys.length} (${pct}%)`
    })

    const fileSummaries = this.store.getTranslationFiles()
      .map(file => `- ${file.locale}: ${file.filepath} (${file.parser})`)

    const extraCount = diagnostics.length > missingRows.length
      ? `\n\nThere are ${diagnostics.length - missingRows.length} additional missing/empty entries not listed here. Inspect the locale files before editing.`
      : ''

    const assistantName = target === 'codex' ? 'Codex' : 'Copilot'

    return `You are ${assistantName} working inside this VS Code workspace. Please complete the i18n translations shown by the i18n Ally Pro dashboard.

Project root:
${config.rootPath}

Source locale:
${config.sourceLanguage}

Locales:
${locales.join(', ')}

Locale files:
${fileSummaries.join('\n') || '- No locale files detected'}

Dashboard coverage:
${localeSummaries.join('\n') || '- No locale data'}

Missing or empty translations:
${missingRows.join('\n') || '- None'}
${extraCount}

Instructions:
- Edit the existing locale files directly.
- Preserve the current key naming, nesting, JSON/YAML formatting, placeholders, and interpolation tokens.
- Use the source locale text as the translation source.
- Keep existing non-empty translations unless they are clearly broken.
- Search the codebase and nearby locale files for existing wording before inventing new translations.
- After editing, run the smallest relevant validation command for this extension, such as npm run lint.
- Report the files changed and any entries that could not be translated safely.`
  }

  private update() {
    if (!this.panel) return

    const locales = this.store.locales
    const allKeys = this.store.getAllKeys()
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage

    const cloneLocaleData = buildCloneLocaleData(locales)
    const diagnostics = this.store.getDiagnostics()

    const totalCells = allKeys.length * locales.length
    const missingCells = diagnostics.filter(d => d.type === 'missing').length
    const emptyCells = diagnostics.filter(d => d.type === 'empty').length
    const filledCells = totalCells - missingCells - emptyCells
    const overallPct = totalCells > 0 ? Math.round(filledCells / totalCells * 100) : 100

    const localeData = locales.map(locale => {
      const keys = this.store.getKeysForLocale(locale)
      const filled = keys.filter(k => {
        const v = this.store.getTranslation(locale, k)
        return v !== undefined && v !== ''
      }).length
      const missing = allKeys.length - filled
      return {
        locale,
        total: allKeys.length,
        filled,
        missing,
        pct: allKeys.length > 0 ? Math.round(filled / allKeys.length * 100) : 100,
      }
    })

    const donutSvg = this.generateDonutSvg(filledCells, emptyCells, missingCells, overallPct)

    const localeBars = localeData.map(d => {
      const barColor = d.pct === 100 ? '#4CAF50' : d.pct > 70 ? '#FFC107' : d.pct > 40 ? '#FF9800' : '#f48771'
      const name = getLocaleName(d.locale)
      const flagCss = getLocaleFlagCssClass(d.locale)
      return `
        <div class="locale-row">
          <div class="locale-label">
            <span class="flag-icon-wrap"><span class="fi ${flagCss}"></span></span>
            <span class="locale-name">${name}</span>
            <span class="locale-code">${d.locale}</span>
          </div>
          <div class="locale-bar-wrap">
            <div class="locale-bar" style="width:${d.pct}%;background:${barColor}"></div>
          </div>
          <div class="locale-stats">
            <span class="pct" style="color:${barColor}">${d.pct}%</span>
            <span class="detail">${d.filled}/${d.total}</span>
          </div>
          <button class="btn-clone" onclick="showCloneDialog('${d.locale}')" title="Clone this locale to another">📋</button>
        </div>`
    }).join('')

    const categoryData = this.analyzeByCategory(allKeys)

    const categoryBars = categoryData.map(cat => {
      const barColor = cat.pct === 100 ? '#4CAF50' : cat.pct > 70 ? '#FFC107' : '#f48771'
      return `
        <div class="category-row clickable" onclick="openCategory('${this.escJs(cat.category)}')" title="${this.escAttr(cat.category)}">
          <div class="category-label" title="${this.escAttr(cat.category)}">${this.escHtml(cat.category)}</div>
          <div class="category-bar-wrap">
            <div class="category-bar" style="width:${cat.pct}%;background:${barColor}"></div>
          </div>
          <div class="category-stats">
            <span class="pct" style="color:${barColor}">${cat.pct}%</span>
            <span class="detail">${cat.filled}/${cat.total}</span>
          </div>
        </div>`
    }).join('')

    const missingKeys = diagnostics.filter(d => d.type === 'missing' || d.type === 'empty')
    const topMissing = missingKeys.slice(0, 20).map(d => {
      const flagCss = d.locale ? getLocaleFlagCssClass(d.locale) : ''
      return `<div class="missing-item clickable" onclick="openKey('${this.escJs(d.key)}')">
        <span class="missing-locale">${flagCss ? `<span class="flag-icon-sm"><span class="fi ${flagCss}"></span></span>` : ''} ${d.locale || ''}</span>
        <span class="missing-key">${this.escHtml(d.key)}</span>
      </div>`
    }).join('')

    this.panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>i18n Progress Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/css/flag-icons.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
    .dashboard { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .header h1 { color: #4CAF50; font-size: 22px; }
    .header .subtitle { color: #888; font-size: 13px; }
    .header-actions { display: flex; gap: 8px; }
    .btn-refresh { padding: 6px 14px; background: #2d2d2d; border: 1px solid #4CAF50; border-radius: 4px;
      color: #4CAF50; cursor: pointer; font-size: 13px; transition: all 0.15s; }
    .btn-refresh:hover { background: #4CAF50; color: #fff; }
    .btn-action { padding: 6px 14px; background: #2d2d2d; border: 1px solid #2196F3; border-radius: 4px;
      color: #2196F3; cursor: pointer; font-size: 13px; transition: all 0.15s; }
    .btn-action:hover { background: #2196F3; color: #fff; }
    .grid { display: grid; grid-template-columns: 300px 1fr; gap: 20px; }
    .card { background: #252526; border: 1px solid #333; border-radius: 8px; padding: 20px; }
    .card-title { font-size: 14px; color: #888; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; }
    .donut-wrap { display: flex; flex-direction: column; align-items: center; }
    .donut-svg { width: 200px; height: 200px; }
    .legend { display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; justify-content: center; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    .locale-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .locale-label { width: 140px; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .flag-icon-wrap { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 16px; border-radius: 2px; overflow: hidden; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1); }
    .flag-icon-wrap .fi { width: 24px; height: 16px; display: block; background-size: contain; background-position: center; background-repeat: no-repeat; }
    .flag-icon-sm { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 12px; border-radius: 1px; overflow: hidden; vertical-align: middle; border: 1px solid rgba(255,255,255,0.1); }
    .flag-icon-sm .fi { width: 18px; height: 12px; display: block; background-size: contain; background-position: center; background-repeat: no-repeat; }
    .locale-name { font-size: 12px; color: #ccc; }
    .locale-code { font-size: 10px; color: #666; }
    .locale-bar-wrap { flex: 1; height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
    .locale-bar { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
    .locale-stats { width: 80px; text-align: right; flex-shrink: 0; }
    .locale-stats .pct { font-size: 14px; font-weight: bold; }
    .locale-stats .detail { font-size: 11px; color: #666; margin-left: 4px; }
    .btn-clone { padding: 2px 6px; background: transparent; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; opacity: 0.5; transition: all 0.15s; flex-shrink: 0; }
    .btn-clone:hover { opacity: 1; border-color: #2196F3; background: rgba(33,150,243,0.1); }
    ${getCloneDialogCss()}
    .category-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; padding: 4px 6px; border-radius: 4px; }
    .category-row.clickable { cursor: pointer; transition: background 0.15s; }
    .category-row.clickable:hover { background: #2d2d2d; }
    .category-label { width: 140px; font-size: 12px; color: #9CDCFE; font-family: monospace; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .category-bar-wrap { flex: 1; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
    .category-bar { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
    .category-stats { width: 80px; text-align: right; flex-shrink: 0; }
    .category-stats .pct { font-size: 13px; font-weight: bold; }
    .category-stats .detail { font-size: 11px; color: #666; margin-left: 4px; }
    .missing-item { display: flex; gap: 8px; padding: 4px 6px; font-size: 12px; border-bottom: 1px solid #2a2a2a; }
    .missing-item.clickable { cursor: pointer; transition: background 0.15s; }
    .missing-item.clickable:hover { background: #2d2d2d; }
    .missing-locale { color: #888; min-width: 40px; display: inline-flex; align-items: center; gap: 4px; }
    .missing-key { color: #f48771; font-family: monospace; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
    .summary-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .summary-stat { text-align: center; padding: 8px; background: #2d2d2d; border-radius: 6px; }
    .summary-stat .num { font-size: 24px; font-weight: bold; }
    .summary-stat .label { font-size: 11px; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <div>
        <h1>📊 i18n Progress Dashboard</h1>
        <div class="subtitle">${allKeys.length} keys × ${locales.length} locales = ${totalCells} translations</div>
      </div>
      <div class="header-actions">
        <button class="btn-action btn-auto-translate" onclick="autoTranslate()" title="Auto translate all missing keys">🤖 Auto Translate</button>
        <button class="btn-action btn-ai-prompt" onclick="openAIPrompt('codex')" title="Send current dashboard prompt to Codex">Codex</button>
        <button class="btn-action btn-ai-prompt" onclick="openAIPrompt('copilot')" title="Send current dashboard prompt to Copilot Chat">Copilot</button>
        <button class="btn-action btn-format" onclick="formatAll()" title="Format all locale files as nested keys">Format</button>
        <button class="btn-refresh" onclick="refresh()">🔄 Refresh</button>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Overall Progress</div>
        <div class="donut-wrap">
          <div class="donut-svg">${donutSvg}</div>
          <div class="legend">
            <div class="legend-item"><div class="legend-dot" style="background:#4CAF50"></div>Filled (${filledCells})</div>
            <div class="legend-item"><div class="legend-dot" style="background:#FFC107"></div>Empty (${emptyCells})</div>
            <div class="legend-item"><div class="legend-dot" style="background:#f48771"></div>Missing (${missingCells})</div>
          </div>
        </div>
        <div class="summary-stats" style="margin-top:20px">
          <div class="summary-stat"><div class="num" style="color:#4CAF50">${allKeys.length}</div><div class="label">Total Keys</div></div>
          <div class="summary-stat"><div class="num" style="color:#4CAF50">${locales.length}</div><div class="label">Locales</div></div>
          <div class="summary-stat"><div class="num" style="color:${overallPct === 100 ? '#4CAF50' : '#FFC107'}">${overallPct}%</div><div class="label">Complete</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Locale Coverage</div>
        ${localeBars}
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">Category Progress</div>
        ${categoryBars}
      </div>
      <div class="card">
        <div class="card-title">Top Missing Translations (${missingKeys.length > 20 ? '20 of ' + missingKeys.length : missingKeys.length})</div>
        ${topMissing || '<div style="color:#4CAF50;font-size:13px">🎉 All translations are complete!</div>'}
      </div>
    </div>
  </div>
  ${getCloneDialogHtml()}
  <script>
    const I18N = ${JSON.stringify({
      refreshing: t('dashboard.refreshed'),
      refreshFailed: t('dashboard.refresh_failed', '{0}'),
      autoTranslating: t('dashboard.auto_translate_started'),
      autoTranslateFailed: t('dashboard.auto_translate_failed', '{0}'),
      formatting: 'Formatting locale files...',
      formatComplete: 'Format complete',
      formatFailed: 'Format failed',
    })};
    const ALL_LOCALES = ${JSON.stringify(locales)};
    const SOURCE_LOCALE = ${JSON.stringify(sourceLocale)};
    const vscode = acquireVsCodeApi();

    function showToast(msg, type) {
      let toast = document.getElementById('toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 20px;border-radius:6px;font-size:13px;z-index:9999;transition:opacity 0.3s;pointer-events:none;color:#fff;';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.background = type === 'error' ? '#d32f2f' : type === 'warn' ? '#f57c00' : '#388e3c';
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    function setBtnLoading(btn, loading) {
      if (loading) {
        btn.dataset.origText = btn.textContent;
        btn.textContent = '⏳ ' + btn.dataset.origText;
        btn.disabled = true;
        btn.style.opacity = '0.6';
      } else {
        btn.textContent = btn.dataset.origText || btn.textContent;
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    }

    function refresh() {
      const btn = document.querySelector('.btn-refresh');
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'refresh' });
      setTimeout(() => { setBtnLoading(btn, false); showToast(I18N.refreshing); }, 1500);
    }
    function autoTranslate() {
      const btn = document.querySelector('.btn-auto-translate');
      if (btn && btn.disabled) return;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'autoTranslate' });
      showToast(I18N.autoTranslating);
    }
    function formatAll() {
      const btn = document.querySelector('.btn-format');
      if (btn && btn.disabled) return;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'formatAll' });
      showToast(I18N.formatting);
    }
    function openAIPrompt(target) {
      vscode.postMessage({ type: 'openAIPrompt', target });
    }
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'translateDone') {
        const btn = document.querySelector('.btn-auto-translate');
        setBtnLoading(btn, false);
        showToast(msg.error ? '❌ Translate failed' : '✅ Translate complete');
      }
      if (msg.type === 'formatDone') {
        const btn = document.querySelector('.btn-format');
        setBtnLoading(btn, false);
        const detail = msg.error
          ? I18N.formatFailed
          : I18N.formatComplete + ': ' + (msg.formatted || 0) + ' formatted, ' + (msg.unchanged || 0) + ' unchanged';
        showToast(detail, msg.error || msg.errors ? 'warn' : undefined);
      }
    });
    function openCategory(cat) { vscode.postMessage({ type: 'openCategory', category: cat }); }
    function openKey(key) { vscode.postMessage({ type: 'openKey', key: key }); }

    ${getCloneDialogJs(cloneLocaleData, locales, sourceLocale)}

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'cloneDone') {
        showToast(msg.error ? '❌ Clone failed' : '✅ Cloned ' + (msg.cloned || 0) + ' keys');
      }
    });
  </script>
</body>
</html>`
  }

  private generateDonutSvg(filled: number, empty: number, missing: number, pct: number): string {
    const total = filled + empty + missing
    if (total === 0) {
      return `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="80" fill="none" stroke="#333" stroke-width="20"/><text x="100" y="108" text-anchor="middle" fill="#4CAF50" font-size="28" font-weight="bold">100%</text></svg>`
    }

    const circumference = 2 * Math.PI * 80
    const filledLen = (filled / total) * circumference
    const emptyLen = (empty / total) * circumference
    const missingLen = (missing / total) * circumference

    const filledOffset = 0
    const emptyOffset = filledLen
    const missingOffset = filledLen + emptyLen

    return `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="80" fill="none" stroke="#333" stroke-width="20"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#4CAF50" stroke-width="20"
        stroke-dasharray="${filledLen} ${circumference - filledLen}"
        stroke-dashoffset="${-filledOffset}"
        transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#FFC107" stroke-width="20"
        stroke-dasharray="${emptyLen} ${circumference - emptyLen}"
        stroke-dashoffset="${-emptyOffset}"
        transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#f48771" stroke-width="20"
        stroke-dasharray="${missingLen} ${circumference - missingLen}"
        stroke-dashoffset="${-missingOffset}"
        transform="rotate(-90 100 100)"/>
      <text x="100" y="108" text-anchor="middle" fill="#d4d4d4" font-size="28" font-weight="bold">${pct}%</text>
    </svg>`
  }

  private analyzeByCategory(allKeys: string[]): { category: string; total: number; filled: number; pct: number }[] {
    const categories = new Map<string, { total: number; filled: number }>()

    for (const key of allKeys) {
      const parts = key.split('.')
      const category = parts.length >= 2 ? parts.slice(0, 2).join('.') : parts[0]

      if (!categories.has(category)) {
        categories.set(category, { total: 0, filled: 0 })
      }

      const cat = categories.get(category)!
      cat.total += this.store.locales.length

      for (const locale of this.store.locales) {
        const v = this.store.getTranslation(locale, key)
        if (v !== undefined && v !== '') {
          cat.filled++
        }
      }
    }

    return Array.from(categories.entries())
      .map(([category, data]) => ({
        category,
        total: data.total,
        filled: data.filled,
        pct: data.total > 0 ? Math.round(data.filled / data.total * 100) : 100,
      }))
      .sort((a, b) => a.pct - b.pct)
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private escJs(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
  }

  private escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
