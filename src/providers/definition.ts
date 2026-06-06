import {
  DefinitionProvider, Location, TextDocument, Position, CancellationToken, Uri,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { findMatchAt, scanDocument } from '../scanners/cache'

export class I18nDefinitionProvider implements DefinitionProvider {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async provideDefinition(document: TextDocument, position: Position, _token: CancellationToken): Promise<Location | Location[] | undefined> {
    const offset = document.offsetAt(position)
    const match = findMatchAt(scanDocument(this.store, document), offset)
    if (!match) return undefined

    const targetLocale = this.store.projectConfig.sourceLanguage
    const file = this.store.findFileForKey(match.key, targetLocale)
    if (!file) return undefined

    const pos = this.store.findKeyPosition(file.filepath, match.key)
    const targetPos = pos
      ? new Position(pos.line, pos.column)
      : new Position(0, 0)

    return new Location(Uri.file(file.filepath), targetPos)
  }
}
