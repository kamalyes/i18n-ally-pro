import { workspace, Uri } from 'vscode'
import fs from 'fs'
import path from 'path'
import fg from 'fast-glob'
import { ProjectConfig, FrameworkId, KeyStyle, ParserId, TranslationFile } from './types'
import { LOCALE_DIR_NAMES, COMMON_LOCALES, getIgnoreDirs } from './constants'

/** detectKeyStyle 取样文件数 */
const KEY_STYLE_SAMPLE_SIZE = 5

const LOCALE_FILE_PATTERNS = [
  '**/{locales,locale,i18n,lang,langs,languages,translations,messages}/**/*.{json,yaml,yml,po,properties}',
]

export class ProjectDetector {
  private rootPath: string
  private cache: ProjectConfig | null = null

  constructor(rootPath: string) {
    this.rootPath = rootPath
  }

  getRootPath(): string {
    return this.rootPath
  }

  async detect(): Promise<ProjectConfig> {
    if (this.cache)
      return this.cache

    const localesPaths = await this.detectLocalesPaths()
    // 三个探测都要文件清单，扫一次复用，避免同一轮 detect 跑三遍 glob
    const translationFiles = await this.findTranslationFiles(localesPaths)

    const config = this.mergeWithUserConfig({
      rootPath: this.rootPath,
      localesPaths,
      framework: await this.detectFramework(),
      keystyle: this.detectKeyStyle(translationFiles),
      parsers: this.detectParsers(translationFiles),
      sourceLanguage: this.detectSourceLanguage(translationFiles),
      displayLanguage: '',
      namespace: this.detectNamespace(translationFiles),
    })

    if (!config.displayLanguage)
      config.displayLanguage = config.sourceLanguage

    this.cache = config
    return config
  }

  invalidateCache() {
    this.cache = null
  }

  private mergeWithUserConfig(detected: ProjectConfig): ProjectConfig {
    const cfg = workspace.getConfiguration('i18nAllyPro')

    const localesPaths = cfg.get<string[]>('localesPaths', [])
    const framework = cfg.get<string>('framework', 'auto')
    const keystyle = cfg.get<string>('keystyle', 'auto')
    const parsers = cfg.get<string[]>('enabledParsers', [])
    const sourceLanguage = cfg.get<string>('sourceLanguage', '')
    const displayLanguage = cfg.get<string>('displayLanguage', '')

    return {
      ...detected,
      localesPaths: localesPaths.length > 0 ? localesPaths : detected.localesPaths,
      framework: framework !== 'auto' ? framework as FrameworkId : detected.framework,
      keystyle: keystyle !== 'auto' ? keystyle as KeyStyle : detected.keystyle,
      parsers: parsers.length > 0 ? parsers as ParserId[] : detected.parsers,
      sourceLanguage: sourceLanguage || detected.sourceLanguage,
      displayLanguage: displayLanguage || detected.displayLanguage,
    }
  }

  private async detectLocalesPaths(): Promise<string[]> {
    const results: string[] = []

    for (const pattern of LOCALE_FILE_PATTERNS) {
      const files = await fg(pattern, {
        cwd: this.rootPath,
        ignore: getIgnoreDirs(),
        onlyFiles: true,
        absolute: false,
      })

      for (const file of files) {
        // 取 locales 根目录，而不是文件所在目录。
        // 否则 locales/en/common.json 这种布局会把 locales/en 当成根，
        // 语言随后被当成文件名解析出来（common / errors），每个命名空间都变成一门假语言。
        const dir = this.localeRootOf(path.dirname(file))
        if (!results.includes(dir))
          results.push(dir)
      }
    }

    if (results.length === 0) {
      for (const name of LOCALE_DIR_NAMES) {
        const dir = path.join(this.rootPath, name)
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory())
          results.push(name)
      }
    }

    return results
  }

  /**
   * 从文件所在目录回溯到 locales 根目录：取最后一个名字像 locales/i18n/lang 的路径段。
   * 没有这样的段时（用户自定义目录）就用原目录。
   */
  private localeRootOf(dir: string): string {
    const segments = dir.split(/[/\\]/).filter(Boolean)

    for (let i = segments.length - 1; i >= 0; i--) {
      if (LOCALE_DIR_NAMES.includes(segments[i]))
        return segments.slice(0, i + 1).join('/')
    }

    return dir
  }

  private async detectFramework(): Promise<FrameworkId> {
    const hasGoMod = fs.existsSync(path.join(this.rootPath, 'go.mod'))
    const hasPackageJson = fs.existsSync(path.join(this.rootPath, 'package.json'))

    if (hasGoMod) {
      const goFiles = await fg('**/*.go', {
        cwd: this.rootPath,
        ignore: getIgnoreDirs(),
        onlyFiles: true,
        absolute: false,
      })

      let sampleSize = 0
      for (const file of goFiles) {
        if (sampleSize >= 20) break
        try {
          const content = fs.readFileSync(path.join(this.rootPath, file), 'utf-8')
          if (this.matchGoI18nPatterns(content))
            return 'go-rpc-gateway'
          sampleSize++
        }
        catch { /* skip */ }
      }

      if (goFiles.length > 0)
        return 'go-rpc-gateway'
    }

    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(this.rootPath, 'package.json'), 'utf-8'))
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }

        if (deps['vue-i18n'] || deps['@intlify/vite-plugin'] || deps['@nuxtjs/i18n'])
          return 'vue-i18n'
        if (deps['react-i18next'] || deps['next-intl'] || deps['next-international'])
          return 'react-i18next'
      }
      catch { /* skip */ }
    }

    return 'general'
  }

  private matchGoI18nPatterns(content: string): boolean {
    const patterns = [
      /i18n\s*\.\s*T\s*\(/,
      /i18n\s*\.\s*GetMessage\s*\(/,
      /i18n\s*\.\s*Translate\s*\(/,
      /GetMessage\s*\(\s*["']/,
      /T\s*\(\s*["'][\w.]+["']/,
      /BizErrCode\w+\s*=\s*["'][\w.]+["']/,
    ]
    return patterns.some(p => p.test(content))
  }

  /**
   * 探测 key 风格。只认 json/yaml（po/properties 本身就是扁平的），
   * 并多取几个样本：首个文件可能恰好是空文件或只有一层 key。
   */
  private detectKeyStyle(translationFiles: TranslationFile[]): KeyStyle {
    const samples = translationFiles
      .filter(f => f.parser === 'json' || f.parser === 'yaml')
      .slice(0, KEY_STYLE_SAMPLE_SIZE)

    for (const sample of samples) {
      try {
        const content = fs.readFileSync(sample.filepath, 'utf-8')
        const data = sample.parser === 'json'
          ? JSON.parse(content)
          : require('js-yaml').load(content)
        if (data && typeof data === 'object' && this.isNested(data))
          return 'nested'
      }
      catch { /* 文件坏了就看下一个 */ }
    }

    return 'flat'
  }

  private isNested(obj: any, depth = 0): boolean {
    if (depth > 1) return true
    for (const value of Object.values(obj)) {
      // 数组同样是嵌套结构：扁平写法没法表达数组，
      // 把含数组的文件判成 flat 会在写回时把它拆成 list.0 / list.1
      if (value && typeof value === 'object')
        return true
    }
    return false
  }

  private detectParsers(translationFiles: TranslationFile[]): ParserId[] {
    const exts = new Set<string>()

    for (const file of translationFiles) {
      const ext = path.extname(file.filepath).toLowerCase()
      exts.add(ext)
    }

    const parsers: ParserId[] = []
    if (exts.has('.json')) parsers.push('json')
    if (exts.has('.yaml') || exts.has('.yml')) parsers.push('yaml')
    if (exts.has('.po')) parsers.push('po')
    if (exts.has('.properties')) parsers.push('properties')

    return parsers.length > 0 ? parsers : ['json']
  }

  private detectSourceLanguage(translationFiles: TranslationFile[]): string {
    const englishFiles = translationFiles.filter(f => {
      const basename = path.basename(f.filepath, path.extname(f.filepath))
      return basename === 'en' || basename === 'en-US' || basename.toLowerCase().startsWith('en-')
    })
    if (englishFiles.length > 0) {
      const enUs = englishFiles.find(f => {
        const b = path.basename(f.filepath, path.extname(f.filepath))
        return b === 'en-US'
      })
      if (enUs) return 'en-US'
      const en = englishFiles.find(f => path.basename(f.filepath, path.extname(f.filepath)) === 'en')
      if (en) return 'en'
      return path.basename(englishFiles[0].filepath, path.extname(englishFiles[0].filepath))
    }

    for (const locale of COMMON_LOCALES) {
      if (translationFiles.some(f => path.basename(f.filepath, path.extname(f.filepath)) === locale))
        return locale
    }

    if (translationFiles.length > 0)
      return path.basename(translationFiles[0].filepath, path.extname(translationFiles[0].filepath))

    return 'en'
  }

  /**
   * 是否 namespace 布局：同一语言被拆成多个文件（如 en/common.json + en/errors.json）。
   * 旧实现读的是 detect() 里还没写入的 this.cache，永远返回 false。
   */
  private detectNamespace(translationFiles: TranslationFile[]): boolean {
    const perLocale = new Map<string, number>()
    for (const file of translationFiles)
      perLocale.set(file.locale, (perLocale.get(file.locale) ?? 0) + 1)

    for (const count of perLocale.values())
      if (count > 1) return true

    return false
  }

  async findTranslationFiles(localesPaths?: string[]): Promise<TranslationFile[]> {
    const paths = localesPaths || this.cache?.localesPaths || (await this.detectLocalesPaths())
    const files: TranslationFile[] = []

    for (const localePath of paths) {
      const absPath = path.join(this.rootPath, localePath)
      if (!fs.existsSync(absPath)) continue

      const entries = await fg('**/*.{json,yaml,yml,po,properties}', {
        cwd: absPath,
        ignore: getIgnoreDirs(),
        onlyFiles: true,
        absolute: true,
      })

      for (const filepath of entries) {
        const basename = path.basename(filepath, path.extname(filepath))
        const locale = this.extractLocaleFromPath(filepath, localePath)
        const ext = path.extname(filepath).toLowerCase()

        let parser: ParserId = 'json'
        if (ext === '.yaml' || ext === '.yml') parser = 'yaml'
        else if (ext === '.po') parser = 'po'
        else if (ext === '.properties') parser = 'properties'

        files.push({ filepath, locale, parser })
      }
    }

    return files
  }

  private extractLocaleFromPath(filepath: string, localePath: string): string {
    const relative = path.relative(path.join(this.rootPath, localePath), filepath)
    const parts = relative.split(/[/\\]/)

    if (parts.length >= 2) {
      const dirName = parts[0]
      if (COMMON_LOCALES.includes(dirName))
        return dirName
    }

    const basename = path.basename(filepath, path.extname(filepath))
    for (const locale of COMMON_LOCALES) {
      if (basename === locale) return locale
      if (locale.includes('-') && basename.toLowerCase() === locale.toLowerCase()) return locale
    }
    for (const locale of COMMON_LOCALES) {
      if (basename.startsWith(`${locale}.`)) return locale
    }

    return basename
  }
}
