import { window, workspace, ProgressLocation } from 'vscode'
import fs from 'fs'
import path from 'path'
import fg from 'fast-glob'
import { TranslationStore } from '../core/store'
import { ErrorCodeSyncService } from './errorCodeSync'
import { TranslatorService } from './translator'
import { SUPPORTED_LOCALES, SupportedLocale, LOCALE_NAMES, getIgnoreDirs } from '../core/constants'

export { SUPPORTED_LOCALES, SupportedLocale, LOCALE_NAMES }

export interface InitLocalesResult {
  createdFiles: number
  updatedFiles: number
  skippedFiles: number
  totalKeys: number
  translatedKeys: number
  locales: string[]
}

export interface CompleteKeysResult {
  completed: number
  translated: number
  skipped: number
  errors: number
}

export class LocaleInitService {
  private store: TranslationStore
  private errorCodeSync: ErrorCodeSyncService
  private translatorService: TranslatorService | null = null

  constructor(store: TranslationStore, translatorService?: TranslatorService) {
    this.store = store
    this.errorCodeSync = new ErrorCodeSyncService(store)
    this.translatorService = translatorService || null
  }

  setTranslatorService(translatorService: TranslatorService) {
    this.translatorService = translatorService
  }

  private canTranslate(): boolean {
    if (!this.translatorService) return false
    const config = this.translatorService.getConfig()
    return !!config.apiKey || config.engine === 'deepl-web'
  }

  async initLocalesFromGo(): Promise<InitLocalesResult> {
    const rootPath = this.store.projectConfig.rootPath
    const localesPaths = this.store.projectConfig.localesPaths

    if (localesPaths.length === 0) {
      window.showErrorMessage('No locales directory configured. Please set i18nAllyPro.localesPaths or let auto-detection find it.')
      return { createdFiles: 0, updatedFiles: 0, skippedFiles: 0, totalKeys: 0, translatedKeys: 0, locales: [] }
    }

    const localesDir = path.resolve(rootPath, localesPaths[0])
    if (!fs.existsSync(localesDir)) {
      fs.mkdirSync(localesDir, { recursive: true })
    }

    const goKeys = await this.scanAllGoKeys(rootPath)
    if (goKeys.size === 0) {
      window.showWarningMessage('No i18n keys found in Go files. Make sure your Go files contain i18n constant definitions like: BizErrCodeXxx = "error.xxx.yyy"')
      return { createdFiles: 0, updatedFiles: 0, skippedFiles: 0, totalKeys: 0, translatedKeys: 0, locales: [] }
    }

    const sortedKeys = Array.from(goKeys).sort()
    const sourceLanguage = this.store.projectConfig.sourceLanguage || 'en'
    const existingTranslations = this.store.getAllTranslations()

    let createdFiles = 0
    let updatedFiles = 0
    let skippedFiles = 0
    let translatedKeys = 0

    const shouldTranslate = this.canTranslate()

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Initializing locale files from Go',
        cancellable: true,
      },
      async (progress) => {
        let current = 0
        const total = SUPPORTED_LOCALES.length

        for (const locale of SUPPORTED_LOCALES) {
          current++
          progress.report({
            message: `[${current}/${total}] Processing ${locale} (${LOCALE_NAMES[locale] || locale})`,
            increment: 100 / total,
          })

          const filePath = path.join(localesDir, `${locale}.json`)

          if (fs.existsSync(filePath)) {
            const existingData = this.readLocaleFile(filePath)
            const missingKeys = sortedKeys.filter(k => existingData[k] === undefined)

            if (missingKeys.length === 0) {
              skippedFiles++
              continue
            }

            for (const key of missingKeys) {
              existingData[key] = ''
            }

            const sortedData = this.sortObjectKeys(existingData)
            fs.writeFileSync(filePath, JSON.stringify(sortedData, null, 2) + '\n', 'utf-8')
            updatedFiles++

            if (shouldTranslate && this.translatorService) {
              for (const key of missingKeys) {
                const sourceValue = existingTranslations[sourceLanguage]?.[key]
                if (sourceValue && sourceValue !== '') {
                  try {
                    const translated = await this.translatorService.translateText(sourceValue, sourceLanguage, locale)
                    if (translated) {
                      existingData[key] = translated
                      const sortedAgain = this.sortObjectKeys(existingData)
                      fs.writeFileSync(filePath, JSON.stringify(sortedAgain, null, 2) + '\n', 'utf-8')
                      translatedKeys++
                    }
                  } catch { /* translation failed, keep empty */ }
                }
              }
            }
          } else {
            const localeData: Record<string, string> = {}

            for (const key of sortedKeys) {
              const existingValue = existingTranslations[locale]?.[key]
              if (existingValue !== undefined && existingValue !== '') {
                localeData[key] = existingValue
              } else if (locale === sourceLanguage && existingTranslations[sourceLanguage]?.[key] !== undefined) {
                localeData[key] = existingTranslations[sourceLanguage][key]
              } else {
                localeData[key] = ''
              }
            }

            const sortedData = this.sortObjectKeys(localeData)
            fs.writeFileSync(filePath, JSON.stringify(sortedData, null, 2) + '\n', 'utf-8')
            createdFiles++

            if (shouldTranslate && this.translatorService && locale !== sourceLanguage) {
              for (const key of sortedKeys) {
                if (localeData[key] !== '') continue
                const sourceValue = existingTranslations[sourceLanguage]?.[key]
                if (sourceValue && sourceValue !== '') {
                  try {
                    const translated = await this.translatorService.translateText(sourceValue, sourceLanguage, locale)
                    if (translated) {
                      localeData[key] = translated
                      const sortedAgain = this.sortObjectKeys(localeData)
                      fs.writeFileSync(filePath, JSON.stringify(sortedAgain, null, 2) + '\n', 'utf-8')
                      translatedKeys++
                    }
                  } catch { /* translation failed, keep empty */ }
                }
              }
            }
          }
        }
      },
    )

    await this.store.refresh()

    return {
      createdFiles,
      updatedFiles,
      skippedFiles,
      totalKeys: sortedKeys.length,
      translatedKeys,
      locales: [...SUPPORTED_LOCALES],
    }
  }

  async completeMissingKeys(): Promise<CompleteKeysResult> {
    const allKeys = this.store.getAllKeys()
    const locales = this.store.locales
    const sourceLanguage = this.store.projectConfig.sourceLanguage || 'en'
    const existingTranslations = this.store.getAllTranslations()

    if (allKeys.length === 0 || locales.length === 0) {
      window.showWarningMessage('No keys or locales found. Please initialize first.')
      return { completed: 0, translated: 0, skipped: 0, errors: 0 }
    }

    let completed = 0
    let translated = 0
    let skipped = 0
    let errors = 0

    const shouldTranslate = this.canTranslate()

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Completing missing keys',
        cancellable: true,
      },
      async (progress) => {
        let current = 0
        const total = allKeys.length * locales.length

        for (const key of allKeys) {
          for (const locale of locales) {
            current++
            progress.report({
              message: `[${current}/${total}] ${key} → ${locale}`,
              increment: 100 / total,
            })

            const existing = this.store.getTranslation(locale, key)
            if (existing !== undefined) {
              skipped++
              continue
            }

            try {
              let value = ''

              if (shouldTranslate && this.translatorService && locale !== sourceLanguage) {
                const sourceValue = existingTranslations[sourceLanguage]?.[key]
                if (sourceValue && sourceValue !== '') {
                  try {
                    const result = await this.translatorService.translateText(sourceValue, sourceLanguage, locale)
                    if (result) {
                      value = result
                      translated++
                    }
                  } catch { /* translation failed, keep empty */ }
                }
              }

              await this.store.setTranslation(locale, key, value)
              completed++
            } catch {
              errors++
            }
          }
        }
      },
    )

    return { completed, translated, skipped, errors }
  }

  async scanAllGoKeys(rootPath: string): Promise<Set<string>> {
    const keys = new Set<string>()

    const existingKeys = this.store.getAllKeys()
    for (const key of existingKeys) {
      keys.add(key)
    }

    const goFiles = await this.findGoFilesWithI18n(rootPath)

    for (const file of goFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const constMap = this.errorCodeSync.parseGoConsts(content)
        for (const [, keyValue] of constMap) {
          keys.add(keyValue)
        }
      } catch { /* skip */ }
    }

    const { GoScanner } = await import('../scanners/go')
    const scanner = new GoScanner()

    for (const file of goFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const matches = scanner.scan(content, file)
        for (const match of matches) {
          if (match.key.includes('.')) {
            keys.add(match.key)
          }
        }
      } catch { /* skip */ }
    }

    return keys
  }

  private readLocaleFile(filePath: string): Record<string, string> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  private sortObjectKeys(obj: Record<string, any>): Record<string, any> {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = obj[key]
    }
    return sorted
  }

  private async findGoFilesWithI18n(rootPath: string): Promise<string[]> {
    const files: string[] = await fg('**/*.go', {
      cwd: rootPath,
      ignore: getIgnoreDirs(),
      onlyFiles: true,
      absolute: true,
    })

    return files.filter(f => {
      try {
        const content = fs.readFileSync(f, 'utf-8')
        return /(\w+)\s*=\s*"[\w.]+\.[\w.]+"/.test(content)
          || /i18n\s*\.\s*T\s*\(/.test(content)
          || /i18n\s*\.\s*GetMessage\s*\(/.test(content)
          || /i18n\s*\.\s*Translate\s*\(/.test(content)
      } catch { return false }
    })
  }
}
