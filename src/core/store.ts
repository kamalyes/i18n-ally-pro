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

    delete this.translations[locale][key]

    const file = this.files.find(f => f.locale === locale)
    if (file) {
      await this.writeToFile(file)
      this.emit('didChange')
    }
  }

  async setTranslation(locale: string, key: string, value: string) {
    if (!this.translations[locale])
      this.translations[locale] = {}
    this.translations[locale][key] = value

    const file = this.files.find(f => f.locale === locale)
    if (file) {
      await this.writeToFile(file)
      this.emit('didChange')
    }
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
    const data = this.config?.keystyle === 'nested'
      ? this.nestObject(localeData)
      : localeData

    const content = parser.dump(data, true)
    fs.writeFileSync(file.filepath, content, 'utf-8')
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
