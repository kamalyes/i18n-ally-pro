import { Parser, KeyStyle } from '../core/types'

export class PropertiesParser implements Parser {
  id = 'properties' as const
  extensions = ['.properties']

  parse(text: string): Record<string, any> {
    const result: Record<string, string> = {}

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!'))
        continue

      const eqIndex = trimmed.indexOf('=')
      const colonIndex = trimmed.indexOf(':')
      const sepIndex = eqIndex >= 0 && colonIndex >= 0
        ? Math.min(eqIndex, colonIndex)
        : eqIndex >= 0 ? eqIndex : colonIndex

      if (sepIndex > 0) {
        const key = trimmed.slice(0, sepIndex).trim()
        const value = trimmed.slice(sepIndex + 1).trim()
        result[key] = this.unescape(value)
      }
    }

    return result
  }

  dump(data: Record<string, any>, sort = false): string {
    const entries = Object.entries(data)
    if (sort)
      entries.sort(([a], [b]) => a.localeCompare(b))

    return entries.map(([key, value]) => `${key} = ${this.escape(String(value))}`).join('\n') + '\n'
  }

  navigateToKey(text: string, keypath: string, _keystyle: KeyStyle): { line: number; column: number } | null {
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith(keypath + '=') || trimmed.startsWith(keypath + ' =') || trimmed.startsWith(keypath + ':'))
        return { line: i, column: 0 }
    }
    return null
  }

  private unescape(s: string): string {
    return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1')
  }

  private escape(s: string): string {
    return s.replace(/\n/g, '\\n').replace(/\t/g, '\\t')
  }
}
