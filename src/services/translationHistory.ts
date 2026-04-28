import { TranslationStore } from '../core/store'

interface HistoryEntry {
  timestamp: number
  action: string
  locale: string
  key: string
  oldValue: string | undefined
  newValue: string | undefined
}

const MAX_HISTORY = 200

export class TranslationHistoryService {
  private store: TranslationStore
  private history: HistoryEntry[] = []

  constructor(store: TranslationStore) {
    this.store = store
  }

  record(action: string, locale: string, key: string, oldValue: string | undefined, newValue: string | undefined) {
    this.history.push({
      timestamp: Date.now(),
      action,
      locale,
      key,
      oldValue,
      newValue,
    })
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY)
    }
  }

  async undo(): Promise<boolean> {
    if (this.history.length === 0) return false

    const entry = this.history.pop()!
    try {
      if (entry.oldValue === undefined) {
        await this.store.deleteTranslation(entry.locale, entry.key)
      } else {
        await this.store.setTranslation(entry.locale, entry.key, entry.oldValue)
      }
      return true
    } catch {
      return false
    }
  }

  getHistory(): readonly HistoryEntry[] {
    return this.history
  }

  canUndo(): boolean {
    return this.history.length > 0
  }

  clear() {
    this.history = []
  }
}
