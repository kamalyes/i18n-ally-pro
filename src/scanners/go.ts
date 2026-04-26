import { Scanner, ScannerMatch } from '../core/types'

export class GoScanner implements Scanner {
  languageIds = ['go']

  private patterns: RegExp[] = [
    /i18n\s*\.\s*T\s*\(\s*["']([^"']+)["']/g,
    /i18n\s*\.\s*GetMessage\s*\(\s*["']([^"']+)["']/g,
    /i18n\s*\.\s*Translate\s*\(\s*["']([^"']+)["']/g,
    /GetMessage\s*\(\s*["']([^"']+)["']/g,
    /T\s*\(\s*["']([\w.]+)["']/g,
    /\w+\s*=\s*["']([\w.]+\.[\w.]+)["']/g,
  ]

  scan(text: string, filepath: string): ScannerMatch[] {
    const matches: ScannerMatch[] = []
    const lines = text.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]

      for (const pattern of this.patterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = pattern.exec(line)) !== null) {
          const key = match[1]
          if (!key || !key.includes('.') || key.length < 3) continue
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
