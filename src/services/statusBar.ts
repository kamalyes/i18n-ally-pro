import { window, StatusBarItem, StatusBarAlignment, commands } from 'vscode'
import { TranslationStore } from '../core/store'

export class StatusBarService {
  private store: TranslationStore
  private statusBarItem: StatusBarItem
  private listenerAttached = false

  constructor(store: TranslationStore) {
    this.store = store
    this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 50)
    this.statusBarItem.command = 'i18nAllyPro.showDashboard'
    this.statusBarItem.name = 'i18n Ally Pro'
    this.attachListener()
    this.update()
  }

  private attachListener() {
    if (this.listenerAttached) return
    try {
      this.store.on('didChange', () => this.update())
      this.listenerAttached = true
    } catch { /* ignore */ }
  }

  update() {
    try {
      const allKeys = this.store.getAllKeys()
      if (allKeys.length === 0) {
        this.statusBarItem.text = '$(globe) i18n: No keys'
        this.statusBarItem.tooltip = 'i18n Ally Pro: No translation keys found'
        this.statusBarItem.show()
        return
      }

      const locales = this.store.locales
      const sourceLocale = this.store.projectConfig.sourceLanguage

      let totalSlots = 0
      let filledSlots = 0

      for (const locale of locales) {
        for (const key of allKeys) {
          totalSlots++
          const val = this.store.getTranslation(locale, key)
          if (val !== undefined && val !== '') filledSlots++
        }
      }

      const pct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0

      if (pct === 100) {
        this.statusBarItem.text = `$(check) i18n: ${pct}%`
      } else if (pct >= 80) {
        this.statusBarItem.text = `$(globe) i18n: ${pct}%`
      } else {
        this.statusBarItem.text = `$(alert) i18n: ${pct}%`
      }

      const missing = totalSlots - filledSlots
      this.statusBarItem.tooltip = [
        `i18n Ally Pro`,
        `${allKeys.length} keys across ${locales.length} locales`,
        `Source: ${sourceLocale}`,
        `${filledSlots}/${totalSlots} translations complete`,
        `${missing} missing translations`,
        '',
        'Click to open Dashboard',
      ].join('\n')

      this.statusBarItem.show()
    } catch {
      this.statusBarItem.hide()
    }
  }

  dispose() {
    this.statusBarItem.dispose()
  }
}
