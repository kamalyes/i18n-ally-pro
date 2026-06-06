import { window, ViewColumn, Uri, workspace, RelativePattern } from 'vscode'
import { TranslationStore } from '../core/store'
import { buildCloneLocaleData, getCloneDialogCss, getCloneDialogHtml, getCloneDialogJs } from './cloneDialog'
import type { TranslatorService } from '../services/translator'
import { buildWebviewCsp, getWebviewNonce } from '../utils/webview'
import { t } from '../i18n'

interface MatrixMessage {
  type: 'ready' | 'editCell' | 'translateCell' | 'translateAllMissing' | 'deleteKey' | 'export' | 'import' | 'refresh' | 'openFile' | 'cloneLocale'
  key?: string
  locale?: string
  value?: string
  keys?: string[]
  sourceLocale?: string
  targetLocale?: string
  overwrite?: boolean
}

export class TranslationMatrixPanel {
  private store: TranslationStore
  private translatorService: TranslatorService | null
  private panel: import('vscode').WebviewPanel | null = null
  private storeChangeListener: (() => void) | null = null
  private fileWatchers: import('vscode').FileSystemWatcher[] = []
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(store: TranslationStore, translatorService?: TranslatorService) {
    this.store = store
    this.translatorService = translatorService || null
  }

  show() {
    if (this.panel) {
      this.panel.reveal()
      this.update()
      return
    }

    this.panel = window.createWebviewPanel(
      'i18nAllyPro.matrix',
      '🌐 i18n Translation Matrix',
      ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.onDidDispose(() => {
      this.disposeListeners()
      this.panel = null
    })
    this.panel.webview.onDidReceiveMessage(async (msg: MatrixMessage) => {
      await this.handleMessage(msg)
    })

    // Listen to store changes (programmatic updates)
    this.storeChangeListener = () => this.scheduleRefresh()
    this.store.on('didChange', this.storeChangeListener)

    // Watch translation files on disk for external changes
    const config = this.store.projectConfig
    for (const localePath of config.localesPaths) {
      const pattern = new RelativePattern(
        Uri.file(config.rootPath),
        `${localePath}/**/*.{json,yaml,yml,po,properties}`,
      )
      const watcher = workspace.createFileSystemWatcher(pattern)
      watcher.onDidChange(() => this.scheduleRefresh())
      watcher.onDidCreate(() => this.scheduleRefresh())
      watcher.onDidDelete(() => this.scheduleRefresh())
      this.fileWatchers.push(watcher)
    }

    this.update()
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(async () => {
      if (!this.panel) return
      try {
        await this.store.refresh()
        this.update()
      } catch {
        // ignore refresh errors
      }
    }, 500)
  }

  private disposeListeners() {
    if (this.storeChangeListener) {
      this.store.removeListener('didChange', this.storeChangeListener)
      this.storeChangeListener = null
    }
    if (this.fileWatchers.length) {
      this.fileWatchers.forEach(w => w.dispose())
      this.fileWatchers = []
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private postToast(message: string, level: 'success' | 'error' | 'warn' = 'success') {
    this.panel?.webview.postMessage({ type: 'toast', message, level })
  }

  private async handleMessage(msg: MatrixMessage) {
    switch (msg.type) {
      case 'editCell': {
        if (!msg.key || !msg.locale || msg.value === undefined) return
        try {
          await this.store.setTranslation(msg.locale, msg.key, msg.value)
          this.panel?.webview.postMessage({
            type: 'cellSaved',
            key: msg.key,
            locale: msg.locale,
            value: msg.value,
          })
          this.postToast(t('editor.saved', msg.key, msg.locale))
        } catch (err: any) {
          this.panel?.webview.postMessage({
            type: 'cellSaveFailed',
            key: msg.key,
            locale: msg.locale,
          })
          this.postToast(t('editor.save_failed', err.message), 'error')
          window.showErrorMessage(t('editor.save_failed', err.message))
        }
        break
      }
      case 'translateCell': {
        if (!msg.key || !msg.locale) return
        this.panel?.webview.postMessage({
          type: 'cellTranslating',
          key: msg.key,
          locale: msg.locale,
        })
        const source = this.store.resolveSourceTranslation(msg.key)
        if (!source) {
          this.panel?.webview.postMessage({
            type: 'cellTranslateFailed',
            key: msg.key,
            locale: msg.locale,
          })
          this.postToast(t('editor.no_source', msg.key), 'warn')
          window.showWarningMessage(t('editor.no_source', msg.key))
          return
        }
        const { TranslatorService } = await import('../services/translator')
        const translator = new TranslatorService(this.store)
        try {
          const result = await translator.translateText(source.value, source.locale, msg.locale)
          if (result) {
            await this.store.setTranslation(msg.locale, msg.key, result)
            this.panel?.webview.postMessage({
              type: 'cellTranslated',
              key: msg.key,
              locale: msg.locale,
              value: result,
            })
            this.postToast(t('editor.translated_ok', msg.key, msg.locale))
          } else {
            this.panel?.webview.postMessage({
              type: 'cellTranslateFailed',
              key: msg.key,
              locale: msg.locale,
            })
            this.postToast(t('editor.translated_empty', msg.key, msg.locale), 'warn')
            window.showWarningMessage(t('editor.translated_empty', msg.key, msg.locale))
          }
        } catch (err: any) {
          this.panel?.webview.postMessage({
            type: 'cellTranslateFailed',
            key: msg.key,
            locale: msg.locale,
          })
          this.postToast(t('editor.translate_failed', err.message), 'error')
          window.showErrorMessage(t('editor.translate_failed', err.message))
        }
        break
      }
      case 'translateAllMissing': {
        this.postToast(t('editor.translating'), 'warn')
        const { TranslatorService } = await import('../services/translator')
        const translator = new TranslatorService(this.store)
        const result = await translator.autoTranslateEmptyKeys()
        const emoji = result.errors > 0 ? '⚠️' : '✅'
        const summary = `${emoji} ${result.translated} translated, ${result.skipped} skipped, ${result.errors} errors`
        window.showInformationMessage(summary)
        this.update()
        this.panel?.webview.postMessage({
          type: 'translateDone',
          translated: result.translated,
          errors: result.errors,
          skipped: result.skipped,
        })
        this.postToast(summary, result.errors > 0 ? 'warn' : 'success')
        break
      }
      case 'deleteKey': {
        if (!msg.key) return
        const confirm = await window.showWarningMessage(
          `Delete key "${msg.key}" from ALL locales?`,
          { modal: true },
          'Delete',
        )
        if (confirm === 'Delete') {
          for (const locale of this.store.locales) {
            await this.store.deleteTranslation(locale, msg.key)
          }
          this.update()
          this.postToast(t('editor.deleted', msg.key, 'all'))
        }
        break
      }
      case 'cloneLocale': {
        if (!msg.sourceLocale || !msg.targetLocale) return
        this.postToast(t('editor.translating'), 'warn')
        try {
          const result = await this.store.cloneLocale(msg.sourceLocale, msg.targetLocale, msg.overwrite || false)
          await this.store.refresh()
          this.update()
          const cloneMsg = `✅ ${msg.sourceLocale} → ${msg.targetLocale}: ${result.cloned} copied, ${result.skipped} skipped`
          window.showInformationMessage(cloneMsg)
          this.panel?.webview.postMessage({ type: 'cloneDone', cloned: result.cloned, skipped: result.skipped })
          this.postToast(cloneMsg)
          if (this.translatorService && msg.sourceLocale !== msg.targetLocale) {
            const translateResult = await this.translatorService.translateLocale(msg.sourceLocale, msg.targetLocale, msg.overwrite || false)
            await this.store.refresh()
            this.update()
            const trMsg = `🌐 ${msg.sourceLocale} → ${msg.targetLocale}: ${translateResult.translated} translated`
            window.showInformationMessage(trMsg)
            this.panel?.webview.postMessage({
              type: 'translateDone',
              translated: translateResult.translated,
              errors: translateResult.errors,
            })
            this.postToast(trMsg)
          }
        } catch (err: any) {
          window.showErrorMessage(`Clone failed: ${err.message}`)
          this.panel?.webview.postMessage({ type: 'cloneDone', error: true })
          this.postToast(`Clone failed: ${err.message}`, 'error')
        }
        break
      }
      case 'export': {
        const btn = 'export'
        try {
          const { ExportImportService } = await import('../services/exportImport')
          const exportService = new ExportImportService(this.store)
          await exportService.exportTranslations()
          this.panel?.webview.postMessage({ type: 'exportDone' })
        } catch (err: any) {
          window.showErrorMessage(t('export.failed', err.message))
          this.panel?.webview.postMessage({ type: 'exportDone', error: true })
        }
        break
      }
      case 'import': {
        try {
          const { ExportImportService } = await import('../services/exportImport')
          const importService = new ExportImportService(this.store)
          await importService.importTranslations()
          await this.store.refresh()
          this.update()
          this.panel?.webview.postMessage({ type: 'importDone' })
        } catch (err: any) {
          window.showErrorMessage(t('import.failed', err.message))
          this.panel?.webview.postMessage({ type: 'importDone', error: true })
        }
        break
      }
      case 'refresh': {
        try {
          await this.store.refresh()
          this.update()
          this.panel?.webview.postMessage({ type: 'refreshDone' })
        } catch (err: any) {
          window.showErrorMessage(t('matrix.refresh_failed', err.message))
          this.panel?.webview.postMessage({ type: 'refreshDone', error: true })
        }
        break
      }
      case 'openFile': {
        if (!msg.key) return
        const locale = msg.locale || this.store.projectConfig.sourceLanguage
        const file = this.store.findFileForKey(msg.key, locale)
        if (file) {
          const pos = this.store.findKeyPosition(file.filepath, msg.key)
          const doc = await workspace.openTextDocument(Uri.file(file.filepath))
          const editor = await window.showTextDocument(doc, ViewColumn.One)
          if (pos) {
            const { Position, Selection, Range } = await import('vscode')
            const position = new Position(pos.line, pos.column)
            editor.selection = new Selection(position, position)
            editor.revealRange(new Range(position, position))
          }
          this.postToast(t('editor.opening_file'))
        } else {
          this.postToast(t('editor.file_not_found', msg.key), 'warn')
          window.showWarningMessage(t('editor.file_not_found', msg.key))
        }
        break
      }
    }
  }

  private update() {
    if (!this.panel) return

    const nonce = getWebviewNonce()
    const csp = buildWebviewCsp(this.panel.webview, nonce)
    const locales = this.store.locales
    const allKeys = this.store.getAllKeys()
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage

    const cloneLocaleData = buildCloneLocaleData(locales)

    const localeHeaders = locales.map(l => {
      const isSource = l === sourceLocale
      const border = isSource ? 'border-bottom:3px solid #4CAF50' : 'border-bottom:2px solid #333'
      const badge = isSource ? ' <span style="font-size:10px;color:#4CAF50">★</span>' : ''
      return `<th style="padding:8px 12px;${border};white-space:nowrap;position:sticky;top:0;background:#1e1e1e;z-index:1;cursor:pointer" data-action="sort" data-col="${locales.indexOf(l) + 1}">${l.toUpperCase()}${badge}</th>`
    }).join('')

    const keyHeader = `<th style="padding:8px 12px;border-bottom:2px solid #333;white-space:nowrap;position:sticky;top:0;background:#1e1e1e;z-index:1;cursor:pointer;text-align:left" data-action="sort" data-col="0">KEY</th>`

    const rows = allKeys.map(key => {
      const missingForLocales: string[] = []
      const cells = [`<td style="padding:6px 12px;border-bottom:1px solid #333;font-family:monospace;font-size:13px;white-space:nowrap;color:#9CDCFE;cursor:pointer" data-action="open-file" data-key="${this.escAttr(key)}" title="Click to open file">${this.escHtml(key)}</td>`]

      for (const locale of locales) {
        const value = this.store.getTranslation(locale, key)
        const isEmpty = value === undefined || value.trim() === ''
        if (isEmpty) missingForLocales.push(locale)

        const cellClass = isEmpty ? 'cell-td missing' : 'cell-td'
        const display = isEmpty ? '' : this.escHtml(value)
        const translateBtn = isEmpty
          ? `<button type="button" class="cell-translate" data-action="translate" data-key="${this.escAttr(key)}" data-locale="${this.escAttr(locale)}" title="Auto translate">🤖</button>`
          : ''

        cells.push(`<td class="${cellClass}">
          <div class="cell-wrap">
            <textarea class="cell-input" rows="2" data-key="${this.escAttr(key)}" data-locale="${this.escAttr(locale)}" placeholder="${isEmpty ? '(missing)' : ''}">${display}</textarea>
            ${translateBtn}
          </div>
        </td>`)
      }

      const rowClass = missingForLocales.length > 0 ? 'row-incomplete' : 'row-complete'
      return `<tr class="${rowClass}" data-missing="${missingForLocales.length}" data-key="${this.escAttr(key)}">${cells.join('')}</tr>`
    }).join('')

    const diagnostics = this.store.getDiagnostics()
    const missingCount = diagnostics.filter(d => d.type === 'missing').length
    const emptyCount = diagnostics.filter(d => d.type === 'empty').length
    const completeCount = allKeys.length - diagnostics.filter(d => d.type === 'missing' || d.type === 'empty').length / Math.max(locales.length, 1)

    const localeStats = locales.map(l => {
      const keys = this.store.getKeysForLocale(l)
      const filled = keys.filter(k => {
        const v = this.store.getTranslation(l, k)
        return v !== undefined && v !== ''
      }).length
      const pct = allKeys.length > 0 ? Math.round(filled / allKeys.length * 100) : 0
      const barColor = pct === 100 ? '#4CAF50' : pct > 70 ? '#FFC107' : '#f48771'
      return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
        <span style="width:30px;font-size:12px;color:#aaa">${l.toUpperCase()}</span>
        <div style="flex:1;height:6px;background:#333;border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${barColor};border-radius:3px"></div>
        </div>
        <span style="font-size:11px;color:#888;min-width:40px;text-align:right">${pct}%</span>
      </div>`
    }).join('')

    this.panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Translation Matrix</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/css/flag-icons.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; flex-direction: column; user-select: text; -webkit-user-select: text; }
    .toolbar { padding: 12px 20px; border-bottom: 1px solid #333; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .toolbar h2 { color: #4CAF50; font-size: 16px; margin-right: 8px; }
    .search-box { flex: 1; min-width: 200px; max-width: 400px; padding: 6px 12px; background: #2d2d2d; border: 1px solid #555; border-radius: 4px; color: #d4d4d4; font-size: 13px; outline: none; }
    .search-box:focus { border-color: #4CAF50; }
    .btn { padding: 5px 14px; border-radius: 4px; border: 1px solid #555; background: #2d2d2d; color: #d4d4d4; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .btn:hover { background: #3d3d3d; border-color: #888; }
    .btn-primary { background: #2e5c2e; border-color: #4CAF50; color: #4CAF50; }
    .btn-primary:hover { background: #3a7a3a; }
    .btn-danger { border-color: #f48771; color: #f48771; }
    .btn-danger:hover { background: rgba(244,135,113,0.1); }
    .stats-bar { padding: 8px 20px; border-bottom: 1px solid #333; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .stat { padding: 3px 10px; border-radius: 4px; font-size: 12px; }
    .stat.missing { background: rgba(255,0,0,0.12); color: #f48771; }
    .stat.empty { background: rgba(255,165,0,0.12); color: #dcdcaa; }
    .stat.ok { background: rgba(76,175,80,0.12); color: #4CAF50; }
    .locale-progress { display: flex; gap: 4px; flex: 1; min-width: 300px; padding: 0 12px; }
    .filter-group { display: flex; gap: 6px; align-items: center; }
    .filter-btn { padding: 3px 10px; border-radius: 12px; border: 1px solid #555; background: transparent; color: #aaa; font-size: 11px; cursor: pointer; }
    .filter-btn.active { background: #4CAF50; border-color: #4CAF50; color: #fff; }
    .table-wrap { overflow: auto; flex: 1; min-height: 0; }
    table { border-collapse: collapse; width: 100%; }
    tr:hover { background: rgba(255,255,255,0.03); }
    tr.row-incomplete { border-left: 3px solid #f48771; }
    tr.row-complete { border-left: 3px solid transparent; }
    .hidden { display: none !important; }
    .cell-td { padding: 4px 6px; border-bottom: 1px solid #333; vertical-align: top; min-width: 140px; }
    .cell-td.missing { background: rgba(255,0,0,0.06); }
    .cell-wrap { display: flex; gap: 4px; align-items: flex-start; }
    .cell-input {
      flex: 1; min-width: 100px; padding: 6px 8px; background: #2d2d2d; border: 1px solid #444;
      border-radius: 4px; color: #CE9178; font-size: 12px; font-family: inherit; resize: vertical;
      outline: none; user-select: text; -webkit-user-select: text; pointer-events: auto;
    }
    .cell-input:focus { border-color: #4CAF50; }
    .cell-input::placeholder { color: #f48771; font-style: italic; }
    .cell-translate { flex-shrink: 0; width: 28px; height: 28px; border: 1px solid #444; border-radius: 4px;
      background: #2d2d2d; cursor: pointer; font-size: 12px; }
    .cell-translate:hover { border-color: #2196F3; }
    .cell-translate.loading { opacity: 0.5; pointer-events: none; }
    .cell-input.saving { border-color: #FFC107; opacity: 0.85; }
    .cell-input.saved-flash { border-color: #4CAF50; transition: border-color 0.3s; }
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 8px 20px; border-radius: 6px; font-size: 13px; z-index: 9999; transition: opacity 0.3s; pointer-events: none; color: #fff; max-width: 90%; text-align: center; }
    .btn.loading { opacity: 0.6; pointer-events: none; }
    ${getCloneDialogCss()}
  </style>
</head>
<body>
  <div class="toolbar">
    <h2>🌐 Translation Matrix</h2>
    <input id="matrixSearch" class="search-box" type="text" placeholder="Search keys or values..." data-action="search" />
    <div class="filter-group">
      <button type="button" class="filter-btn active" data-action="filter" data-filter="all">All</button>
      <button type="button" class="filter-btn" data-action="filter" data-filter="missing">Missing</button>
      <button type="button" class="filter-btn" data-action="filter" data-filter="complete">Complete</button>
    </div>
    <button type="button" class="btn btn-primary" data-action="translate-all">🤖 Translate All Missing</button>
    <button type="button" class="btn" data-action="clone-dialog">📋 Clone Locale</button>
    <button type="button" class="btn" data-action="export">📤 Export</button>
    <button type="button" class="btn" data-action="import">📥 Import</button>
    <button type="button" class="btn" data-action="refresh">🔄 Refresh</button>
  </div>
  <div class="stats-bar">
    <span class="stat ok">✓ ${allKeys.length} keys</span>
    <span class="stat missing">✗ ${missingCount} missing</span>
    <span class="stat empty">⚠ ${emptyCount} empty</span>
    <div class="locale-progress">${localeStats}</div>
  </div>
  <div class="table-wrap">
    <table id="matrixTable">
      <thead><tr>${keyHeader}${localeHeaders}</tr></thead>
      <tbody id="matrixBody">${rows}</tbody>
    </table>
  </div>
  ${getCloneDialogHtml()}
  <script nonce="${nonce}">
    const ALL_LOCALES = ${JSON.stringify(locales)};
    const SOURCE_LOCALE = ${JSON.stringify(sourceLocale)};
    const vscode = acquireVsCodeApi();
    let currentFilter = 'all';
    let sortCol = -1;
    let sortAsc = true;

    function showToast(message, level) {
      let toast = document.getElementById('matrixToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'matrixToast';
        toast.className = 'toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.background = level === 'error' ? '#d32f2f' : level === 'warn' ? '#f57c00' : '#388e3c';
      toast.style.opacity = '1';
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
    }

    function findCellInput(key, locale) {
      return Array.from(document.querySelectorAll('.cell-input')).find(
        el => el.dataset.key === key && el.dataset.locale === locale
      ) || null;
    }

    function findTranslateBtn(key, locale) {
      return Array.from(document.querySelectorAll('.cell-translate')).find(
        el => el.dataset.key === key && el.dataset.locale === locale
      ) || null;
    }

    function saveCell(el) {
      const key = el.dataset.key;
      const locale = el.dataset.locale;
      if (!key || !locale) return;
      if (el.dataset.saving === '1') return;
      const prev = el.dataset.lastSaved ?? '';
      if (el.value === prev) return;
      el.dataset.saving = '1';
      el.classList.add('saving');
      vscode.postMessage({ type: 'editCell', key, locale, value: el.value });
    }

    function translateCell(key, locale) {
      const btn = findTranslateBtn(key, locale);
      if (btn?.classList.contains('loading')) return;
      if (btn) {
        btn.classList.add('loading');
        btn.textContent = '⏳';
      }
      vscode.postMessage({ type: 'translateCell', key, locale });
    }

    function translateAllMissing() {
      const btn = document.querySelector('.btn-primary');
      if (btn && btn.disabled) return;
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Translating...';
        btn.style.opacity = '0.7';
      }
      vscode.postMessage({ type: 'translateAllMissing' });
    }

    function openFile(key) {
      vscode.postMessage({ type: 'openFile', key, locale: '${sourceLocale}' });
    }

    function doExport() {
      const btn = document.querySelector('[data-action="export"]');
      if (btn && btn.disabled) return;
      if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        btn.textContent = '⏳ Export...';
      }
      vscode.postMessage({ type: 'export' });
    }

    function doImport() {
      const btn = document.querySelector('[data-action="import"]');
      if (btn && btn.disabled) return;
      if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        btn.textContent = '⏳ Import...';
      }
      vscode.postMessage({ type: 'import' });
    }

    function doRefresh() {
      const btn = document.querySelector('[data-action="refresh"]');
      if (btn && btn.disabled) return;
      if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        btn.textContent = '⏳ Refresh...';
      }
      vscode.postMessage({ type: 'refresh' });
    }

    function bindMatrixUi() {
      document.getElementById('matrixSearch')?.addEventListener('input', (e) => {
        filterTable(e.target.value);
      });

      document.body.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const action = el.dataset.action;
        if (action === 'filter' && el.dataset.filter) {
          setFilter(el.dataset.filter, el);
        } else if (action === 'translate-all') {
          translateAllMissing();
        } else if (action === 'clone-dialog') {
          if (typeof showCloneDialog === 'function') showCloneDialog();
        } else if (action === 'export') {
          doExport();
        } else if (action === 'import') {
          doImport();
        } else if (action === 'refresh') {
          doRefresh();
        } else if (action === 'sort' && el.dataset.col !== undefined) {
          sortTable(Number(el.dataset.col));
        } else if (action === 'open-file' && el.dataset.key) {
          openFile(el.dataset.key);
        }
      });
    }

    bindMatrixUi();

    function applyCellValue(key, locale, value) {
      const el = findCellInput(key, locale);
      if (!el) return;
      el.value = value;
      el.dataset.lastSaved = value;
      el.classList.remove('saving');
      el.classList.add('saved-flash');
      setTimeout(() => el.classList.remove('saved-flash'), 1200);
      const td = el.closest('.cell-td');
      if (td) td.classList.remove('missing');
      const btn = findTranslateBtn(key, locale);
      if (btn) btn.remove();
      const row = el.closest('tr');
      if (row) {
        const missing = row.querySelectorAll('.cell-td.missing').length;
        if (missing === 0) {
          row.classList.remove('row-incomplete');
          row.classList.add('row-complete');
        }
      }
    }

    function resetTranslateBtn(key, locale) {
      const btn = findTranslateBtn(key, locale);
      if (btn) {
        btn.classList.remove('loading');
        btn.textContent = '🤖';
      }
    }

    document.getElementById('matrixBody')?.addEventListener('blur', (e) => {
      const el = e.target;
      if (el && el.classList && el.classList.contains('cell-input')) saveCell(el);
    }, true);

    document.getElementById('matrixBody')?.addEventListener('keydown', (e) => {
      const el = e.target;
      if (!el || !el.classList || !el.classList.contains('cell-input')) return;
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveCell(el);
      }
    });

    document.getElementById('matrixBody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="translate"]');
      if (!btn) return;
      e.preventDefault();
      translateCell(btn.dataset.key, btn.dataset.locale);
    });

    document.querySelectorAll('.cell-input').forEach(el => {
      el.dataset.lastSaved = el.value;
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'toast' && msg.message) {
        showToast(msg.message, msg.level);
      }
      if (msg.type === 'cellSaved' && msg.key && msg.locale) {
        applyCellValue(msg.key, msg.locale, msg.value ?? '');
        const el = findCellInput(msg.key, msg.locale);
        if (el) el.dataset.saving = '0';
      }
      if (msg.type === 'cellSaveFailed' && msg.key && msg.locale) {
        const el = findCellInput(msg.key, msg.locale);
        if (el) {
          el.dataset.saving = '0';
          el.classList.remove('saving');
        }
      }
      if (msg.type === 'cellTranslated' && msg.key && msg.locale) {
        applyCellValue(msg.key, msg.locale, msg.value ?? '');
        resetTranslateBtn(msg.key, msg.locale);
      }
      if (msg.type === 'cellTranslateFailed' && msg.key && msg.locale) {
        resetTranslateBtn(msg.key, msg.locale);
      }
      if (msg.type === 'translateDone') {
        const btn = document.querySelector('.btn-primary');
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.style.opacity = '1';
          const label = msg.translated > 0
            ? '✅ ' + msg.translated + ' done'
            : '🤖 Translate All Missing';
          btn.textContent = label;
          setTimeout(() => { btn.textContent = '🤖 Translate All Missing'; }, 3500);
        }
      }
      if (msg.type === 'cloneDone') {
        const btn = document.querySelector('[data-action="clone-dialog"]');
        if (btn) {
          btn.classList.remove('loading');
          btn.textContent = msg.error ? '❌ Clone failed' : '✅ Cloned ' + (msg.cloned || 0) + ' keys';
          setTimeout(() => { btn.textContent = '📋 Clone Locale'; }, 3500);
        }
      }
      if (msg.type === 'exportDone') {
        const btn = document.querySelector('[data-action="export"]');
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.textContent = msg.error ? '❌ Export failed' : '✅ Exported';
          setTimeout(() => { btn.textContent = '📤 Export'; }, 3500);
        }
      }
      if (msg.type === 'importDone') {
        const btn = document.querySelector('[data-action="import"]');
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.textContent = msg.error ? '❌ Import failed' : '✅ Imported';
          setTimeout(() => { btn.textContent = '📥 Import'; }, 3500);
        }
      }
      if (msg.type === 'refreshDone') {
        const btn = document.querySelector('[data-action="refresh"]');
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.textContent = msg.error ? '❌ Refresh failed' : '✅ Refreshed';
          setTimeout(() => { btn.textContent = '🔄 Refresh'; }, 2000);
        }
      }
    });

    function filterTable(query) {
      query = query.toLowerCase();
      const rows = document.querySelectorAll('#matrixBody tr');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const matchesFilter = currentFilter === 'all' ||
          (currentFilter === 'missing' && row.classList.contains('row-incomplete')) ||
          (currentFilter === 'complete' && row.classList.contains('row-complete'));
        const matchesSearch = !query || text.includes(query);
        row.classList.toggle('hidden', !matchesFilter || !matchesSearch);
      });
    }

    function setFilter(filter, btn) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const searchBox = document.querySelector('.search-box');
      filterTable(searchBox ? searchBox.value : '');
    }

    function sortTable(colIndex) {
      if (sortCol === colIndex) { sortAsc = !sortAsc; } else { sortCol = colIndex; sortAsc = true; }
      const tbody = document.getElementById('matrixBody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const aVal = a.cells[colIndex]?.textContent.trim() || '';
        const bVal = b.cells[colIndex]?.textContent.trim() || '';
        const cmp = aVal.localeCompare(bVal);
        return sortAsc ? cmp : -cmp;
      });
      rows.forEach(r => tbody.appendChild(r));
    }

    ${getCloneDialogJs(cloneLocaleData, locales, sourceLocale)}
  </script>
</body>
</html>`
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
