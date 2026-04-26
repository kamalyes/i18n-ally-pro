import { workspace, Uri } from 'vscode'
import fs from 'fs'
import path from 'path'
import fg from 'fast-glob'
import { ProjectConfig, FrameworkId, KeyStyle, ParserId, TranslationFile } from './types'

const LOCALE_DIR_NAMES = [
  'locales', 'locale', 'i18n', 'lang', 'langs', 'languages',
  'translations', 'messages', 'intl', 'localization',
]

const LOCALE_FILE_PATTERNS = [
  '**/{locales,locale,i18n,lang,langs,languages,translations,messages}/**/*.{json,yaml,yml,po,properties}',
]

const COMMON_LOCALES = [
  'en', 'zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant',
  'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'it', 'nl',
  'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'uk',
  'cs', 'sv', 'da', 'no', 'fi', 'el', 'he', 'bg', 'ro',
  'bm', 'bn', 'kh', 'lo', 'my', 'tc', 'ur',
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

    const config = this.mergeWithUserConfig({
      rootPath: this.rootPath,
      localesPaths,
      framework: await this.detectFramework(),
      keystyle: await this.detectKeyStyle(localesPaths),
      parsers: await this.detectParsers(localesPaths),
      sourceLanguage: await this.detectSourceLanguage(localesPaths),
      displayLanguage: '',
      namespace: await this.detectNamespace(),
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
        ignore: ['node_modules', '.git', 'dist', 'build', 'vendor'],
        onlyFiles: true,
        absolute: false,
      })

      for (const file of files) {
        const dir = path.dirname(file)
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

  private async detectFramework(): Promise<FrameworkId> {
    const hasGoMod = fs.existsSync(path.join(this.rootPath, 'go.mod'))
    const hasPackageJson = fs.existsSync(path.join(this.rootPath, 'package.json'))

    if (hasGoMod) {
      const goFiles = await fg('**/*.go', {
        cwd: this.rootPath,
        ignore: ['vendor', 'node_modules'],
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

  private async detectKeyStyle(localesPaths: string[]): Promise<KeyStyle> {
    const translationFiles = await this.findTranslationFiles(localesPaths)
    if (translationFiles.length === 0)
      return 'flat'

    const sample = translationFiles[0]
    try {
      const content = fs.readFileSync(sample.filepath, 'utf-8')
      const data = JSON.parse(content)
      return this.isNested(data) ? 'nested' : 'flat'
    }
    catch {
      return 'flat'
    }
  }

  private isNested(obj: any, depth = 0): boolean {
    if (depth > 1) return true
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value))
        return true
    }
    return false
  }

  private async detectParsers(localesPaths: string[]): Promise<ParserId[]> {
    const translationFiles = await this.findTranslationFiles(localesPaths)
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

  private async detectSourceLanguage(localesPaths: string[]): Promise<string> {
    const translationFiles = await this.findTranslationFiles(localesPaths)

    for (const file of translationFiles) {
      const basename = path.basename(file.filepath, path.extname(file.filepath))
      if (basename === 'en' || basename === 'en-US' || basename === 'en-US.json')
        return basename
    }

    for (const locale of COMMON_LOCALES) {
      if (translationFiles.some(f => path.basename(f.filepath, path.extname(f.filepath)) === locale))
        return locale
    }

    if (translationFiles.length > 0)
      return path.basename(translationFiles[0].filepath, path.extname(translationFiles[0].filepath))

    return 'en'
  }

  private async detectNamespace(): Promise<boolean> {
    const config = this.cache
    if (!config) return false
    return config.localesPaths.some(p => p.includes('locales'))
  }

  async findTranslationFiles(localesPaths?: string[]): Promise<TranslationFile[]> {
    const paths = localesPaths || this.cache?.localesPaths || (await this.detectLocalesPaths())
    const files: TranslationFile[] = []

    for (const localePath of paths) {
      const absPath = path.join(this.rootPath, localePath)
      if (!fs.existsSync(absPath)) continue

      const entries = await fg('**/*.{json,yaml,yml,po,properties}', {
        cwd: absPath,
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
      if (basename === locale || basename.startsWith(locale + '.'))
        return locale
    }

    return basename
  }
}
