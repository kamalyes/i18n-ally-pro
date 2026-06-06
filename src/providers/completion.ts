import {
  CompletionItemProvider, CompletionItem, CompletionItemKind,
  TextDocument, Position, CancellationToken, CompletionContext,
  Range, MarkdownString, SnippetString,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag } from '../i18n'

export class I18nCompletionProvider implements CompletionItemProvider {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  provideCompletionItems(
    document: TextDocument,
    position: Position,
    _token: CancellationToken,
    _context: CompletionContext,
  ): CompletionItem[] {
    const linePrefix = document.lineAt(position).text.substring(0, position.character)

    if (!this.isInI18nContext(linePrefix, document.languageId)) return []

    const allKeys = this.store.getAllKeys()
    const sourceLocale = this.store.projectConfig.sourceLanguage
    const displayLocale = this.store.projectConfig.displayLanguage || sourceLocale

    // 替换范围只跟光标位置有关，每个候选项重复算一次纯属浪费
    const prefix = this.getTriggerPrefix(linePrefix, document.languageId)
    const replaceRange = prefix
      ? new Range(position.translate(0, -prefix.length), position)
      : undefined

    return allKeys.map(key => {
      const item = new CompletionItem(key, CompletionItemKind.Value)
      item.detail = this.store.getTranslation(displayLocale, key) || this.store.getTranslation(sourceLocale, key) || ''
      if (replaceRange) item.range = replaceRange
      item.insertText = new SnippetString(key)
      item.sortText = this.getSortText(key)
      // documentation 是每个语言一行的表格，几千个 key 全量构建会让每次按键都卡顿；
      // 交给 resolveCompletionItem 在候选项真正被选中/预览时再建
      return item
    })
  }

  resolveCompletionItem(item: CompletionItem, _token: CancellationToken): CompletionItem {
    const key = typeof item.label === 'string' ? item.label : item.label.label
    if (!item.documentation)
      item.documentation = this.buildDocumentation(key)
    return item
  }

  private buildDocumentation(key: string): MarkdownString {
    const doc = new MarkdownString()
    doc.isTrusted = true
    doc.appendMarkdown(`### 🌐 \`${key}\`\n\n`)
    doc.appendMarkdown('| | Locale | Value |\n')
    doc.appendMarkdown('|:---:|:---:|:---|\n')
    for (const locale of this.store.locales) {
      const flag = getLocaleFlag(locale)
      const val = this.store.getTranslation(locale, key)
      doc.appendMarkdown(`| ${flag} | ${locale} | ${val !== undefined ? val : '—'} |\n`)
    }
    return doc
  }

  private isInI18nContext(linePrefix: string, languageId: string): boolean {
    if (languageId === 'go') {
      return /i18n\s*\.\s*(T|GetMessage|Translate)\s*\(\s*["']\w*$/.test(linePrefix)
        || /(?:GetMessage|T)\s*\(\s*["']\w*$/.test(linePrefix)
    }
    if (languageId === 'vue' || languageId === 'html') {
      return /\$t\s*\(\s*['"`]\w*$/.test(linePrefix)
        || /(?:i18n|t)\s*\.\s*t\s*\(\s*['"`]\w*$/.test(linePrefix)
    }
    if (['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(languageId)) {
      return /t\s*\(\s*['"`]\w*$/.test(linePrefix)
        || /i18n(?:next)?\s*\.\s*t\s*\(\s*['"`]\w*$/.test(linePrefix)
    }
    return false
  }

  private getTriggerPrefix(linePrefix: string, languageId: string): string {
    if (languageId === 'go') {
      const m = linePrefix.match(/["'](\w*)$/)
      return m ? m[1] : ''
    }
    const m = linePrefix.match(/['"`](\w*)$/)
    return m ? m[1] : ''
  }

  private getSortText(key: string): string {
    const val = this.store.getTranslation(this.store.projectConfig.sourceLanguage, key)
    if (val === undefined || val === '') return `2_${key}`
    return `1_${key}`
  }
}
