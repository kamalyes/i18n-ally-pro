import { Scanner, ScannerMatch } from '../core/types'

function isValidI18nKey(key: string): boolean {
  if (!key || key.length < 2) return false
  if (!key.includes('.')) return false
  if (/^\.+/ .test(key)) return false
  if (/[/\\]/.test(key)) return false
  if (/\.(ts|js|tsx|jsx|json|css|scss|less|html|vue|go|py|java|md)$/i.test(key)) return false
  return true
}

export class VueScanner implements Scanner {
  languageIds = ['vue', 'html']

  private patterns: RegExp[] = [
    /\$t\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\bt\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /i18n\s*\.\s*t\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ]

  scan(text: string, filepath: string): ScannerMatch[] {
    const matches: ScannerMatch[] = []
    const lines = text.split('\n')
    const lineOffsets = this.buildLineOffsets(lines)

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
          const absolute = lineOffsets[lineIdx] + start
          matches.push({
            key,
            start: absolute,
            end: absolute + key.length,
            line: lineIdx + 1,
            column: start,
          })
        }
      }
    }

    return this.deduplicate(matches)
  }

  /** 行首偏移前缀和：一次 O(n) 构建，取用 O(1) */
  private buildLineOffsets(lines: string[]): number[] {
    const offsets = new Array<number>(lines.length)
    let offset = 0
    for (let i = 0; i < lines.length; i++) {
      offsets[i] = offset
      offset += lines[i].length + 1
    }
    return offsets
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
