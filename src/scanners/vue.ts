import { Scanner, ScannerMatch } from '../core/types'

export class VueScanner implements Scanner {
  languageIds = ['vue', 'html']

  private patterns: RegExp[] = [
    /\$t\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /t\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /i18n\s*\.\s*t\s*\(\s*['"`]([^'"`]+)['"`]/g,
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
          if (!key) continue

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
