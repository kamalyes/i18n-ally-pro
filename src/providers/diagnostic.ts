import {
  Diagnostic, DiagnosticCollection, DiagnosticSeverity, Range, TextDocument, Uri,
  languages, workspace,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { Scanner } from '../core/types'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'

export class I18nDiagnosticProvider {
  private store: TranslationStore
  private collection: DiagnosticCollection
  private scanners: Scanner[]

  constructor(store: TranslationStore) {
    this.store = store
    this.collection = languages.createDiagnosticCollection('i18nAllyPro')
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async validateDocument(document: TextDocument) {
    const diagnostics: Diagnostic[] = []
    const text = document.getText()
    const config = this.store.projectConfig

    for (const scanner of this.scanners) {
      if (!scanner.languageIds.includes(document.languageId)) continue

      const matches = scanner.scan(text, document.uri.fsPath)

      for (const match of matches) {
        const missingLocales: string[] = []
        for (const locale of this.store.locales) {
          const value = this.store.getTranslation(locale, match.key)
          if (value === undefined || value === '')
            missingLocales.push(locale)
        }

        if (missingLocales.length > 0) {
          const range = new Range(
            document.positionAt(match.start),
            document.positionAt(match.end),
          )

          const msg = missingLocales.length === this.store.locales.length
            ? `i18n key "${match.key}" not found in any locale`
            : `i18n key "${match.key}" missing in: ${missingLocales.join(', ')}`

          diagnostics.push(new Diagnostic(
            range,
            msg,
            DiagnosticSeverity.Warning,
          ))
        }
      }
    }

    this.collection.set(document.uri, diagnostics)
  }

  async validateAll() {
    this.collection.clear()

    const config = this.store.projectConfig
    const allDiagnostics = this.store.getDiagnostics()

    for (const file of this.store.getTranslationFiles()) {
      const diagnostics: Diagnostic[] = []

      const missingKeys = allDiagnostics.filter(d => d.type === 'missing' && d.locale === file.locale)
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
