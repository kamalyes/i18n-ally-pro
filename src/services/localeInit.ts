import { window, workspace, ProgressLocation } from 'vscode'
import fs from 'fs'
import path from 'path'
import fg from 'fast-glob'
import { TranslationStore } from '../core/store'
import { ErrorCodeSyncService } from './errorCodeSync'
import { TranslatorService } from './translator'
import { SUPPORTED_LOCALES, SupportedLocale, LOCALE_NAMES, getIgnoreDirs, DEFAULT_CONCURRENCY } from '../core/constants'
import { Concurrency } from '../utils/concurrency'

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
      async (progress, token) => {
        // 并发处理每个语言文件
        const tasks = SUPPORTED_LOCALES.map(locale => async () => {
          if (token.isCancellationRequested) {
            return { locale, status: 'cancelled' as const }
          }

          const filePath = path.join(localesDir, `${locale}.json`)
          let fileCreated = false
          let fileUpdated = false
          let fileTranslated = 0
          let needsWrite = false
          let dataToWrite: Record<string, string> | null = null

          if (fs.existsSync(filePath)) {
            const existingData = this.readLocaleFile(filePath)
            
            // 只处理缺失的键
            const missingKeys = sortedKeys.filter(k => existingData[k] === undefined)

            if (missingKeys.length === 0) {
              return { locale, status: 'skipped' as const }
            }

            // 添加缺失的键（空值）
            for (const key of missingKeys) {
              existingData[key] = ''
            }
            
            dataToWrite = existingData
            needsWrite = true
            fileUpdated = true

            // 并发翻译缺失的键（只翻译空值）
            if (shouldTranslate && this.translatorService && missingKeys.length > 0) {
              const translationTasks = missingKeys.map(key => async () => {
                // 只翻译空值
                if (existingData[key] !== '') return
                
                const sourceValue = existingTranslations[sourceLanguage]?.[key]
                if (sourceValue && sourceValue !== '') {
                  try {
                    const translated = await this.translatorService!.translateText(sourceValue, sourceLanguage, locale)
                    if (translated) {
                      existingData[key] = translated
                      fileTranslated++
                    }
                  } catch { /* translation failed, keep空值 */ }
                }
              })

              // 并发执行翻译任务（使用可配置的并发数）
              await Concurrency.run(translationTasks, DEFAULT_CONCURRENCY.TRANSLATION, undefined, token)
            }
          } else {
            // 创建新文件
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

            dataToWrite = localeData

            // 并发翻译新文件（只翻译空值）
            if (shouldTranslate && this.translatorService && locale !== sourceLanguage) {
              const translationTasks = sortedKeys.map(key => async () => {
                // 只翻译空值
                if (localeData[key] !== '') return
                
                const sourceValue = existingTranslations[sourceLanguage]?.[key]
                if (sourceValue && sourceValue !== '') {
                  try {
                    const translated = await this.translatorService!.translateText(sourceValue, sourceLanguage, locale)
                    if (translated) {
                      localeData[key] = translated
                      fileTranslated++
                    }
                  } catch { /* translation failed, keep空值 */ }
                }
              })

              // 并发执行翻译任务（使用可配置的并发数）
              await Concurrency.run(translationTasks, DEFAULT_CONCURRENCY.TRANSLATION, undefined, token)
            }

            const nestedData = this.flattenToNested(this.sortObjectKeys(localeData))
            const sortedNested = this.sortObjectKeysDeep(nestedData)
            fs.writeFileSync(filePath, JSON.stringify(sortedNested, null, 2) + '\n', 'utf-8')
            fileCreated = true
          }

          // 只在有变化时才写入文件（针对已存在的文件）
          if (needsWrite && dataToWrite && (fileTranslated > 0 || fileUpdated)) {
            const nestedData = this.flattenToNested(this.sortObjectKeys(dataToWrite))
            const sortedNested = this.sortObjectKeysDeep(nestedData)
            fs.writeFileSync(filePath, JSON.stringify(sortedNested, null, 2) + '\n', 'utf-8')
          }

          return { locale, status: 'processed' as const, fileCreated, fileUpdated, fileTranslated }
        })

        // 并发执行所有语言文件处理（使用可配置的并发数）
        const results = await Concurrency.run(tasks, DEFAULT_CONCURRENCY.FILE_PROCESSING, (completed, total) => {
          progress.report({
            message: `[${completed}/${total}] Processing languages`,
            increment: 100 / total,
          })
        }, token)

        // 统计结果
        for (const result of results) {
          if (result.status === 'processed') {
            if (result.fileCreated) createdFiles++
            if (result.fileUpdated) updatedFiles++
            translatedKeys += result.fileTranslated
          } else if (result.status === 'skipped') {
            skippedFiles++
          }
        }
      }
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
      const parsed = JSON.parse(content)
      return this.nestedToFlatten(parsed)
    } catch {
      return {}
    }
  }

  private nestedToFlatten(obj: Record<string, any>, prefix: string = ''): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      const value = obj[key]
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.nestedToFlatten(value, fullKey))
      } else {
        result[fullKey] = String(value ?? '')
      }
    }
    return result
  }

  private flattenToNested(obj: Record<string, string>): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      const parts = key.split('.')
      let current = result
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        if (!(part in current)) {
          current[part] = {}
        }
        current = current[part]
      }
      current[parts[parts.length - 1]] = value
    }
    return result
  }

  private sortObjectKeys(obj: Record<string, any>): Record<string, any> {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = obj[key]
    }
    return sorted
  }

  private sortObjectKeysDeep(obj: Record<string, any>): Record<string, any> {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(obj).sort()) {
      const value = obj[key]
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        sorted[key] = this.sortObjectKeysDeep(value)
      } else {
        sorted[key] = value
      }
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
