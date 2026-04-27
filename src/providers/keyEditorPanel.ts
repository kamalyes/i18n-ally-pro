import { window, ViewColumn, workspace, Uri, Selection, Position, Range, ProgressLocation } from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, getLocaleName, getLocaleFlagCssClass, t } from '../i18n'

interface EditorMessage {
  type: 'ready' | 'edit' | 'translate' | 'translateMissing' | 'translateAll' | 'openFile' | 'delete'
  key?: string
  locale?: string
  value?: string
}

export class KeyEditorPanel {
  private store: TranslationStore
  private panel: import('vscode').WebviewPanel | null = null
  private currentKey: string = ''

  constructor(store: TranslationStore) {
    this.store = store
  }

  show(keypath: string) {
    this.currentKey = keypath

    if (this.panel) {
      this.panel.reveal(ViewColumn.Beside)
      this.update()
      return
    }

    this.panel = window.createWebviewPanel(
      'i18nAllyPro.keyEditor',
      `📝 ${keypath}`,
      ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.onDidDispose(() => { this.panel = null })
    this.panel.webview.onDidReceiveMessage(async (msg: EditorMessage) => {
      await this.handleMessage(msg)
    })

    this.update()
  }

  private postToast(msg: string, type: 'success' | 'error' | 'warn' = 'success') {
    this.panel?.webview.postMessage({ type: 'toast', message: msg, level: type })
  }

  private async handleMessage(msg: EditorMessage) {
    switch (msg.type) {
      case 'edit': {
        if (!msg.key || !msg.locale || msg.value === undefined) return
        try {
          await this.store.setTranslation(msg.locale, msg.key, msg.value)
          this.update()
          this.postToast(t('editor.saved', msg.key, msg.locale))
          window.showInformationMessage(t('editor.saved', msg.key, msg.locale))
        } catch (err: any) {
          this.postToast(t('editor.save_failed', err.message), 'error')
          window.showErrorMessage(t('editor.save_failed', err.message))
        }
        break
      }
      case 'translate': {
        if (!msg.key || !msg.locale) return
        const config = this.store.projectConfig
        const sourceValue = this.store.getTranslation(config.sourceLanguage, msg.key)
        if (!sourceValue) {
          this.postToast(t('editor.no_source', msg.key), 'warn')
          window.showWarningMessage(t('editor.no_source', msg.key))
          return
        }
        try {
          const { TranslatorService } = await import('../services/translator')
          const translator = new TranslatorService(this.store)
          const result = await translator.translateText(sourceValue, config.sourceLanguage, msg.locale)
          if (result) {
            await this.store.setTranslation(msg.locale, msg.key, result)
            this.update()
            this.postToast(t('editor.translated_ok', msg.key, msg.locale))
            window.showInformationMessage(t('editor.translated_ok', msg.key, msg.locale))
          } else {
            this.postToast(t('editor.translated_empty', msg.key, msg.locale), 'warn')
            window.showWarningMessage(t('editor.translated_empty', msg.key, msg.locale))
          }
        } catch (err: any) {
          this.postToast(t('editor.translate_failed', err.message), 'error')
          window.showErrorMessage(t('editor.translate_failed', err.message))
        }
        break
      }
      case 'translateMissing': {
        if (!msg.key) return
        await this.translateKeyBatch(msg.key, false)
        break
      }
      case 'translateAll': {
        if (!msg.key) return
        await this.translateKeyBatch(msg.key, true)
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
            const position = new Position(pos.line, pos.column)
            editor.selection = new Selection(position, position)
            editor.revealRange(new Range(position, position))
          }
        } else {
          window.showWarningMessage(t('editor.file_not_found', msg.key))
        }
        break
      }
      case 'delete': {
        if (!msg.key || !msg.locale) return
        const confirm = await window.showWarningMessage(
          t('misc.deleted_confirm', msg.key, msg.locale),
          { modal: true },
          t('editor.delete'),
        )
        if (confirm === t('editor.delete')) {
          try {
            await this.store.deleteTranslation(msg.locale, msg.key)
            this.update()
            this.postToast(t('editor.deleted', msg.key, msg.locale))
            window.showInformationMessage(t('editor.deleted', msg.key, msg.locale))
          } catch (err: any) {
            this.postToast(t('editor.delete_failed', err.message), 'error')
            window.showErrorMessage(t('editor.delete_failed', err.message))
          }
        }
        break
      }
    }
  }

  private async translateKeyBatch(key: string, overwriteAll: boolean) {
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage
    const locales = this.store.locales

    const localeItems = locales
      .filter(l => {
        const v = this.store.getTranslation(l, key)
        return v !== undefined && v !== ''
      })
      .map(l => ({
        label: `${getLocaleFlag(l)} ${l}`,
        description: this.store.getTranslation(l, key) || '',
        locale: l,
      }))

    const customItem = { label: `✏️ ${t('editor.custom_source')}`, description: '', locale: '__custom__' }

    const picked = await window.showQuickPick([...localeItems, customItem], {
      placeHolder: t('editor.select_source'),
      title: overwriteAll ? t('editor.translate_all') : t('editor.translate_missing'),
      ignoreFocusOut: true,
    })

    if (!picked) return

    let sourceText = ''
    let fromLocale = ''

    if (picked.locale === '__custom__') {
      const custom = await window.showInputBox({
        prompt: t('editor.enter_source_text'),
        placeHolder: key,
        ignoreFocusOut: true,
      })
      if (!custom) return
      sourceText = custom
      fromLocale = sourceLocale
    } else {
      sourceText = this.store.getTranslation(picked.locale, key) || ''
      fromLocale = picked.locale
    }

    if (!sourceText) {
      this.postToast(t('editor.no_source', key), 'warn')
      window.showWarningMessage(t('editor.no_source', key))
      return
    }

    const targetLocales = locales.filter(l => l !== fromLocale)
    const localesToTranslate = overwriteAll
      ? targetLocales
      : targetLocales.filter(l => {
          const v = this.store.getTranslation(l, key)
          return v === undefined || v === ''
        })

    if (localesToTranslate.length === 0) {
      this.postToast(t('editor.all_translated', key))
      window.showInformationMessage(t('editor.all_translated', key))
      return
    }

    const { TranslatorService } = await import('../services/translator')
    const translator = new TranslatorService(this.store)

    let translated = 0
    let errors = 0

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `🌐 i18n Pro: ${overwriteAll ? t('editor.translate_all') : t('editor.translate_missing')}`,
        cancellable: true,
      },
      async (progress, token) => {
        const sourcePreview = sourceText.length > 20 ? sourceText.slice(0, 20) + '...' : sourceText
        progress.report({
          message: `🔤 Source: "${sourcePreview}"`,
        })

        for (let i = 0; i < localesToTranslate.length; i++) {
          if (token.isCancellationRequested) break
          const locale = localesToTranslate[i]
          progress.report({
            message: `[${i + 1}/${localesToTranslate.length}] 🔤 "${sourcePreview}" → ${getLocaleFlag(locale)} ${locale}`,
            increment: 100 / localesToTranslate.length,
          })
          try {
            const result = await translator.translateText(sourceText, fromLocale, locale)
            if (result) {
              await this.store.setTranslation(locale, key, result)
              translated++
              const resultPreview = result.length > 20 ? result.slice(0, 20) + '...' : result
              progress.report({
                message: `[${i + 1}/${localesToTranslate.length}] ✅ "${sourcePreview}" → ${getLocaleFlag(locale)} "${resultPreview}"`,
              })
            }
          } catch {
            errors++
            progress.report({
              message: `[${i + 1}/${localesToTranslate.length}] ❌ "${sourcePreview}" → ${getLocaleFlag(locale)} failed`,
            })
          }
        }

        progress.report({
          message: `Done! ✅ ${translated} translated, ❌ ${errors} errors`,
        })
      },
    )

    this.update()
    const resultMsg = t('editor.batch_translate_result', key, String(translated), String(errors))
    this.postToast(resultMsg, errors > 0 ? 'warn' : 'success')
    window.showInformationMessage(resultMsg)
  }

  private update() {
    if (!this.panel) return

    const key = this.currentKey
    const locales = this.store.locales
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage

    this.panel.title = `📝 ${key}`

    const rows = locales.map(locale => {
      const value = this.store.getTranslation(locale, key)
      const isMissing = value === undefined || value === ''
      const isSource = locale === sourceLocale
      const flagEmoji = getLocaleFlag(locale)
      const name = getLocaleName(locale)
      const flagCss = getLocaleFlagCssClass(locale)

      const statusClass = isMissing ? 'missing' : (isSource ? 'source' : 'translated')
      const statusIcon = isMissing ? '⚠️' : (isSource ? '⭐' : '✅')
      const displayValue = isMissing ? '' : this.escHtml(value!)

      return `
        <div class="locale-row ${statusClass}" data-locale="${locale}">
          <div class="locale-info">
            <span class="flag-icon-wrap"><span class="fi ${flagCss}"></span></span>
            <span class="locale-name">${name}</span>
            <span class="locale-code">${locale}</span>
            <span class="status-icon">${statusIcon}</span>
          </div>
          <div class="locale-edit">
            <textarea
              class="translation-input"
              data-locale="${locale}"
              data-key="${this.escAttr(key)}"
              placeholder="${isMissing ? 'Missing translation...' : ''}"
              rows="2"
            >${displayValue}</textarea>
            <div class="action-buttons">
              <button class="btn btn-save" onclick="saveValue('${this.escJs(locale)}','${this.escJs(key)}')" title="Save">💾</button>
              ${!isSource && isMissing ? `<button class="btn btn-translate" onclick="translateKey('${this.escJs(locale)}','${this.escJs(key)}')" title="Auto translate">🤖</button>` : ''}
              <button class="btn btn-open" onclick="openFile('${this.escJs(locale)}','${this.escJs(key)}')" title="Open in editor">📂</button>
              <button class="btn btn-delete" onclick="deleteKey('${this.escJs(locale)}','${this.escJs(key)}')" title="Delete">🗑️</button>
            </div>
          </div>
        </div>`
    }).join('')

    const diagnostics = this.store.getDiagnostics()
    const keyDiags = diagnostics.filter(d => d.key === key)
    const missingCount = keyDiags.filter(d => d.type === 'missing').length
    const emptyCount = keyDiags.filter(d => d.type === 'empty').length

    this.panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Key Editor: ${this.escHtml(key)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/css/flag-icons.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 16px; }
    .header { margin-bottom: 16px; }
    .key-path { font-family: monospace; font-size: 16px; color: #4CAF50; word-break: break-all; }
    .stats { display: flex; gap: 12px; margin-top: 8px; }
    .stat { padding: 3px 10px; border-radius: 4px; font-size: 12px; }
    .stat.ok { background: rgba(76,175,80,0.12); color: #4CAF50; }
    .stat.missing { background: rgba(255,0,0,0.12); color: #f48771; }
    .stat.empty { background: rgba(255,165,0,0.12); color: #dcdcaa; }
    .locale-row { border: 1px solid #333; border-radius: 6px; margin-bottom: 8px; padding: 12px; transition: border-color 0.2s; }
    .locale-row:hover { border-color: #555; }
    .locale-row.source { border-left: 3px solid #4CAF50; }
    .locale-row.missing { border-left: 3px solid #f48771; background: rgba(255,0,0,0.03); }
    .locale-row.translated { border-left: 3px solid #4CAF50; }
    .locale-info { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .flag-icon-wrap { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 20px; border-radius: 2px; overflow: hidden; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1); }
    .flag-icon-wrap .fi { width: 28px; height: 20px; display: block; background-size: contain; background-position: center; background-repeat: no-repeat; }
    .locale-name { font-size: 13px; color: #ccc; }
    .locale-code { font-size: 11px; color: #666; font-family: monospace; }
    .status-icon { margin-left: auto; font-size: 14px; }
    .locale-edit { display: flex; gap: 8px; align-items: flex-start; }
    .translation-input {
      flex: 1; padding: 8px 10px; background: #2d2d2d; border: 1px solid #444;
      border-radius: 4px; color: #d4d4d4; font-size: 13px; font-family: inherit;
      resize: vertical; min-height: 36px; outline: none;
    }
    .translation-input:focus { border-color: #4CAF50; }
    .translation-input::placeholder { color: #666; font-style: italic; }
    .action-buttons { display: flex; gap: 4px; flex-shrink: 0; }
    .btn { width: 32px; height: 32px; border: 1px solid #444; border-radius: 4px;
      background: #2d2d2d; cursor: pointer; display: flex; align-items: center;
      justify-content: center; font-size: 14px; transition: all 0.15s; }
    .btn:hover { background: #3d3d3d; border-color: #888; }
    .btn-save:hover { border-color: #4CAF50; }
    .btn-translate:hover { border-color: #2196F3; }
    .btn-delete:hover { border-color: #f48771; }
    .btn.loading { opacity: 0.5; pointer-events: none; }
    .header-actions { display: flex; gap: 8px; margin-top: 10px; }
    .btn-action { padding: 6px 14px; border: 1px solid #444; border-radius: 4px; background: #2d2d2d; cursor: pointer; color: #d4d4d4; font-size: 12px; transition: all 0.15s; display: flex; align-items: center; gap: 4px; }
    .btn-action:hover { background: #3d3d3d; border-color: #888; }
    .btn-fill:hover { border-color: #2196F3; color: #64B5F6; }
    .btn-overwrite:hover { border-color: #FF9800; color: #FFB74D; }
    .btn-action.loading { opacity: 0.5; pointer-events: none; }
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 8px 20px; border-radius: 6px; font-size: 13px; z-index: 9999; transition: opacity 0.3s; pointer-events: none; color: #fff; }
  </style>
</head>
<body>
  <div class="header">
    <div class="key-path">${this.escHtml(key)}</div>
    <div class="stats">
      <span class="stat ok">✅ ${locales.length - missingCount - emptyCount} ${t('editor.translated')}</span>
      ${missingCount > 0 ? `<span class="stat missing">⚠️ ${missingCount} ${t('editor.missing')}</span>` : ''}
      ${emptyCount > 0 ? `<span class="stat empty">⬜ ${emptyCount} ${t('editor.empty')}</span>` : ''}
    </div>
    <div class="header-actions">
      <button class="btn-action btn-fill" onclick="translateMissing()" title="${t('editor.translate_missing')}">🤖 ${t('editor.translate_missing')}</button>
      <button class="btn-action btn-overwrite" onclick="translateAll()" title="${t('editor.translate_all')}">🔄 ${t('editor.translate_all')}</button>
    </div>
  </div>
  <div id="locales">${rows}</div>
  <script>
    const I18N = ${JSON.stringify({
      saving: t('editor.saving'),
      saved: t('editor.saved', '{0}', '{1}'),
      translating: t('editor.translating'),
      translated: t('editor.translated_ok', '{0}', '{1}'),
      openingFile: t('editor.opening_file'),
      currentKey: key,
    })};
    const vscode = acquireVsCodeApi();

    function showToast(msg, type) {
      let toast = document.getElementById('toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.background = type === 'error' ? '#d32f2f' : type === 'warn' ? '#f57c00' : '#388e3c';
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    function setBtnLoading(btn, loading) {
      if (loading) { btn.classList.add('loading'); }
      else { btn.classList.remove('loading'); }
    }

    function saveValue(locale, key) {
      const textarea = document.querySelector(\`textarea[data-locale="\${locale}"][data-key="\${key}"]\`);
      if (!textarea) return;
      const btn = event.currentTarget;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'edit', key, locale, value: textarea.value });
      showToast(I18N.saving);
      setTimeout(() => { setBtnLoading(btn, false); showToast(I18N.saved.replace('{0}', key).replace('{1}', locale)); }, 800);
    }

    function translateKey(locale, key) {
      const btn = event.currentTarget;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'translate', key, locale });
      showToast(I18N.translating);
      setTimeout(() => { setBtnLoading(btn, false); showToast(I18N.translated.replace('{0}', key).replace('{1}', locale)); }, 800);
    }

    function openFile(locale, key) {
      vscode.postMessage({ type: 'openFile', key, locale });
        showToast(I18N.openingFile);
    }

    function deleteKey(locale, key) {
      vscode.postMessage({ type: 'delete', key, locale });
    }

    function translateMissing() {
      const btn = event.currentTarget;
      btn.classList.add('loading');
      vscode.postMessage({ type: 'translateMissing', key: I18N.currentKey });
      setTimeout(() => { btn.classList.remove('loading'); }, 2000);
    }

    function translateAll() {
      const btn = event.currentTarget;
      btn.classList.add('loading');
      vscode.postMessage({ type: 'translateAll', key: I18N.currentKey });
      setTimeout(() => { btn.classList.remove('loading'); }, 2000);
    }

    document.querySelectorAll('.translation-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
          e.preventDefault();
          const locale = input.dataset.locale;
          const key = input.dataset.key;
          saveValue(locale, key);
        }
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'toast') {
        showToast(msg.message, msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warn' : undefined);
      }
    });
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
