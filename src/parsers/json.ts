import { Parser, KeyStyle } from '../core/types'

export class JsonParser implements Parser {
  id = 'json' as const
  extensions = ['.json']

  parse(text: string): Record<string, any> {
    return JSON.parse(text)
  }

  dump(data: Record<string, any>, sort = false): string {
    const toDump = sort ? this.sortKeys(data) : data
    return JSON.stringify(toDump, null, 2) + '\n'
  }

  navigateToKey(text: string, keypath: string, keystyle: KeyStyle): { line: number; column: number } | null {
    const lines = text.split('\n')
    const keys = keystyle === 'nested' ? keypath.split('.') : [keypath]

    let currentDepth = 0
    let searchKey = keys[0]

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trimStart()
      const indent = line.length - trimmed.length

      if (currentDepth < keys.length - 1) {
        const keyMatch = trimmed.match(/^"([^"]+)"\s*:/)
        if (keyMatch && keyMatch[1] === searchKey) {
          currentDepth++
          searchKey = keys[currentDepth]
        }
      }
      else {
        const keyMatch = trimmed.match(/^"([^"]+)"\s*:/)
        if (keyMatch && keyMatch[1] === searchKey) {
          return { line: i, column: line.indexOf('"') }
        }
      }
    }

    return null
  }

  private sortKeys(obj: any): any {
    if (Array.isArray(obj))
      return obj.map(this.sortKeys)
    if (obj && typeof obj === 'object') {
      const sorted: any = {}
      for (const key of Object.keys(obj).sort())
        sorted[key] = this.sortKeys(obj[key])
      return sorted
    }
    return obj
  }
}
