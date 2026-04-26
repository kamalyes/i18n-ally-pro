import {
  DefinitionProvider, Location, TextDocument, Position, CancellationToken, Uri,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { Scanner, ScannerMatch } from '../core/types'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'

export class I18nDefinitionProvider implements DefinitionProvider {
  private store: TranslationStore
  private scanners: Scanner[]

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async provideDefinition(document: TextDocument, position: Position, _token: CancellationToken): Promise<Location | Location[] | undefined> {
    const text = document.getText()
    const offset = document.offsetAt(position)

    for (const scanner of this.scanners) {
      if (!scanner.languageIds.includes(document.languageId)) continue

      const matches = scanner.scan(text, document.uri.fsPath)
      const match = matches.find(m => offset >= m.start && offset <= m.end)

      if (match) {
        const config = this.store.projectConfig
        const targetLocale = config.sourceLanguage
        const file = this.store.findFileForKey(match.key, targetLocale)

        if (file) {
          const pos = this.store.findKeyPosition(file.filepath, match.key)
          const targetPos = pos
            ? new Position(pos.line, pos.column)
            : new Position(0, 0)

          return new Location(Uri.file(file.filepath), targetPos)
        }
      }
    }

    return undefined
  }
}
