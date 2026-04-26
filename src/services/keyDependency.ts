import { window, workspace, ProgressLocation, Uri } from 'vscode'
import fs from 'fs'
import { TranslationStore } from '../core/store'
import { Scanner, ScannerMatch } from '../core/types'
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

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async buildDependencyGraph(): Promise<KeyDependencyGraph> {
    const graph: KeyDependencyGraph = {}
    const rootPath = this.store.projectConfig.rootPath

    const fg = require('fast-glob')
    const codeFiles: string[] = await fg('**/*.{go,vue,js,ts,jsx,tsx,html}', {
      cwd: rootPath,
      ignore: ['vendor', 'node_modules', '.git', 'dist', 'build'],
      onlyFiles: true,
      absolute: true,
    })

    for (const filepath of codeFiles) {
      try {
        const content = fs.readFileSync(filepath, 'utf-8')
        const ext = filepath.split('.').pop() || ''
        const languageId = this.extToLanguageId(ext)

        const scanner = this.scanners.find(s => s.languageIds.includes(languageId))
        if (!scanner) continue

        const matches = scanner.scan(content, filepath)

        for (const match of matches) {
          if (!graph[match.key]) {
            graph[match.key] = []
          }
          graph[match.key].push({
            key: match.key,
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

  async showDependencyGraph(): Promise<void> {
    const graph = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Building key dependency graph...',
        cancellable: false,
      },
      async () => this.buildDependencyGraph()
    )

    const allKeys = this.store.getAllKeys()
    const referencedKeys = Object.keys(graph)
    const unreferencedKeys = allKeys.filter(k => !referencedKeys.includes(k))

    const outputChannel = window.createOutputChannel('i18n Key Dependencies')
    outputChannel.clear()

    outputChannel.appendLine('═══════════════════════════════════════════════════════')
    outputChannel.appendLine('  i18n Ally Pro - Key Dependency Graph')
    outputChannel.appendLine('═══════════════════════════════════════════════════════')
    outputChannel.appendLine('')

    outputChannel.appendLine(`📊 Summary:`)
    outputChannel.appendLine(`   Total keys: ${allKeys.length}`)
    outputChannel.appendLine(`   Referenced: ${referencedKeys.length}`)
    outputChannel.appendLine(`   Unreferenced: ${unreferencedKeys.length}`)
    outputChannel.appendLine('')

    if (referencedKeys.length > 0) {
      outputChannel.appendLine('───────────────────────────────────────────────────────')
      outputChannel.appendLine('📋 Key References (key → files that use it):')
      outputChannel.appendLine('───────────────────────────────────────────────────────')
      outputChannel.appendLine('')

      const rootPath = this.store.projectConfig.rootPath

      for (const key of referencedKeys.sort()) {
        const refs = graph[key]
        const sourceValue = this.store.getTranslation(this.store.projectConfig.sourceLanguage, key) || ''
        outputChannel.appendLine(`🔑 ${key}`)
        if (sourceValue) {
          outputChannel.appendLine(`   Value: "${sourceValue.length > 60 ? sourceValue.slice(0, 60) + '...' : sourceValue}"`)
        }
        outputChannel.appendLine(`   Referenced by ${refs.length} location(s):`)
        for (const ref of refs) {
          const relativePath = ref.filepath.replace(rootPath + '\\', '').replace(rootPath + '/', '')
          outputChannel.appendLine(`     → ${relativePath}:${ref.line}:${ref.column}`)
        }
        outputChannel.appendLine('')
      }
    }

    if (unreferencedKeys.length > 0) {
      outputChannel.appendLine('───────────────────────────────────────────────────────')
      outputChannel.appendLine('⚠️  Unreferenced Keys (not found in any code file):')
      outputChannel.appendLine('───────────────────────────────────────────────────────')
      outputChannel.appendLine('')

      for (const key of unreferencedKeys.sort()) {
        const sourceValue = this.store.getTranslation(this.store.projectConfig.sourceLanguage, key) || ''
        outputChannel.appendLine(`  ❌ ${key}  →  "${sourceValue.length > 60 ? sourceValue.slice(0, 60) + '...' : sourceValue}"`)
      }
      outputChannel.appendLine('')
    }

    outputChannel.appendLine('───────────────────────────────────────────────────────')
    outputChannel.appendLine('📈 Reverse Index (file → keys used):')
    outputChannel.appendLine('───────────────────────────────────────────────────────')
    outputChannel.appendLine('')

    const fileIndex = new Map<string, { key: string; line: number; column: number }[]>()
    for (const [key, refs] of Object.entries(graph)) {
      for (const ref of refs) {
        if (!fileIndex.has(ref.filepath)) {
          fileIndex.set(ref.filepath, [])
        }
        fileIndex.get(ref.filepath)!.push({ key, line: ref.line, column: ref.column })
      }
    }

    const rootPath2 = this.store.projectConfig.rootPath
    const sortedFiles = Array.from(fileIndex.entries()).sort((a, b) => a[0].localeCompare(b[0]))

    for (const [filepath, keys] of sortedFiles) {
      const relativePath = filepath.replace(rootPath2 + '\\', '').replace(rootPath2 + '/', '')
      outputChannel.appendLine(`📄 ${relativePath} (${keys.length} key(s))`)
      keys.sort((a, b) => a.line - b.line)
      for (const k of keys) {
        outputChannel.appendLine(`   L${k.line}:${k.column}  →  ${k.key}`)
      }
      outputChannel.appendLine('')
    }

    outputChannel.show()
  }

  async getKeyReferences(key: string): Promise<KeyReference[]> {
    const graph = await this.buildDependencyGraph()
    return graph[key] || []
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
