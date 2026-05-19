import { window, Uri, workspace } from 'vscode'
import { TranslationStore } from '../core/store'

interface ExportData {
  version: 1
  exportedAt: string
  sourceLocale: string
  locales: string[]
  translations: Record<string, Record<string, string>>
}

export class ExportImportService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async exportTranslations(): Promise<void> {
    const config = this.store.projectConfig
    const allKeys = this.store.getAllKeys()
    const locales = this.store.locales
    const sourceLocale = config.sourceLanguage

    const translations: Record<string, Record<string, string>> = {}
    for (const locale of locales) {
      translations[locale] = {}
      for (const key of allKeys) {
        const value = this.store.getTranslation(locale, key)
        if (value !== undefined) {
          translations[locale][key] = value
        }
      }
    }

    const data: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceLocale,
      locales,
      translations,
    }

    const json = JSON.stringify(data, null, 2)

    const defaultName = `i18n-export-${new Date().toISOString().slice(0, 10)}.json`
    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(defaultName),
      filters: { 'JSON': ['json'] },
      title: 'Export i18n Translations',
    })

    if (!uri) return

    const { fs } = workspace
    await fs.writeFile(uri, Buffer.from(json, 'utf-8'))

    const totalEntries = Object.values(translations).reduce((sum, t) => sum + Object.keys(t).length, 0)
    window.showInformationMessage(
      `Exported ${totalEntries} translations across ${locales.length} locales to ${uri.path.split('/').pop()}`,
    )
  }

  async importTranslations(): Promise<void> {
    const uris = await window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON': ['json'] },
      title: 'Import i18n Translations',
    })

    if (!uris || uris.length === 0) return

    const uri = uris[0]
    const { fs } = workspace
    const content = await fs.readFile(uri)
    const text = new TextDecoder('utf-8').decode(content)

    let data: ExportData
    try {
      data = JSON.parse(text)
    } catch {
      window.showErrorMessage('Invalid JSON file. Please select a valid i18n export file.')
      return
    }

    if (!data.version || !data.translations) {
      window.showErrorMessage('Invalid i18n export format. Missing "version" or "translations" field.')
      return
    }

    const existingLocales = this.store.locales
    const importLocales = Object.keys(data.translations)

    // Ask import mode
    const mode = await window.showQuickPick(
      [
        {
          label: 'Merge (keep existing, add new)',
          description: 'Existing translations are preserved, only missing ones are added',
          value: 'merge' as const,
        },
        {
          label: 'Overwrite (replace existing)',
          description: 'Existing translations are replaced with imported values',
          value: 'overwrite' as const,
        },
      ],
      { placeHolder: 'Select import mode' },
    )

    if (!mode) return

    // Ask which locales to import
    const localeItems = importLocales.map(locale => ({
      label: locale,
      description: existingLocales.includes(locale) ? 'existing locale' : 'new locale',
      picked: true,
    }))

    const selectedLocales = await window.showQuickPick(localeItems, {
      canPickMany: true,
      placeHolder: 'Select locales to import',
    })

    if (!selectedLocales || selectedLocales.length === 0) return

    let imported = 0
    let skipped = 0

    await window.withProgress(
      {
        location: undefined as any,
        title: 'i18n Pro: Importing translations',
        cancellable: false,
      },
      async () => {
        for (const localeItem of selectedLocales) {
          const locale = localeItem.label
          const translations = data.translations[locale]
          if (!translations) continue

          for (const [key, value] of Object.entries(translations)) {
            const existing = this.store.getTranslation(locale, key)

            if (mode.value === 'merge') {
              if (existing !== undefined && existing !== '') {
                skipped++
                continue
              }
            }

            try {
              await this.store.setTranslation(locale, key, value)
              imported++
            } catch {
              skipped++
            }
          }
        }
      },
    )

    window.showInformationMessage(
      `Imported ${imported} translations${skipped > 0 ? ` (${skipped} skipped)` : ''} from ${uri.path.split('/').pop()}`,
    )
  }
}
