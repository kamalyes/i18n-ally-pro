import { Scanner, ScannerMatch } from '../core/types'

function isValidI18nKey(key: string): boolean {
  if (!key || key.length < 3) return false
  if (!key.includes('.')) return false
  if (/^\.+/.test(key)) return false
  if (/[/\\]/.test(key)) return false
  if (/\.(go|mod|sum|proto)$/i.test(key)) return false
  return true
}

export class GoScanner implements Scanner {
  languageIds = ['go']

  private patterns: RegExp[] = [
    /i18n\s*\.\s*T\s*\(\s*["']([^"']+)["']/g,
    /i18n\s*\.\s*GetMessage\s*\(\s*["']([^"']+)["']/g,
    /i18n\s*\.\s*Translate\s*\(\s*["']([^"']+)["']/g,
    /GetMessage\s*\(\s*["']([^"']+)["']/g,
    /\bT\s*\(\s*["']([\w.]+)["']/g,
    /\w+\s*=\s*["']([\w.]+\.[\w.]+)["']/g,
  ]

  scan(text: string, filepath: string): ScannerMatch[] {
    const matches: ScannerMatch[] = []
    const lines = text.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue
      if (/^\s*import\s/.test(line)) continue

      for (const pattern of this.patterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = pattern.exec(line)) !== null) {
          const key = match[1]
          if (!key || !isValidI18nKey(key)) continue
          if (this.isGoKeyword(key)) continue

          const start = match.index + match[0].indexOf(key)
          const column = start

          matches.push({
            key,
            start: this.lineOffset(lines, lineIdx) + start,
            end: this.lineOffset(lines, lineIdx) + start + key.length,
            line: lineIdx + 1,
            column,
          })
        }
      }
    }

    return this.deduplicate(matches)
  }

  private isGoKeyword(key: string): boolean {
    const keywords = ['type', 'func', 'var', 'const', 'struct', 'interface', 'package', 'import', 'return', 'defer', 'go', 'range']
    return keywords.includes(key.split('.')[0])
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
