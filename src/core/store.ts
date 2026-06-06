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

/**
 * didChange 合流窗口。
 * 批量写入（翻译、同步错误码）过去会逐条触发树视图 / 状态栏 / 仪表盘全量重算，
 * 合流后一批写入只重算一次。
 */
const DID_CHANGE_DEBOUNCE_MS = 50

export interface TranslationEdit {
  locale: string
  key: string
  /** undefined 表示删除 */
  value: string | undefined
}

/** keyOwner 的复合键；\u0000 不会出现在 locale 或 key 里 */
function ownerId(locale: string, key: string): string {
  return `${locale}\u0000${key}`
}

export class TranslationStore extends EventEmitter {
  private detector: ProjectDetector
  private config: ProjectConfig | null = null
  private translations: TranslationMap = {}
  private _historyService: any = null
  private files: TranslationFile[] = []
  private parserMap: Record<string, Parser> = {}

  /** filepath -> 文件条目 */
  private fileByPath = new Map<string, TranslationFile>()
  /** locale -> 该语言的全部文件（按发现顺序） */
  private filesByLocale = new Map<string, TranslationFile[]>()
  /** ownerId(locale, key) -> key 所属文件的 filepath，决定写回时落到哪个文件 */
  private keyOwner = new Map<string, string>()
  /** filepath -> 该文件拥有的 key，写回时只 dump 这些 key */
  private fileKeys = new Map<string, Set<string>>()
  /** locale -> 原文件里是数组的路径，写回时重建为数组而不是对象 */
  private arrayPaths = new Map<string, Set<string>>()

  private localesCache: string[] | null = null
  private allKeysCache: string[] | null = null
  private keySetCache: Set<string> | null = null
  private suffixIndexCache: Map<string, string[]> | null = null
  private matchLocaleCache = new Map<string, string | null>()

  private didChangeTimer: ReturnType<typeof setTimeout> | null = null

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
    this.emitDidChange(true)
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
    if (!this.localesCache)
      this.localesCache = Object.keys(this.translations)
    return this.localesCache
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
    const cached = this.matchLocaleCache.get(locale)
    if (cached !== undefined) return cached

    const resolved = this.resolveLocaleId(locale)
    this.matchLocaleCache.set(locale, resolved)
    return resolved
  }

  private resolveLocaleId(locale: string): string | null {
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

  /**
   * key 本身 + 以 `.key` 结尾的完整 key（如 `menu.save` 是 `save` 的候选）。
   * 走后缀索引，避免每次查询都线性遍历全部 key。
   */
  private expandKeyCandidates(key: string): string[] {
    const aliases = this.getSuffixIndex().get(key)
    return aliases ? [key, ...aliases] : [key]
  }

  /** 后缀（去掉首段后的剩余路径）-> 以该后缀结尾的完整 key */
  private getSuffixIndex(): Map<string, string[]> {
    if (this.suffixIndexCache) return this.suffixIndexCache

    const index = new Map<string, string[]>()
    for (const key of this.getAllKeys()) {
      let dot = key.indexOf('.')
      while (dot !== -1) {
        const suffix = key.slice(dot + 1)
        const list = index.get(suffix)
        if (list) list.push(key)
        else index.set(suffix, [key])
        dot = key.indexOf('.', dot + 1)
      }
    }

    this.suffixIndexCache = index
    return index
  }

  getAllTranslations(): TranslationMap {
    return this.translations
  }

  getTranslationFiles(): TranslationFile[] {
    return this.files
  }

  getAllKeys(): string[] {
    if (!this.allKeysCache)
      this.allKeysCache = Array.from(this.getKeySet())
    return this.allKeysCache
  }

  /** key 是否在任一语言里存在；供 Go 扫描器的兜底模式做白名单判定 */
  hasKey(key: string): boolean {
    return this.getKeySet().has(key)
  }

  private getKeySet(): Set<string> {
    if (!this.keySetCache) {
      const keys = new Set<string>()
      for (const localeData of Object.values(this.translations))
        for (const key of Object.keys(localeData))
          keys.add(key)
      this.keySetCache = keys
    }
    return this.keySetCache
  }

  getKeysForLocale(locale: string): string[] {
    return Object.keys(this.translations[locale] || {})
  }

  async refresh() {
    this.detector.invalidateCache()
    this.config = await this.detector.detect()
    await this.loadAll()
    this.emitDidChange(true)
  }

  async deleteTranslation(locale: string, key: string) {
    await this.applyEdits([{ locale, key, value: undefined }])
  }

  async setTranslation(locale: string, key: string, value: string) {
    await this.applyEdits([{ locale, key, value }])
  }

  /**
   * 批量写入 / 删除：按文件聚合后每个文件只写一次、只触发一次 didChange。
   * 逐条 setTranslation 会把整份语言文件重复 dump N 次，批量场景请用这个入口。
   */
  async setTranslations(edits: readonly TranslationEdit[]) {
    await this.applyEdits(edits)
  }

  private async applyEdits(edits: readonly TranslationEdit[]) {
    if (edits.length === 0) return

    const touchedFiles = new Map<string, TranslationFile>()
    let changed = false

    for (const { locale, key, value } of edits) {
      if (value === undefined) {
        const localeData = this.translations[locale]
        if (!localeData || !(key in localeData)) continue

        const oldValue = localeData[key]
        delete localeData[key]
        this.invalidateKeyIndexes()
        changed = true

        this._historyService?.record('delete', locale, key, oldValue, undefined)

        const owner = this.keyOwner.get(ownerId(locale, key))
        this.keyOwner.delete(ownerId(locale, key))
        if (owner) {
          this.fileKeys.get(owner)?.delete(key)
          const file = this.fileByPath.get(owner)
          if (file) touchedFiles.set(file.filepath, file)
        }
        continue
      }

      const oldValue = this.translations[locale]?.[key]
      if (!this.translations[locale]) {
        this.translations[locale] = {}
        this.invalidateLocaleIndexes()
      }
      this.translations[locale][key] = value
      if (oldValue === undefined) this.invalidateKeyIndexes()
      changed = true

      this._historyService?.record('set', locale, key, oldValue, value)

      // 语言还没有文件时先建一个，否则写入只存在于内存里，刷新即丢失
      const file = this.resolveOwnerFile(locale, key) ?? await this.ensureLocaleFile(locale)
      if (file) {
        this.assignOwner(locale, key, file)
        touchedFiles.set(file.filepath, file)
      }
    }

    for (const file of touchedFiles.values())
      this.writeToFile(file)

    if (changed) this.emitDidChange()
  }

  /** key 已归属的文件；没有归属时回退到该语言的首个文件 */
  private resolveOwnerFile(locale: string, key: string): TranslationFile | undefined {
    const owner = this.keyOwner.get(ownerId(locale, key))
    if (owner) {
      const file = this.fileByPath.get(owner)
      if (file) return file
    }
    return this.filesByLocale.get(locale)?.[0]
  }

  private assignOwner(locale: string, key: string, file: TranslationFile) {
    this.keyOwner.set(ownerId(locale, key), file.filepath)
    let keys = this.fileKeys.get(file.filepath)
    if (!keys) {
      keys = new Set<string>()
      this.fileKeys.set(file.filepath, keys)
    }
    keys.add(key)
  }

  private registerFile(file: TranslationFile) {
    this.fileByPath.set(file.filepath, file)
    const list = this.filesByLocale.get(file.locale)
    if (list) list.push(file)
    else this.filesByLocale.set(file.locale, [file])
    if (!this.fileKeys.has(file.filepath))
      this.fileKeys.set(file.filepath, new Set<string>())
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
          if (value.trim() === '') hasEmpty = true
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

  /**
   * 展平为扁平 key。数组展开成 `key.0` / `key.1` 这样的索引 key，
   * 并把数组路径记录到 arrayPaths，写回时才能重建成数组而不是对象。
   * （旧实现用 String(value) 把 ["a","b"] 压成 "a,b"，会直接写坏文件。）
   */
  flattenObject(obj: Record<string, any>, prefix = '', arrayPaths?: Set<string>): Record<string, string> {
    const result: Record<string, string> = {}

    const walk = (value: any, keyPath: string) => {
      if (Array.isArray(value)) {
        // 空数组没有索引 key 可落地，退化成空字符串（与历史行为一致）
        if (value.length === 0) {
          result[keyPath] = ''
          return
        }
        if (keyPath) arrayPaths?.add(keyPath)
        value.forEach((item, i) => walk(item, keyPath ? `${keyPath}.${i}` : String(i)))
        return
      }

      if (this.isPlainObject(value)) {
        for (const [key, child] of Object.entries(value))
          walk(child, keyPath ? `${keyPath}.${key}` : key)
        return
      }

      result[keyPath] = String(value ?? '')
    }

    walk(obj, prefix)
    return result
  }

  /** 扁平 key 还原为嵌套结构；arrayPaths 中的路径还原为数组。 */
  nestObject(flat: Record<string, string>, arrayPaths?: ReadonlySet<string>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(flat)) {
      const parts = key.split('.')
      let current: any = result
      let currentPath = ''

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        currentPath = currentPath ? `${currentPath}.${part}` : part
        const existing = current[part]
        if (existing === undefined) {
          current[part] = arrayPaths?.has(currentPath) ? [] : {}
        } else if (!this.isContainer(existing)) {
          throw new Error(`Cannot nest "${key}" because "${parts.slice(0, i + 1).join('.')}" already has a value`)
        }
        current = current[part]
      }

      const leaf = parts[parts.length - 1]
      if (this.isContainer(current[leaf])) {
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
        const arrayPaths = new Set<string>()
        const flat = this.sortObjectKeys(this.flattenObject(parser.parse(content), '', arrayPaths))
        const data = this.shapeDataForParser(file.parser, flat, keyStyle, arrayPaths)
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
    this.emitDidChange(true)
    return result
  }

  private async loadAll() {
    this.translations = {}
    this.keyOwner.clear()
    this.fileKeys.clear()
    this.fileByPath.clear()
    this.filesByLocale.clear()
    this.arrayPaths.clear()
    this.invalidateLocaleIndexes()

    this.files = await this.detector.findTranslationFiles()

    for (const file of this.files) {
      this.registerFile(file)

      try {
        const content = fs.readFileSync(file.filepath, 'utf-8')
        const parser = this.parserMap[file.parser]
        if (!parser) continue

        let localeArrayPaths = this.arrayPaths.get(file.locale)
        if (!localeArrayPaths) {
          localeArrayPaths = new Set<string>()
          this.arrayPaths.set(file.locale, localeArrayPaths)
        }

        const raw = parser.parse(content)
        const flat = this.flattenObject(raw, '', localeArrayPaths)

        if (!this.translations[file.locale])
          this.translations[file.locale] = {}

        const localeData = this.translations[file.locale]
        const fileKeys = this.fileKeys.get(file.filepath)!
        for (const [key, value] of Object.entries(flat)) {
          localeData[key] = value
          // 同一语言多文件时，先出现的文件保留归属，避免 key 被后续文件抢走后重复写两处
          if (!this.keyOwner.has(ownerId(file.locale, key))) {
            this.keyOwner.set(ownerId(file.locale, key), file.filepath)
            fileKeys.add(key)
          }
        }
      }
      catch (err) {
        console.error(`Failed to load ${file.filepath}:`, err)
      }
    }
  }

  private writeToFile(file: TranslationFile) {
    const parser = this.parserMap[file.parser]
    if (!parser) return

    const localeData = this.translations[file.locale] || {}
    const ownedKeys = this.fileKeys.get(file.filepath)

    // 一个语言可能被拆成多个文件（namespace），只写回本文件拥有的 key，
    // 否则每个文件都会被写成整份语言的副本。
    const scoped: Record<string, string> = {}
    if (ownedKeys) {
      for (const key of ownedKeys) {
        const value = localeData[key]
        if (value !== undefined) scoped[key] = value
      }
    }

    const sortedData = this.sortObjectKeys(scoped)
    const data = this.shapeDataForParser(
      file.parser,
      sortedData,
      this.getWriteKeyStyle(file.parser),
      this.arrayPaths.get(file.locale),
    )

    const content = parser.dump(data, true)
    fs.writeFileSync(file.filepath, content, 'utf-8')
  }

  private shapeDataForParser(
    parserId: ParserId,
    data: Record<string, string>,
    keyStyle: KeyStyle,
    arrayPaths?: ReadonlySet<string>,
  ): Record<string, any> {
    if (this.supportsNestedOutput(parserId) && keyStyle === 'nested')
      return this.nestObject(data, arrayPaths)
    return data
  }

  /**
   * 写回时的 key 风格。沿用项目探测/配置出来的风格 —— 以前 json 一律按 nested 写，
   * 会把本来是扁平 key 的文件（{"a.b": "x"}）在第一次编辑时整体重排成嵌套结构。
   */
  private getWriteKeyStyle(parserId: ParserId): KeyStyle {
    if (this.supportsNestedOutput(parserId))
      return this.projectConfig.keystyle
    return 'flat'
  }

  private supportsNestedOutput(parserId: ParserId): boolean {
    return parserId === 'json' || parserId === 'yaml'
  }

  private isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  private isContainer(value: unknown): boolean {
    return !!value && typeof value === 'object'
  }

  private sortObjectKeys(obj: Record<string, string>): Record<string, string> {
    const sorted: Record<string, string> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = obj[key]
    }
    return sorted
  }

  /** locale 集合变化（新增语言）时失效 */
  private invalidateLocaleIndexes() {
    this.localesCache = null
    this.matchLocaleCache.clear()
    this.invalidateKeyIndexes()
  }

  /** key 集合变化时失效 */
  private invalidateKeyIndexes() {
    this.allKeysCache = null
    this.keySetCache = null
    this.suffixIndexCache = null
  }

  private emitDidChange(immediate = false) {
    if (this.didChangeTimer) {
      clearTimeout(this.didChangeTimer)
      this.didChangeTimer = null
    }

    if (immediate) {
      this.emit('didChange')
      return
    }

    this.didChangeTimer = setTimeout(() => {
      this.didChangeTimer = null
      this.emit('didChange')
    }, DID_CHANGE_DEBOUNCE_MS)
  }

  dispose() {
    if (this.didChangeTimer) {
      clearTimeout(this.didChangeTimer)
      this.didChangeTimer = null
    }
    this.removeAllListeners()
  }

  async cloneLocale(sourceLocale: string, targetLocale: string, overwrite: boolean = false): Promise<{ cloned: number; skipped: number }> {
    const sourceData = this.translations[sourceLocale]
    if (!sourceData) return { cloned: 0, skipped: 0 }

    const edits: TranslationEdit[] = []
    let skipped = 0

    for (const [key, value] of Object.entries(sourceData)) {
      if (!value && value !== '') continue
      const existing = this.translations[targetLocale]?.[key]
      if (existing !== undefined && existing !== '' && !overwrite) {
        skipped++
        continue
      }
      edits.push({ locale: targetLocale, key, value })
    }

    if (edits.length === 0) {
      this.emitDidChange()
      return { cloned: 0, skipped }
    }

    // 目标语言还没有文件时，照源文件的目录与解析器建一个
    if (!this.filesByLocale.get(targetLocale)?.length) {
      const sourceFile = this.filesByLocale.get(sourceLocale)?.[0]
      const created = await this.ensureLocaleFile(
        targetLocale,
        sourceFile
          ? path.join(path.dirname(sourceFile.filepath), `${targetLocale}${path.extname(sourceFile.filepath)}`)
          : undefined,
        sourceFile?.parser,
      )
      if (!created) return { cloned: 0, skipped }
    }

    await this.applyEdits(edits)
    return { cloned: edits.length, skipped }
  }

  /**
   * 按当前的排序 / key 风格 / 解析器重新写出某个语言的全部文件。
   * 调用方不用自己拼 JSON，也不会把 yaml 写成 JSON。
   */
  async rewriteLocale(locale: string): Promise<number> {
    const matched = this.matchLocale(locale) ?? locale
    const files = this.filesByLocale.get(matched) ?? []
    for (const file of files)
      this.writeToFile(file)
    if (files.length > 0) this.emitDidChange()
    return files.length
  }

  /** key 在该语言里实际落在哪个文件；未知 key 回退到该语言的首个文件。 */
  findFileForKey(key: string, locale: string): TranslationFile | undefined {
    const matched = this.matchLocale(locale) ?? locale
    if (key) {
      const owner = this.keyOwner.get(ownerId(matched, key))
      if (owner) {
        const file = this.fileByPath.get(owner)
        if (file) return file
      }
    }
    return this.filesByLocale.get(matched)?.[0]
  }

  /**
   * Ensure a locale file exists. If not, create it based on an existing file's directory/parser.
   * Returns the TranslationFile entry (existing or newly created).
   */
  async ensureLocaleFile(locale: string, preferredFilepath?: string, preferredParser?: ParserId): Promise<TranslationFile | null> {
    const existing = this.filesByLocale.get(locale)?.[0]
    if (existing) return existing

    const target = preferredFilepath
      ? { filepath: preferredFilepath, parser: preferredParser || 'json' as ParserId }
      : this.pickNewLocaleFilePath(locale)

    if (!target) return null

    const dir = path.dirname(target.filepath)
    if (!fs.existsSync(dir))
      fs.mkdirSync(dir, { recursive: true })

    if (!fs.existsSync(target.filepath)) {
      const parser = this.parserMap[target.parser]
      // 用解析器生成空文件，而不是硬编码 '{}' —— yaml/po/properties 的空文件形态不同
      fs.writeFileSync(target.filepath, parser ? parser.dump({}) : '', 'utf-8')
    }

    const file: TranslationFile = { locale, filepath: target.filepath, parser: target.parser }
    this.files.push(file)
    this.registerFile(file)
    if (!this.translations[locale]) {
      this.translations[locale] = {}
      this.invalidateLocaleIndexes()
    }
    return file
  }

  private pickNewLocaleFilePath(locale: string): { filepath: string; parser: ParserId } | null {
    const refFile = this.files[0]
    if (refFile) {
      return {
        filepath: path.join(path.dirname(refFile.filepath), `${locale}${path.extname(refFile.filepath)}`),
        parser: refFile.parser,
      }
    }

    const config = this.projectConfig
    const localesPaths = config.localesPaths
    if (localesPaths.length > 0) {
      return {
        filepath: path.join(config.rootPath, localesPaths[0], `${locale}.json`),
        parser: 'json',
      }
    }

    return null
  }

  findKeyPosition(filepath: string, key: string): { line: number; column: number } | null {
    const file = this.fileByPath.get(filepath)
    if (!file) return null

    const parser = this.parserMap[file.parser]
    if (!parser) return null

    try {
      const content = fs.readFileSync(filepath, 'utf-8')
      const keyStyle: KeyStyle = this.supportsNestedOutput(file.parser)
        ? this.projectConfig.keystyle
        : 'flat'
      return parser.navigateToKey(content, key, keyStyle)
    }
    catch {
      return null
    }
  }
}
