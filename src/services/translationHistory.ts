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
  /** undo 期间不记历史，否则撤销本身会被压回栈里 */
  private undoing = false

  constructor(store: TranslationStore) {
    this.store = store
  }

  record(action: string, locale: string, key: string, oldValue: string | undefined, newValue: string | undefined) {
    if (this.undoing) return

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
    // 回滚写入会再次触发 store 的 record；不屏蔽的话新条目会被压进栈，
    // 连续两次 undo 就变成「撤销 → 重做」，而不是继续往前撤
    this.undoing = true
    try {
      if (entry.oldValue === undefined) {
        await this.store.deleteTranslation(entry.locale, entry.key)
      } else {
        await this.store.setTranslation(entry.locale, entry.key, entry.oldValue)
      }
      return true
    } catch {
      return false
    } finally {
      this.undoing = false
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
