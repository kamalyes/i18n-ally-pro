import { window, ViewColumn, Uri, workspace } from 'vscode'
import { TranslationStore } from '../core/store'

interface MatrixMessage {
  type: 'ready' | 'editCell' | 'translateCell' | 'translateAllMissing' | 'deleteKey' | 'exportCsv' | 'openFile'
  key?: string
  locale?: string
  value?: string
  keys?: string[]
}

export class TranslationMatrixPanel {
  private store: TranslationStore
  private panel: import('vscode').WebviewPanel | null = null

  constructor(store: TranslationStore) {
    this.store = store
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

    this.panel.onDidDispose(() => { this.panel = null })
    this.panel.webview.onDidReceiveMessage(async (msg: MatrixMessage) => {
      await this.handleMessage(msg)
    })
    this.update()
  }

  private async handleMessage(msg: MatrixMessage) {
    switch (msg.type) {
      case 'editCell': {
        if (!msg.key || !msg.locale) return
        const current = this.store.getTranslation(msg.locale, msg.key) || ''
        const newValue = await window.showInputBox({
          prompt: `Edit "${msg.key}" (${msg.locale})`,
          value: current,
        })
        if (newValue !== undefined) {
          await this.store.setTranslation(msg.locale, msg.key, newValue)
          this.update()
        }
        break
      }
      case 'translateCell': {
        if (!msg.key || !msg.locale) return
        const config = this.store.projectConfig
        const sourceValue = this.store.getTranslation(config.sourceLanguage, msg.key)
        if (!sourceValue) {
          window.showWarningMessage(`No source translation for "${msg.key}"`)
          return
        }
        const { TranslatorService } = await import('../services/translator')
        const translator = new TranslatorService(this.store)
        try {
          const result = await translator.translateText(sourceValue, config.sourceLanguage, msg.locale)
          if (result) {
            await this.store.setTranslation(msg.locale, msg.key, result)
            this.update()
          }
        } catch (err: any) {
          window.showErrorMessage(`Translation failed: ${err.message}`)
        }
        break
      }
      case 'translateAllMissing': {
        const { TranslatorService } = await import('../services/translator')
        const translator = new TranslatorService(this.store)
        const result = await translator.autoTranslateEmptyKeys()
        const emoji = result.errors > 0 ? '⚠️' : '✅'
        window.showInformationMessage(
          `${emoji} Translated: ${result.translated}, Skipped: ${result.skipped}, Errors: ${result.errors}`,
        )
        this.update()
        this.panel?.webview.postMessage({ type: 'translateDone', translated: result.translated, errors: result.errors })
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
        }
        break
      }
      case 'exportCsv': {
        const csv = this.generateCsv()
        const uri = await window.showSaveDialog({
          defaultUri: Uri.file('i18n-matrix.csv'),
          filters: { 'CSV Files': ['csv'] },
        })
        if (uri) {
          const fs = require('fs')
          fs.writeFileSync(uri.fsPath, '\uFEFF' + csv, 'utf-8')
          window.showInformationMessage(`Exported to ${uri.fsPath}`)
        }
        break
      }
      case 'openFile': {
        if (!msg.key || !msg.locale) return
        const file = this.store.findFileForKey(msg.key, msg.locale)
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
        }
        break
      }
    }
  }

  private generateCsv(): string {
    const locales = this.store.locales
    const allKeys = this.store.getAllKeys()
    const header = ['Key', ...locales].join(',')
    const rows = allKeys.map(key => {
      const cells = [key, ...locales.map(l => {
        const val = this.store.getTranslation(l, key) || ''
        return `"${val.replace(/"/g, '""')}"`
      })]
      return cells.join(',')
    })
    return [header, ...rows].join('\n')
  }

  private update() {
    if (!this.panel) return

    const locales = this.store.locales
    const allKeys = this.store.getAllKeys()
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage

    const localeHeaders = locales.map(l => {
      const isSource = l === sourceLocale
      const border = isSource ? 'border-bottom:3px solid #4CAF50' : 'border-bottom:2px solid #333'
      const badge = isSource ? ' <span style="font-size:10px;color:#4CAF50">★</span>' : ''
      return `<th style="padding:8px 12px;${border};white-space:nowrap;position:sticky;top:0;background:#1e1e1e;z-index:1;cursor:pointer" onclick="sortTable(${locales.indexOf(l) + 1})">${l.toUpperCase()}${badge}</th>`
    }).join('')

    const keyHeader = `<th style="padding:8px 12px;border-bottom:2px solid #333;white-space:nowrap;position:sticky;top:0;background:#1e1e1e;z-index:1;cursor:pointer;text-align:left" onclick="sortTable(0)">KEY</th>`

    const rows = allKeys.map(key => {
      const missingForLocales: string[] = []
      const cells = [`<td style="padding:6px 12px;border-bottom:1px solid #333;font-family:monospace;font-size:13px;white-space:nowrap;color:#9CDCFE;cursor:pointer" onclick="openFile('${this.escJs(key)}')" title="Click to open file">${this.escHtml(key)}</td>`]

      for (const locale of locales) {
        const value = this.store.getTranslation(locale, key)
        const isEmpty = value === undefined || value === ''
        if (isEmpty) missingForLocales.push(locale)

        const style = isEmpty
          ? 'padding:6px 12px;border-bottom:1px solid #333;background:rgba(255,0,0,0.08);color:#f48771;font-style:italic;cursor:pointer'
          : 'padding:6px 12px;border-bottom:1px solid #333;color:#CE9178;cursor:pointer'

        const display = isEmpty ? '(missing)' : this.escHtml(value.length > 60 ? value.slice(0, 60) + '...' : value)
        const clickAction = isEmpty ? `translateCell('${this.escJs(key)}','${locale}')` : `editCell('${this.escJs(key)}','${locale}')`
        const hoverTitle = isEmpty ? 'Click to translate' : `Click to edit\n${this.escHtml(value || '')}`

        cells.push(`<td style="${style}" onclick="${clickAction}" title="${hoverTitle}">${display}</td>`)
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Translation Matrix</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
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
    .table-wrap { overflow: auto; max-height: calc(100vh - 140px); }
    table { border-collapse: collapse; width: 100%; }
    tr:hover { background: rgba(255,255,255,0.03); }
    tr.row-incomplete { border-left: 3px solid #f48771; }
    tr.row-complete { border-left: 3px solid transparent; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h2>🌐 Translation Matrix</h2>
    <input class="search-box" type="text" placeholder="Search keys or values..." oninput="filterTable(this.value)" />
    <div class="filter-group">
      <button class="filter-btn active" onclick="setFilter('all', this)">All</button>
      <button class="filter-btn" onclick="setFilter('missing', this)">Missing</button>
      <button class="filter-btn" onclick="setFilter('complete', this)">Complete</button>
    </div>
    <button class="btn btn-primary" onclick="translateAllMissing()">🤖 Translate All Missing</button>
    <button class="btn" onclick="exportCsv()">📄 Export CSV</button>
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
  <script>
    const vscode = acquireVsCodeApi();
    let currentFilter = 'all';
    let sortCol = -1;
    let sortAsc = true;

    function editCell(key, locale) {
      vscode.postMessage({ type: 'editCell', key, locale });
    }

    function translateCell(key, locale) {
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

    function exportCsv() {
      vscode.postMessage({ type: 'exportCsv' });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'translateDone') {
        const btn = document.querySelector('.btn-primary');
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.textContent = msg.translated > 0 ? '✅ Done!' : '🤖 Translate All Missing';
          if (msg.translated > 0) {
            setTimeout(() => { btn.textContent = '🤖 Translate All Missing'; }, 3000);
          }
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
