import { Scanner, ScannerMatch } from '../core/types'

const IGNORED_PREFIXES = [
  '../', './', '/', 'node_modules',
  'import', 'require', 'http', 'https', 'fs', 'path', 'os',
  'assert', 'buffer', 'child_process', 'cluster', 'crypto',
  'dgram', 'dns', 'domain', 'events', 'net', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url',
  'util', 'v8', 'vm', 'worker', 'zlib',
]

const IGNORED_KEY_PATTERNS = [
  /^\.{1,2}\//,
  /^node_modules/,
  /^[a-z]+:\/\/\//,
  /\.(ts|js|tsx|jsx|json|css|scss|less|html|vue|go|py|java|md)$/i,
  /^[A-Z]/,
]

function isValidI18nKey(key: string): boolean {
  if (!key || key.length < 2) return false
  if (!key.includes('.')) return false
  for (const prefix of IGNORED_PREFIXES) {
    if (key.startsWith(prefix)) return false
  }
  for (const pattern of IGNORED_KEY_PATTERNS) {
    if (pattern.test(key)) return false
  }
  if (/[/\\]/.test(key)) return false
  return true
}

export class ReactScanner implements Scanner {
  languageIds = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact']

  private patterns: RegExp[] = [
    /\bt\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /i18n\s*\.\s*t\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /i18next\s*\.\s*t\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ]

  scan(text: string, filepath: string): ScannerMatch[] {
    const matches: ScannerMatch[] = []
    const lines = text.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]
      if (/^\s*(import|export|\/\/|\/\*|\*)/.test(line)) continue
      if (/import\s*\(/.test(line)) continue

      for (const pattern of this.patterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = pattern.exec(line)) !== null) {
          const key = match[1]
          if (!key || !isValidI18nKey(key)) continue

          const start = match.index + match[0].indexOf(key)
          matches.push({
            key,
            start: this.lineOffset(lines, lineIdx) + start,
            end: this.lineOffset(lines, lineIdx) + start + key.length,
            line: lineIdx + 1,
            column: start,
          })
        }
      }
    }

    return this.deduplicate(matches)
  }

  private lineOffset(lines: string[], lineIdx: number): number {
    let offset = 0
    for (let i = 0; i < lineIdx; i++)
      offset += lines[i].length + 1
    return offset
  }

  private deduplicate(matches: ScannerMatch[]): ScannerMatch[] {
    const seen = new Set<string>()
    return matches.filter(m => {
      const id = `${m.key}:${m.line}:${m.column}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  }
}
