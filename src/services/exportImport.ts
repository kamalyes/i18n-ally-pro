import { window, Uri, workspace } from 'vscode'
import { TranslationStore } from '../core/store'
import { t } from '../i18n'

type ExportFormat = 'json' | 'csv' | 'xlsx'
type ImportFormat = 'json' | 'csv' | 'xlsx' | 'auto'

interface ExportData {
  version: 1
  exportedAt: string
  sourceLocale: string
  locales: string[]
  translations: Record<string, Record<string, string>>
}

interface ParsedTranslations {
  locales: string[]
  translations: Record<string, Record<string, string>>
}

export class ExportImportService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  // ==================== Export ====================

  async exportTranslations(): Promise<void> {
    const format = await window.showQuickPick(
      [
        { label: 'JSON', description: t('export.json_desc'), value: 'json' as ExportFormat },
        { label: 'CSV', description: t('export.csv_desc'), value: 'csv' as ExportFormat },
        { label: 'XLSX (Excel)', description: t('export.xlsx_desc'), value: 'xlsx' as ExportFormat },
      ],
      { placeHolder: t('export.pick_format'), title: t('export.title') },
    )
    if (!format) return

    const allKeys = this.store.getAllKeys()
    const locales = this.store.locales
    const sourceLocale = this.store.projectConfig.sourceLanguage

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

    const dateStr = new Date().toISOString().slice(0, 10)
    let uri: Uri | undefined
    let buffer: Buffer

    switch (format.value) {
      case 'json': {
        const data: ExportData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          sourceLocale,
          locales,
          translations,
        }
        buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8')
        uri = await window.showSaveDialog({
          defaultUri: Uri.file(`i18n-export-${dateStr}.json`),
          filters: { 'JSON': ['json'] },
          title: t('export.title'),
        })
        break
      }
      case 'csv': {
        const csv = this.generateCsv(allKeys, locales, translations)
        buffer = Buffer.from('\uFEFF' + csv, 'utf-8')
        uri = await window.showSaveDialog({
          defaultUri: Uri.file(`i18n-export-${dateStr}.csv`),
          filters: { 'CSV': ['csv'] },
          title: t('export.title'),
        })
        break
      }
      case 'xlsx': {
        const xlsxBuffer = await this.generateXlsx(allKeys, locales, translations)
        buffer = xlsxBuffer
        uri = await window.showSaveDialog({
          defaultUri: Uri.file(`i18n-export-${dateStr}.xlsx`),
          filters: { 'Excel': ['xlsx'] },
          title: t('export.title'),
        })
        break
      }
    }

    if (!uri) return

    const { fs } = workspace
    await fs.writeFile(uri, buffer)

    const totalEntries = Object.values(translations).reduce((sum, tr) => sum + Object.keys(tr).length, 0)
    window.showInformationMessage(t('export.success', String(totalEntries), String(locales.length), uri.path.split('/').pop()!))
  }

  private generateCsv(allKeys: string[], locales: string[], translations: Record<string, Record<string, string>>): string {
    const header = ['Key', ...locales].join(',')
    const rows = allKeys.map(key => {
      const cells = [key, ...locales.map(l => {
        const val = translations[l]?.[key] || ''
        return `"${val.replace(/"/g, '""')}"`
      })]
      return cells.join(',')
    })
    return [header, ...rows].join('\n')
  }

  private async generateXlsx(allKeys: string[], locales: string[], translations: Record<string, Record<string, string>>): Promise<Buffer> {
    const XLSX = await import('xlsx')
    const header = ['Key', ...locales]
    const rows = allKeys.map(key => {
      return [key, ...locales.map(l => translations[l]?.[key] || '')]
    })
    const wsData = [header, ...rows]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Set column widths
    ws['!cols'] = [
      { wch: 40 }, // Key column
      ...locales.map(() => ({ wch: 30 })),
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Translations')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return Buffer.from(buf)
  }

  // ==================== Import ====================

  async importTranslations(): Promise<void> {
    const uris = await window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'All Supported': ['json', 'csv', 'xlsx'],
        'JSON': ['json'],
        'CSV': ['csv'],
        'Excel': ['xlsx'],
      },
      title: t('import.title'),
    })

    if (!uris || uris.length === 0) return

    const uri = uris[0]
    const ext = uri.path.split('.').pop()?.toLowerCase() || ''

    let parsed: ParsedTranslations

    try {
      switch (ext) {
        case 'json':
          parsed = await this.parseJson(uri)
          break
        case 'csv':
          parsed = await this.parseCsv(uri)
          break
        case 'xlsx':
          parsed = await this.parseXlsx(uri)
          break
        default:
          // Auto-detect: try JSON first, then CSV, then XLSX
          parsed = await this.autoDetectAndParse(uri)
      }
    } catch (err: any) {
      window.showErrorMessage(t('import.parse_failed', err.message))
      return
    }

    if (!parsed.locales.length || !Object.keys(parsed.translations).length) {
      window.showWarningMessage(t('import.no_data'))
      return
    }

    await this.doImport(parsed, uri.path.split('/').pop() || 'file')
  }

  private async parseJson(uri: Uri): Promise<ParsedTranslations> {
    const { fs } = workspace
    const content = await fs.readFile(uri)
    const text = new TextDecoder('utf-8').decode(content)

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(t('import.invalid_json'))
    }

    // Format 1: ExportData with version/translations fields
    if (data.version && data.translations) {
      return {
        locales: data.locales || Object.keys(data.translations),
        translations: data.translations,
      }
    }

    // Format 2: Direct locale-key structure { "en": { "key": "value" }, "zh": { ... } }
    if (typeof data === 'object' && !Array.isArray(data)) {
      const locales = Object.keys(data)
      const translations: Record<string, Record<string, string>> = {}
      for (const locale of locales) {
        if (typeof data[locale] === 'object' && data[locale] !== null) {
          translations[locale] = {}
          for (const [key, value] of Object.entries(data[locale])) {
            if (typeof value === 'string') {
              translations[locale][key] = value
            }
          }
        }
      }
      return { locales: Object.keys(translations), translations }
    }

    throw new Error(t('import.invalid_json'))
  }

  private async parseCsv(uri: Uri): Promise<ParsedTranslations> {
    const { fs } = workspace
    const content = await fs.readFile(uri)
    let text = new TextDecoder('utf-8').decode(content)
    // Remove BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

    const lines = this.parseCsvLines(text)
    if (lines.length < 2) throw new Error(t('import.invalid_csv'))

    const header = lines[0]
    const locales = header.slice(1) // First column is "Key"
    const translations: Record<string, Record<string, string>> = {}
    for (const locale of locales) {
      translations[locale] = {}
    }

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i]
      if (!row.length || !row[0]) continue
      const key = row[0]
      for (let j = 1; j < row.length && j <= locales.length; j++) {
        const locale = locales[j - 1]
        if (row[j] !== undefined && row[j] !== '') {
          translations[locale][key] = row[j]
        }
      }
    }

    return { locales, translations }
  }

  private parseCsvLines(text: string): string[][] {
    const result: string[][] = []
    let current: string[] = []
    let cell = ''
    let inQuotes = false

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      const next = text[i + 1]

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"'
          i++
        } else if (ch === '"') {
          inQuotes = false
        } else {
          cell += ch
        }
      } else {
        if (ch === '"') {
          inQuotes = true
        } else if (ch === ',') {
          current.push(cell)
          cell = ''
        } else if (ch === '\r' && next === '\n') {
          current.push(cell)
          cell = ''
          result.push(current)
          current = []
          i++
        } else if (ch === '\n') {
          current.push(cell)
          cell = ''
          result.push(current)
          current = []
        } else {
          cell += ch
        }
      }
    }
    if (cell || current.length) {
      current.push(cell)
      result.push(current)
    }

    return result
  }

  private async parseXlsx(uri: Uri): Promise<ParsedTranslations> {
    const XLSX = await import('xlsx')
    const { fs } = workspace
    const content = await fs.readFile(uri)
    const wb = XLSX.read(Buffer.from(content), { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

    if (data.length < 2) throw new Error(t('import.invalid_xlsx'))

    const header = data[0] as string[]
    const locales = header.slice(1)
    const translations: Record<string, Record<string, string>> = {}
    for (const locale of locales) {
      translations[locale] = {}
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i] as any[]
      if (!row || !row[0]) continue
      const key = String(row[0])
      for (let j = 1; j < row.length && j <= locales.length; j++) {
        const locale = locales[j - 1]
        const val = row[j]
        if (val !== undefined && val !== null && String(val) !== '') {
          translations[locale][key] = String(val)
        }
      }
    }

    return { locales, translations }
  }

  private async autoDetectAndParse(uri: Uri): Promise<ParsedTranslations> {
    const ext = uri.path.split('.').pop()?.toLowerCase() || ''
    if (ext === 'csv') return this.parseCsv(uri)
    if (ext === 'xlsx') return this.parseXlsx(uri)
    // Default try JSON
    try {
      return await this.parseJson(uri)
    } catch {
      // Try CSV
      try {
        return await this.parseCsv(uri)
      } catch {
        throw new Error(t('import.unsupported_format'))
      }
    }
  }

  private async doImport(parsed: ParsedTranslations, fileName: string): Promise<void> {
    const existingLocales = this.store.locales
    const importLocales = parsed.locales.filter(l => Object.keys(parsed.translations[l] || {}).length > 0)

    if (importLocales.length === 0) {
      window.showWarningMessage(t('import.no_data'))
      return
    }

    // Ask import mode
    const mode = await window.showQuickPick(
      [
        {
          label: t('import.mode_merge'),
          description: t('import.mode_merge_desc'),
          value: 'merge' as const,
        },
        {
          label: t('import.mode_overwrite'),
          description: t('import.mode_overwrite_desc'),
          value: 'overwrite' as const,
        },
      ],
      { placeHolder: t('import.pick_mode') },
    )

    if (!mode) return

    // Ask which locales to import
    const localeItems = importLocales.map(locale => ({
      label: locale,
      description: existingLocales.includes(locale) ? t('import.existing_locale') : t('import.new_locale'),
      picked: true,
    }))

    const selectedLocales = await window.showQuickPick(localeItems, {
      canPickMany: true,
      placeHolder: t('import.pick_locales'),
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
          const translations = parsed.translations[locale]
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

    window.showInformationMessage(t('import.success', String(imported), String(skipped), fileName))
  }
}
