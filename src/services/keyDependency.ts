import fs from 'fs'
import path from 'path'
import { TranslationStore } from '../core/store'
import { Scanner } from '../core/types'
import { getIgnoreDirs, LOCALE_DIR_NAMES } from '../core/constants'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'

export interface KeyReference {
  key: string
  filepath: string
  line: number
  column: number
}

export interface KeyDependencyGraph {
  [key: string]: KeyReference[]
}

export class KeyDependencyService {
  private store: TranslationStore
  private scanners: Scanner[]
  private commonI18nPrefixes = new Set([
    'errors',
  ])

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async buildDependencyGraph(): Promise<KeyDependencyGraph> {
    const graph: KeyDependencyGraph = {}
    const rootPath = this.store.projectConfig.rootPath
    const allKeySet = new Set(this.store.getAllKeys())
    const knownPrefixes = this.getKnownKeyPrefixes(allKeySet)

    const fg = require('fast-glob')
    const codeFiles: string[] = await fg('**/*.{go,vue,js,ts,jsx,tsx,html}', {
      cwd: rootPath,
      ignore: this.getCodeScanIgnorePatterns(),
      onlyFiles: true,
      absolute: true,
    })

    for (const filepath of codeFiles) {
      try {
        if (this.isLocaleResourcePath(filepath)) continue

        const content = fs.readFileSync(filepath, 'utf-8')
        const ext = filepath.split('.').pop() || ''
        const languageId = this.extToLanguageId(ext)

        const scanner = this.scanners.find(s => s.languageIds.includes(languageId))
        if (!scanner) continue

        const matches = scanner.scan(content, filepath)

        for (const match of matches) {
          const key = match.key.trim()
          if (!this.shouldKeepMatch(key, allKeySet, knownPrefixes)) continue

          if (!graph[key]) {
            graph[key] = []
          }
          graph[key].push({
            key,
            filepath,
            line: match.line,
            column: match.column,
          })
        }
      } catch { /* skip unreadable files */ }
    }

    for (const key of Object.keys(graph)) {
      graph[key].sort((a, b) => {
        const fileCmp = a.filepath.localeCompare(b.filepath)
        if (fileCmp !== 0) return fileCmp
        return a.line - b.line
      })
    }

    return graph
  }

  async getKeyReferences(key: string): Promise<KeyReference[]> {
    const graph = await this.buildDependencyGraph()
    return graph[key] || []
  }

  private getCodeScanIgnorePatterns(): string[] {
    const patterns = new Set(getIgnoreDirs())
    const generatedPatterns = [
      '**/*.pb.go',
      '**/*.pb.gw.go',
      '**/*.gen.go',
      '**/*_generated.go',
      '**/pb/**',
      '**/.history/**',
      '**/testdata/**',
    ]

    for (const pattern of generatedPatterns) {
      patterns.add(pattern)
    }

    for (const name of LOCALE_DIR_NAMES) {
      patterns.add(`**/${name}/**`)
    }

    for (const localePath of this.store.projectConfig.localesPaths || []) {
      const normalized = this.normalizeProjectRelativePath(localePath)
      if (!normalized) continue

      patterns.add(normalized)
      patterns.add(`${normalized}/**`)
    }

    return Array.from(patterns)
  }

  private getKnownKeyPrefixes(keys: Set<string>): Set<string> {
    const prefixes = new Set<string>()

    for (const key of keys) {
      const firstSegment = key.split('.')[0]
      if (firstSegment) {
        prefixes.add(firstSegment)
      }
    }

    return prefixes
  }

  private shouldKeepMatch(key: string, allKeySet: Set<string>, knownPrefixes: Set<string>): boolean {
    if (allKeySet.has(key)) return true
    if (!this.isLikelyI18nKey(key)) return false

    const firstSegment = key.split('.')[0]
    if (!firstSegment) return false

    if (knownPrefixes.size > 0) {
      return knownPrefixes.has(firstSegment)
    }

    return this.commonI18nPrefixes.has(firstSegment)
  }

  private isLikelyI18nKey(key: string): boolean {
    if (!key || key.length < 3) return false
    if (!key.includes('.')) return false
    if (/\s/.test(key)) return false
    if (/^\.+/.test(key)) return false
    if (/[/\\]/.test(key)) return false
    if (/^[A-Z]/.test(key)) return false
    if (/\.(go|mod|sum|proto|json|yaml|yml|toml|xml|html|css|scss|less|ts|tsx|js|jsx|md)$/i.test(key)) return false
    return /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i.test(key)
  }

  private isLocaleResourcePath(filepath: string): boolean {
    const rootPath = this.store.projectConfig.rootPath
    const relative = this.normalizeProjectRelativePath(path.relative(rootPath, filepath))
    if (!relative) return false

    const parts = relative.split('/').filter(Boolean)
    if (parts.some(part => LOCALE_DIR_NAMES.includes(part))) {
      return true
    }

    return (this.store.projectConfig.localesPaths || [])
      .map(localePath => this.normalizeProjectRelativePath(localePath))
      .filter(Boolean)
      .some(localePath => relative === localePath || relative.startsWith(`${localePath}/`))
  }

  private normalizeProjectRelativePath(rawPath: string): string {
    if (!rawPath) return ''

    let normalized = rawPath
    if (path.isAbsolute(rawPath)) {
      normalized = path.relative(this.store.projectConfig.rootPath, rawPath)
    }

    normalized = normalized
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')

    return normalized === '.' ? '' : normalized
  }

  private extToLanguageId(ext: string): string {
    switch (ext) {
      case 'go': return 'go'
      case 'vue': return 'vue'
      case 'html': return 'html'
      case 'js': return 'javascript'
      case 'ts': return 'typescript'
      case 'jsx': return 'javascriptreact'
      case 'tsx': return 'typescriptreact'
      default: return ext
    }
  }
}


