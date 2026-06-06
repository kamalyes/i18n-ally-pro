import {
  CodeLensProvider, CodeLens, TextDocument, Range, Command,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { scanDocument } from '../scanners/cache'

export class I18nCodeLensProvider implements CodeLensProvider {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const lenses: CodeLens[] = []
    const config = this.store.projectConfig
    const displayLocale = config.displayLanguage || config.sourceLanguage

    for (const match of scanDocument(this.store, document)) {
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

    return lenses
  }
}
