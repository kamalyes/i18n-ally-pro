import { Parser, KeyStyle } from '../core/types'

export class YamlParser implements Parser {
  id = 'yaml' as const
  extensions = ['.yaml', '.yml']

  parse(text: string): Record<string, any> {
    const yaml = require('js-yaml')
    return yaml.load(text) || {}
  }

  dump(data: Record<string, any>, sort = false): string {
    const yaml = require('js-yaml')
    const toDump = sort ? this.sortKeys(data) : data
    return yaml.dump(toDump, { lineWidth: -1, quotingType: '"' })
  }

  navigateToKey(text: string, keypath: string, keystyle: KeyStyle): { line: number; column: number } | null {
    const lines = text.split('\n')
    const keys = keystyle === 'nested' ? keypath.split('.') : [keypath.split('.').pop()!]

    let currentDepth = 0
    let searchKey = keys[0]
    let targetIndent = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim() || line.trim().startsWith('#')) continue

      const indent = line.length - line.trimStart().length
      const keyMatch = line.trimStart().match(/^(\w[\w.-]*)\s*:/)

      if (keyMatch) {
        if (currentDepth < keys.length - 1) {
          if (keyMatch[1] === searchKey && (targetIndent === -1 || indent === targetIndent)) {
            targetIndent = indent + 2
            currentDepth++
            searchKey = keys[currentDepth]
          }
        }
        else if (keyMatch[1] === searchKey && (targetIndent === -1 || indent === targetIndent)) {
          return { line: i, column: indent }
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
