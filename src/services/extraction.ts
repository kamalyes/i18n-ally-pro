import { window, workspace, Uri, WorkspaceEdit, Range, Position } from 'vscode'
import fs from 'fs'
import { TranslationStore } from '../core/store'
import { slug } from '../utils/slug'

export class ExtractionService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async extractText() {
    const editor = window.activeTextEditor
    if (!editor) return

    const selection = editor.selection
    const text = editor.document.getText(selection).trim()
    if (!text) {
      window.showWarningMessage('No text selected')
      return
    }

    const config = this.store.projectConfig
    const suggestedKey = slug(text, config.keystyle === 'nested' ? '.' : '.')

    const key = await window.showInputBox({
      prompt: 'Enter i18n key for the selected text',
      value: suggestedKey,
      validateInput: (v) => {
        if (!v) return 'Key cannot be empty'
        if (/\s/.test(v)) return 'Key cannot contain spaces'
        return null
      },
    })

    if (!key) return

    const sourceLocale = config.sourceLanguage
    await this.store.setTranslation(sourceLocale, key, text)

    for (const locale of this.store.locales) {
      if (locale === sourceLocale) continue
      const existing = this.store.getTranslation(locale, key)
      if (!existing) {
        const translated = await window.showInputBox({
          prompt: `Enter translation for "${key}" in ${locale} (optional)`,
          placeHolder: text,
        })
        if (translated !== undefined)
          await this.store.setTranslation(locale, key, translated)
      }
    }

    const replacement = this.getReplacementCode(key, editor.document.languageId)
    const edit = new WorkspaceEdit()
    edit.replace(editor.document.uri, selection, replacement)
    await workspace.applyEdit(edit)

    window.showInformationMessage(`Extracted "${text}" → "${key}"`)
  }

  private getReplacementCode(key: string, languageId: string): string {
    switch (languageId) {
      case 'go':
        return `i18n.T("${key}")`
      case 'vue':
      case 'html':
        return `{{ $t('${key}') }}`
      case 'javascript':
      case 'typescript':
      case 'javascriptreact':
      case 'typescriptreact':
        return `t('${key}')`
      default:
        return key
    }
  }
}
