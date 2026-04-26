import {
  CodeLensProvider, CodeLens, TextDocument, Range, Command,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { Scanner } from '../core/types'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'

export class I18nCodeLensProvider implements CodeLensProvider {
  private store: TranslationStore
  private scanners: Scanner[]

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const lenses: CodeLens[] = []
    const text = document.getText()
    const config = this.store.projectConfig
    const displayLocale = config.displayLanguage || config.sourceLanguage

    for (const scanner of this.scanners) {
      if (!scanner.languageIds.includes(document.languageId)) continue

      const matches = scanner.scan(text, document.uri.fsPath)

      for (const match of matches) {
        const value = this.store.getTranslation(displayLocale, match.key)
        if (value === undefined) continue

        const range = new Range(
          document.positionAt(match.start),
          document.positionAt(match.end),
        )

        lenses.push(new CodeLens(range, {
          title: value.length > 40 ? value.slice(0, 40) + '...' : value,
          command: 'i18nAllyPro.openTranslation',
          arguments: [match.key],
        } as Command))
      }
    }

    return lenses
  }
}
