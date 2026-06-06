import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import {
  getExclusiveGroupKey,
  getLocaleExclusiveGroup,
  localeIdEquals,
} from './constants'
import { ProjectDetector } from './detector'
import {
  TranslationMap,
  TranslationFile,
  ProjectConfig,
  KeyStyle,
  DiagnosticInfo,
  ParserId,
  ResolvedSourceTranslation,
} from './types'
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
    const matchedLocale = this.matchLocale(locale)
    if (!matchedLocale) return undefined
    return this.translations[matchedLocale]?.[key]
  }

  /**
   * 解析可用于机器翻译的源文案。
   * 依次尝试：配置的源语言（含 en/en-US 等别名）→ 其它已有翻译的语言 → key 路径别名（如 menu.xxx）。
   */
  resolveSourceTranslation(key: string, preferredLocales?: string[]): ResolvedSourceTranslation | null {
    const config = this.projectConfig
    const localeOrder = this.expandLocaleCandidates([
      ...(preferredLocales ?? []),
      config.sourceLanguage,
      config.displayLanguage,
      ...this.locales,
    ])
    const keysToTry = this.expandKeyCandidates(key)

    for (const tryKey of keysToTry) {
      for (const locale of localeOrder) {
        const value = this.getTranslation(locale, tryKey)
        if (value !== undefined && value !== '') {
          return { locale, value, resolvedKey: tryKey }
        }
      }
    }

    return null
  }

  /** 列出对该 key（含路径别名）已有非空翻译的语言，供批量翻译选择源语言。 */
  listLocalesWithTranslation(key: string): { locale: string; value: string; resolvedKey: string }[] {
    const keysToTry = this.expandKeyCandidates(key)
    const result: { locale: string; value: string; resolvedKey: string }[] = []
    const seenSlots = new Set<string>()

    for (const locale of this.locales) {
      const slotKey = getExclusiveGroupKey(locale)
      if (seenSlots.has(slotKey)) continue

      for (const tryKey of keysToTry) {
        const value = this.getTranslationInLocaleGroup(locale, tryKey)
        if (value !== undefined && value !== '') {
          seenSlots.add(slotKey)
          result.push({ locale: this.matchLocale(locale) ?? locale, value, resolvedKey: tryKey })
          break
        }
      }
    }

    return result
  }

  /** 将配置语言解析为仓库中实际存在的 locale id（如 en ↔ en-US 互认）。 */
  matchLocale(locale: string): string | null {
    if (!locale) return null
    if (this.translations[locale]) return locale

    const group = getLocaleExclusiveGroup(locale)
    if (group) {
      for (const member of group) {
        const hit = this.locales.find(l => localeIdEquals(l, member))
        if (hit) return hit
      }
    }

    const base = locale.split(/[-_]/)[0]
    const exactBase = this.locales.find(l => localeIdEquals(l, base))
    if (exactBase) return exactBase

    const regional = this.locales.find(l => {
      const lb = l.split(/[-_]/)[0]
      return lb === base && (l.includes('-') || l.includes('_'))
    })
    if (regional) return regional

    const loose = this.locales.find(l => l.split(/[-_]/)[0] === base)
    return loose ?? null
  }

  /**
   * 校验用 locale 槽位：互斥组（如 en / en-US）合并为一个槽，组内任一语言有译文即视为满足。
   */
  getValidationLocaleSlots(): { slotKey: string; locales: string[] }[] {
    const slotMap = new Map<string, string[]>()

    for (const locale of this.locales) {
      const slotKey = getExclusiveGroupKey(locale)
      const list = slotMap.get(slotKey) ?? []
      list.push(locale)
      slotMap.set(slotKey, list)
    }

    return Array.from(slotMap.entries()).map(([slotKey, locales]) => ({ slotKey, locales }))
  }

  /** 在 locale 或其互斥组任一成员上读取译文。 */
  getTranslationInLocaleGroup(locale: string, key: string): string | undefined {
    const keysToTry = this.expandKeyCandidates(key)
    const localesToTry = new Set<string>()

    const matched = this.matchLocale(locale)
    if (matched) localesToTry.add(matched)

    const group = getLocaleExclusiveGroup(locale)
    if (group) {
      for (const member of group) {
        const hit = this.locales.find(l => localeIdEquals(l, member))
        if (hit) localesToTry.add(hit)
      }
    }

    for (const tryLocale of localesToTry) {
      for (const tryKey of keysToTry) {
        const value = this.translations[tryLocale]?.[tryKey]
        if (value !== undefined && value !== '') return value
      }
    }

    return undefined
  }

  private expandLocaleCandidates(locales: string[]): string[] {
    const ordered: string[] = []
    const seen = new Set<string>()

    for (const raw of locales) {
      const matched = this.matchLocale(raw) ?? raw
      if (!seen.has(matched)) {
        seen.add(matched)
        ordered.push(matched)
      }
    }

    return ordered
  }

  private expandKeyCandidates(key: string): string[] {
    const candidates = new Set<string>([key])
    for (const storedKey of this.getAllKeys()) {
      if (storedKey === key) continue
      if (storedKey.endsWith(`.${key}`)) candidates.add(storedKey)
    }
    return Array.from(candidates)
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
    const slots = this.getValidationLocaleSlots()

    for (const key of allKeys) {
      for (const { locales } of slots) {
        const representative = locales[0]
        let hasDefined = false
        let hasEmpty = false

        for (const locale of locales) {
          const value = this.translations[locale]?.[key]
          if (value === undefined) continue
          hasDefined = true
          if (value === '') hasEmpty = true
          else {
            hasEmpty = false
            break
          }
        }

        if (!hasDefined) {
          diagnostics.push({ type: 'missing', key, locale: representative })
        } else if (hasEmpty) {
          diagnostics.push({ type: 'empty', key, locale: representative })
        }
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
        const part = parts[i]
        const existing = current[part]
        if (existing === undefined) {
          current[part] = {}
        } else if (!this.isPlainObject(existing)) {
          throw new Error(`Cannot nest "${key}" because "${parts.slice(0, i + 1).join('.')}" already has a value`)
        }
        current = current[part]
      }
      const leaf = parts[parts.length - 1]
      if (this.isPlainObject(current[leaf])) {
        throw new Error(`Cannot nest "${key}" because it is already used as a group`)
      }
      current[leaf] = value
    }
    return result
  }

  async formatAllFiles(keyStyle: KeyStyle = 'nested'): Promise<{ formatted: number; unchanged: number; errors: string[] }> {
    const result = { formatted: 0, unchanged: 0, errors: [] as string[] }
    const files = this.files.length > 0 ? this.files : await this.detector.findTranslationFiles()

    for (const file of files) {
      const parser = this.parserMap[file.parser]
      if (!parser) continue

      try {
        const content = fs.readFileSync(file.filepath, 'utf-8')
        const flat = this.sortObjectKeys(this.flattenObject(parser.parse(content)))
        const data = this.shapeDataForParser(file.parser, flat, keyStyle)
        const next = parser.dump(data, true)

        if (next === content) {
          result.unchanged++
          continue
        }

        fs.writeFileSync(file.filepath, next, 'utf-8')
        result.formatted++
      }
      catch (err: any) {
        result.errors.push(`${file.filepath}: ${err.message}`)
      }
    }

    await this.loadAll()
    this.emit('didChange')
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
        const flat = this.flattenObject(raw)

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
    const data = this.shapeDataForParser(file.parser, sortedData, this.getWriteKeyStyle(file.parser))

    const content = parser.dump(data, true)
    fs.writeFileSync(file.filepath, content, 'utf-8')
  }

  private shapeDataForParser(parserId: ParserId, data: Record<string, string>, keyStyle: KeyStyle): Record<string, any> {
    if (this.supportsNestedOutput(parserId) && keyStyle === 'nested')
      return this.nestObject(data)
    return data
  }

  private getWriteKeyStyle(parserId: ParserId): KeyStyle {
    if (parserId === 'json')
      return 'nested'
    if (this.supportsNestedOutput(parserId))
      return this.config?.keystyle || 'flat'
    return 'flat'
  }

  private supportsNestedOutput(parserId: ParserId): boolean {
    return parserId === 'json' || parserId === 'yaml'
  }

  private isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
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
        const nestedData = sourceFile.parser === 'json'
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

  /**
   * Ensure a locale file exists. If not, create it based on an existing file's directory/parser.
   * Returns the TranslationFile entry (existing or newly created).
   */
  async ensureLocaleFile(locale: string, preferredFilepath?: string, preferredParser?: ParserId): Promise<TranslationFile | null> {
    const existing = this.files.find(f => f.locale === locale)
    if (existing) return existing

    // If preferredFilepath provided, use it directly
    if (preferredFilepath) {
      const parser: ParserId = preferredParser || 'json'
      const dir = path.dirname(preferredFilepath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      // Initialize empty file
      const initData = parser === 'json' ? '{}' : ''
      if (!fs.existsSync(preferredFilepath)) {
        fs.writeFileSync(preferredFilepath, initData, 'utf-8')
      }
      const file: TranslationFile = { locale, filepath: preferredFilepath, parser }
      this.files.push(file)
      return file
    }

    // Otherwise, find a reference file from the same project
    const refFile = this.files[0]
    if (!refFile) return null

    const dir = path.dirname(refFile.filepath)
    const ext = path.extname(refFile.filepath)
    const newFilePath = path.join(dir, `${locale}${ext}`)
    const parser = refFile.parser

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const initData = parser === 'json' ? '{}' : ''
    if (!fs.existsSync(newFilePath)) {
      fs.writeFileSync(newFilePath, initData, 'utf-8')
    }

    const file: TranslationFile = { locale, filepath: newFilePath, parser }
    this.files.push(file)
    return file
  }

  findKeyPosition(filepath: string, key: string): { line: number; column: number } | null {
    const file = this.files.find(f => f.filepath === filepath)
    if (!file) return null

    const parser = this.parserMap[file.parser]
    if (!parser) return null

    try {
      const content = fs.readFileSync(filepath, 'utf-8')
      const keyStyle: KeyStyle = file.parser === 'json' ? 'nested' : (this.config?.keystyle || 'flat')
      return parser.navigateToKey(content, key, keyStyle)
    }
    catch {
      return null
    }
  }
}
