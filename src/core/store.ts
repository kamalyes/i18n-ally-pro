import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { ProjectDetector } from './detector'
import { TranslationMap, TranslationFile, ProjectConfig, KeyStyle, DiagnosticInfo } from './types'
import { JsonParser } from '../parsers/json'
import { YamlParser } from '../parsers/yaml'
import { PoParser } from '../parsers/po'
import { PropertiesParser } from '../parsers/properties'
import { Parser } from './types'

export class TranslationStore extends EventEmitter {
  private detector: ProjectDetector
  private config: ProjectConfig | null = null
  private translations: TranslationMap = {}
  private _historyService: any = null
  private files: TranslationFile[] = []
  private parserMap: Record<string, Parser> = {}

  constructor(rootPath: string) {
    super()
    this.detector = new ProjectDetector(rootPath)
    this.parserMap = {
      json: new JsonParser(),
      yaml: new YamlParser(),
      po: new PoParser(),
      properties: new PropertiesParser(),
    }
  }

  async init() {
    this.config = await this.detector.detect()
    await this.loadAll()
    this.emit('didChange')
  }

  get projectConfig(): ProjectConfig {
    if (!this.config) {
      return {
        rootPath: this.detector.getRootPath(),
        localesPaths: [],
        framework: 'general',
        keystyle: 'flat',
        parsers: ['json'],
        sourceLanguage: 'en',
        displayLanguage: 'en',
        namespace: false,
      }
    }
    return this.config
  }

  get locales(): string[] {
    return Object.keys(this.translations)
  }

  getTranslation(locale: string, key: string): string | undefined {
    return this.translations[locale]?.[key]
  }

  getAllTranslations(): TranslationMap {
    return this.translations
  }

  getTranslationFiles(): TranslationFile[] {
    return this.files
  }

  getAllKeys(): string[] {
    const keys = new Set<string>()
    for (const localeData of Object.values(this.translations))
      for (const key of Object.keys(localeData))
        keys.add(key)
    return Array.from(keys)
  }

  getKeysForLocale(locale: string): string[] {
    return Object.keys(this.translations[locale] || {})
  }

  async refresh() {
    this.detector.invalidateCache()
    this.config = await this.detector.detect()
    await this.loadAll()
    this.emit('didChange')
  }

  async deleteTranslation(locale: string, key: string) {
    if (!this.translations[locale]) return

    const oldValue = this.translations[locale][key]
    delete this.translations[locale][key]

    if (this._historyService) {
      this._historyService.record('delete', locale, key, oldValue, undefined)
    }

    const file = this.files.find(f => f.locale === locale)
    if (file) {
      await this.writeToFile(file)
      this.emit('didChange')
    }
  }

  async setTranslation(locale: string, key: string, value: string) {
    const oldValue = this.translations[locale]?.[key]

    if (!this.translations[locale])
      this.translations[locale] = {}
    this.translations[locale][key] = value

    if (this._historyService) {
      this._historyService.record('set', locale, key, oldValue, value)
    }

    const file = this.files.find(f => f.locale === locale)
    if (file) {
      await this.writeToFile(file)
      this.emit('didChange')
    }
  }

  setHistoryService(service: any) {
    this._historyService = service
  }

  getDiagnostics(): DiagnosticInfo[] {
    const diagnostics: DiagnosticInfo[] = []
    const allKeys = this.getAllKeys()
    const locales = this.locales

    for (const key of allKeys) {
      for (const locale of locales) {
        const value = this.translations[locale]?.[key]
        if (value === undefined)
          diagnostics.push({ type: 'missing', key, locale })
        else if (value === '')
          diagnostics.push({ type: 'empty', key, locale })
      }
    }

    return diagnostics
  }

  flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object' && !Array.isArray(value))
        Object.assign(result, this.flattenObject(value, fullKey))
      else
        result[fullKey] = String(value ?? '')
    }
    return result
  }

  nestObject(flat: Record<string, string>): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(flat)) {
      const parts = key.split('.')
      let current = result
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]])
          current[parts[i]] = {}
        current = current[parts[i]]
      }
      current[parts[parts.length - 1]] = value
    }
    return result
  }

  private async loadAll() {
    this.translations = {}
    this.files = await this.detector.findTranslationFiles()

    for (const file of this.files) {
      try {
        const content = fs.readFileSync(file.filepath, 'utf-8')
        const parser = this.parserMap[file.parser]
        if (!parser) continue

        const raw = parser.parse(content)
        const flat = this.config?.keystyle === 'nested'
          ? this.flattenObject(raw)
          : raw as Record<string, string>

        if (!this.translations[file.locale])
          this.translations[file.locale] = {}

        Object.assign(this.translations[file.locale], flat)
      }
      catch (err) {
        console.error(`Failed to load ${file.filepath}:`, err)
      }
    }
  }

  private async writeToFile(file: TranslationFile) {
    const parser = this.parserMap[file.parser]
    if (!parser) return

    const localeData = this.translations[file.locale] || {}
    const sortedData = this.sortObjectKeys(localeData)
    const data = this.config?.keystyle === 'nested'
      ? this.nestObject(sortedData)
      : sortedData

    const content = parser.dump(data, true)
    fs.writeFileSync(file.filepath, content, 'utf-8')
  }

  private sortObjectKeys(obj: Record<string, string>): Record<string, string> {
    const sorted: Record<string, string> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = obj[key]
    }
    return sorted
  }

  async cloneLocale(sourceLocale: string, targetLocale: string, overwrite: boolean = false): Promise<{ cloned: number; skipped: number }> {
    const sourceData = this.translations[sourceLocale]
    if (!sourceData) return { cloned: 0, skipped: 0 }

    let cloned = 0
    let skipped = 0

    if (!this.translations[targetLocale])
      this.translations[targetLocale] = {}

    for (const [key, value] of Object.entries(sourceData)) {
      if (!value && value !== '') continue
      const existing = this.translations[targetLocale][key]
      if (existing !== undefined && existing !== '' && !overwrite) {
        skipped++
        continue
      }
      this.translations[targetLocale][key] = value
      cloned++
    }

    let file = this.files.find(f => f.locale === targetLocale)
    if (!file) {
      const sourceFile = this.files.find(f => f.locale === sourceLocale)
      if (sourceFile) {
        const dir = path.dirname(sourceFile.filepath)
        const ext = path.extname(sourceFile.filepath)
        const newFilePath = path.join(dir, `${targetLocale}${ext}`)
        const nestedData = this.config?.keystyle === 'nested'
          ? this.nestObject(this.sortObjectKeys(this.translations[targetLocale]))
          : this.sortObjectKeys(this.translations[targetLocale])
        fs.writeFileSync(newFilePath, JSON.stringify(nestedData, null, 2) + '\n', 'utf-8')
        this.files.push({ locale: targetLocale, filepath: newFilePath, parser: sourceFile.parser })
        this.emit('didChange')
        return { cloned, skipped }
      }
      return { cloned, skipped }
    }

    await this.writeToFile(file)
    this.emit('didChange')

    return { cloned, skipped }
  }

  findFileForKey(key: string, locale: string): TranslationFile | undefined {
    return this.files.find(f => f.locale === locale)
  }

  findKeyPosition(filepath: string, key: string): { line: number; column: number } | null {
    const file = this.files.find(f => f.filepath === filepath)
    if (!file) return null

    const parser = this.parserMap[file.parser]
    if (!parser) return null

    try {
      const content = fs.readFileSync(filepath, 'utf-8')
      return parser.navigateToKey(content, key, this.config?.keystyle || 'flat')
    }
    catch {
      return null
    }
  }
}
