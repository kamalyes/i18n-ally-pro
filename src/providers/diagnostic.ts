import {
  Diagnostic, DiagnosticCollection, DiagnosticSeverity, Range, TextDocument, Uri,
  languages, workspace,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { DiagnosticInfo } from '../core/types'
import { scanDocument } from '../scanners/cache'

export class I18nDiagnosticProvider {
  private store: TranslationStore
  private collection: DiagnosticCollection

  constructor(store: TranslationStore) {
    this.store = store
    this.collection = languages.createDiagnosticCollection('i18nAllyPro')
  }

  async validateDocument(document: TextDocument) {
    const diagnostics: Diagnostic[] = []
    // 槽位只跟语言集合有关，提到循环外算一次（原来每个匹配都要重建一遍）
    const slots = this.store.getValidationLocaleSlots()
    /** 同一文件里同名 key 往往出现多次，缺失语言的判定结果可以复用 */
    const missingByKey = new Map<string, string[]>()

    for (const match of scanDocument(this.store, document)) {
      let missingLocales = missingByKey.get(match.key)
      if (!missingLocales) {
        missingLocales = []
        for (const { locales } of slots) {
          const filled = locales.some(locale => {
            const value = this.store.getTranslationInLocaleGroup(locale, match.key)
            return value !== undefined && value !== ''
          })
          if (!filled) missingLocales.push(locales[0])
        }
        missingByKey.set(match.key, missingLocales)
      }

      if (missingLocales.length === 0) continue

      const range = new Range(
        document.positionAt(match.start),
        document.positionAt(match.end),
      )

      const msg = missingLocales.length === slots.length
        ? `i18n key "${match.key}" not found in any locale`
        : `i18n key "${match.key}" missing in: ${missingLocales.join(', ')}`

      diagnostics.push(new Diagnostic(range, msg, DiagnosticSeverity.Warning))
    }

    this.collection.set(document.uri, diagnostics)
  }

  async validateAll() {
    this.collection.clear()

    // 按 locale 分组一次，避免每个文件都在全量诊断上 filter
    const missingByLocale = new Map<string, DiagnosticInfo[]>()
    for (const diag of this.store.getDiagnostics()) {
      if (diag.type !== 'missing' || !diag.locale) continue
      const list = missingByLocale.get(diag.locale)
      if (list) list.push(diag)
      else missingByLocale.set(diag.locale, [diag])
    }

    for (const file of this.store.getTranslationFiles()) {
      const diagnostics: Diagnostic[] = []

      const missingKeys = missingByLocale.get(file.locale) ?? []
      for (const diag of missingKeys) {
        const pos = this.store.findKeyPosition(file.filepath, diag.key)
        const range = pos
          ? new Range(pos.line, pos.column, pos.line, pos.column + diag.key.length)
          : new Range(0, 0, 0, 0)

        diagnostics.push(new Diagnostic(
          range,
          `Missing translation for key "${diag.key}" in ${diag.locale}`,
          DiagnosticSeverity.Information,
        ))
      }

      if (diagnostics.length > 0)
        this.collection.set(Uri.file(file.filepath), diagnostics)
    }
  }

  dispose() {
    this.collection.dispose()
  }
}
