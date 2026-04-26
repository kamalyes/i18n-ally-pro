import {
  HoverProvider, Hover, TextDocument, Position, CancellationToken,
  MarkdownString, languages, workspace, Uri, window, ViewColumn,
  Position as VPosition, Range, Selection,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { Scanner } from '../core/types'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'
import { getLocaleFlag, getLocaleName } from '../i18n'

export class I18nHoverProvider implements HoverProvider {
  private store: TranslationStore
  private scanners: Scanner[]

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async provideHover(document: TextDocument, position: Position, _token: CancellationToken): Promise<Hover | undefined> {
    const text = document.getText()
    const offset = document.offsetAt(position)

    for (const scanner of this.scanners) {
      if (!scanner.languageIds.includes(document.languageId)) continue

      const matches = scanner.scan(text, document.uri.fsPath)
      const match = matches.find(m => offset >= m.start && offset <= m.end)

      if (match) {
        return this.createHover(match.key)
      }
    }

    if (document.languageId === 'json' || document.languageId === 'jsonc') {
      const jsonHover = this.provideJsonHover(document, position, text, offset)
      if (jsonHover) return jsonHover
    }

    return undefined
  }

  private provideJsonHover(document: TextDocument, position: Position, text: string, offset: number): Hover | undefined {
    const translationFiles = this.store.getTranslationFiles()
    const currentFile = translationFiles.find(f => f.filepath === document.uri.fsPath)
    if (!currentFile) return undefined

    const locale = currentFile.locale
    const keyPath = this.findKeyAtPosition(text, offset, this.store.projectConfig.keystyle || 'flat')
    if (!keyPath) return undefined

    const value = this.store.getTranslation(locale, keyPath)
    if (value === undefined) return undefined

    return this.createJsonHover(keyPath, locale)
  }

  private findKeyAtPosition(text: string, offset: number, keyStyle: string): string | null {
    const lines = text.split('\n')
    let charCount = 0

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]
      if (charCount + line.length + 1 <= offset) {
        charCount += line.length + 1
        continue
      }

      const keyStack: string[] = []
      let inKey = false
      let currentKey = ''
      let inString = false
      let escapeNext = false

      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (escapeNext) { escapeNext = false; continue }
        if (ch === '\\') { escapeNext = true; continue }

        if (ch === '"' && !inString) {
          inString = true
          currentKey = ''
          continue
        }
        if (ch === '"' && inString) {
          inString = false
          continue
        }
      }

      const lineOffset = offset - charCount
      const beforeCursor = line.substring(0, lineOffset)
      const afterCursor = line.substring(lineOffset)

      const keyMatch = beforeCursor.match(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"$/)
      const valueMatch = beforeCursor.match(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)$/)
      const keyOnlyMatch = beforeCursor.match(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*$/)

      if (valueMatch || keyMatch) {
        const key = (valueMatch || keyMatch)![1]
        if (keyStyle === 'nested') {
          return this.findNestedKeyFromLine(lines, lineIdx, key)
        }
        return key
      }

      if (keyOnlyMatch) {
        const key = keyOnlyMatch[1]
        if (keyStyle === 'nested') {
          return this.findNestedKeyFromLine(lines, lineIdx, key)
        }
        return key
      }

      break
    }

    return null
  }

  private findNestedKeyFromLine(lines: string[], targetLine: number, leafKey: string): string {
    const parts: string[] = [leafKey]
    const indentStack: { indent: number; key: string }[] = []

    for (let i = 0; i <= targetLine; i++) {
      const line = lines[i]
      const indent = line.search(/\S/)
      if (indent === -1) continue

      const keyMatch = line.match(/^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/)
      if (!keyMatch) continue

      const key = keyMatch[1]

      while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
        indentStack.pop()
      }

      indentStack.push({ indent, key })
    }

    for (const item of indentStack) {
      parts.push(item.key)
    }

    if (parts.length <= 1) return leafKey

    const allButLast = parts.slice(1)
    return allButLast.join('.')
  }

  private createHover(key: string): Hover {
    const contents = new MarkdownString()
    contents.isTrusted = true

    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage
    const displayLocale = config.displayLanguage || sourceLocale
    const allLocales = this.store.locales

    const missingLocales = allLocales.filter(l => {
      const v = this.store.getTranslation(l, key)
      return v === undefined || v === ''
    })

    contents.appendMarkdown(`### 🌐 \`${key}\`\n\n`)

    contents.appendMarkdown('| | Locale | Value |\n')
    contents.appendMarkdown('|:---:|:---:|:---|\n')

    const orderedLocales = [displayLocale, ...allLocales.filter(l => l !== displayLocale)]
    for (const locale of orderedLocales) {
      const value = this.store.getTranslation(locale, key)
      const flag = getLocaleFlag(locale)
      const isSource = locale === sourceLocale
      const isMissing = value === undefined || value === ''

      const localeLabel = isSource ? `**${locale}**` : locale
      const displayValue = isMissing
        ? '⚠️ *(missing)*'
        : `\`${value!.length > 50 ? value!.slice(0, 50) + '…' : value!}\``

      contents.appendMarkdown(`| ${flag} | ${localeLabel} | ${displayValue} |\n`)
    }

    contents.appendMarkdown('\n---\n')

    contents.appendMarkdown(
      `[📝 Open Editor](command:i18nAllyPro.openKeyEditor?${encodeURIComponent(JSON.stringify([key]))})`,
    )

    if (missingLocales.length > 0) {
      contents.appendMarkdown(' · ')
      contents.appendMarkdown(
        `[🤖 Translate Missing](command:i18nAllyPro.inlineTranslate?${encodeURIComponent(JSON.stringify([key, missingLocales]))})`,
      )
    }

    contents.appendMarkdown(' · ')
    contents.appendMarkdown(
      `[📂 Go to Definition](command:i18nAllyPro.openTranslation?${encodeURIComponent(JSON.stringify([key]))})`,
    )

    if (missingLocales.length > 0) {
      contents.appendMarkdown(`\n\n⚠️ Missing in: **${missingLocales.join(', ')}**`)
    }

    return new Hover(contents)
  }

  private createJsonHover(key: string, currentLocale: string): Hover {
    const contents = new MarkdownString()
    contents.isTrusted = true

    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage
    const allLocales = this.store.locales

    const missingLocales = allLocales.filter(l => {
      const v = this.store.getTranslation(l, key)
      return v === undefined || v === ''
    })

    const flag = getLocaleFlag(currentLocale)
    const name = getLocaleName(currentLocale)
    contents.appendMarkdown(`### ${flag} \`${key}\`\n\n`)
    contents.appendMarkdown(`**Current:** ${name} (${currentLocale})\n\n`)

    contents.appendMarkdown('| | Locale | Value | Edit |\n')
    contents.appendMarkdown('|:---:|:---:|:---|:---:|\n')

    const orderedLocales = [sourceLocale, ...allLocales.filter(l => l !== sourceLocale)]
    for (const locale of orderedLocales) {
      const value = this.store.getTranslation(locale, key)
      const lFlag = getLocaleFlag(locale)
      const lName = getLocaleName(locale)
      const isSource = locale === sourceLocale
      const isMissing = value === undefined || value === ''
      const isCurrent = locale === currentLocale

      const localeLabel = isSource ? `**${locale}**` : locale
      const displayValue = isMissing
        ? '⚠️ *(missing)*'
        : `\`${value!.length > 40 ? value!.slice(0, 40) + '…' : value!}\``

      const editCmd = `[\✏️](command:i18nAllyPro.inlineEdit?${encodeURIComponent(JSON.stringify([key, locale]))})`
      const goCmd = isCurrent ? '' : ` [\📂](command:i18nAllyPro.openKeyAndFile?${encodeURIComponent(JSON.stringify([key, locale]))})`

      contents.appendMarkdown(`| ${lFlag} | ${localeLabel} | ${displayValue} | ${editCmd}${goCmd} |\n`)
    }

    contents.appendMarkdown('\n---\n')

    contents.appendMarkdown(
      `[📝 Open Editor](command:i18nAllyPro.openKeyEditor?${encodeURIComponent(JSON.stringify([key]))})`,
    )

    if (missingLocales.length > 0) {
      contents.appendMarkdown(' · ')
      contents.appendMarkdown(
        `[🤖 Translate Missing](command:i18nAllyPro.inlineTranslate?${encodeURIComponent(JSON.stringify([key, missingLocales]))})`,
      )
    }

    if (missingLocales.length > 0) {
      contents.appendMarkdown(`\n\n⚠️ Missing in: ${missingLocales.map(l => `${getLocaleFlag(l)} ${l}`).join(', ')}`)
    }

    return new Hover(contents)
  }
}
