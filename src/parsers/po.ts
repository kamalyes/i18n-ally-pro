import { Parser, KeyStyle } from '../core/types'

export class PoParser implements Parser {
  id = 'po' as const
  extensions = ['.po']

  parse(text: string): Record<string, any> {
    const result: Record<string, string> = {}
    let currentKey = ''
    let currentValue = ''
    let inMsgstr = false

    let hasMsgstr = false

    // msgstr 为空的条目也要落到结果里（空翻译 ≠ 不存在），
    // 否则待翻译的条目在诊断里会显示成「缺失」而不是「空」
    const commit = () => {
      if (currentKey && hasMsgstr)
        result[currentKey] = currentValue
    }

    for (const line of text.split('\n')) {
      const trimmed = line.trim()

      if (trimmed.startsWith('msgid ')) {
        commit()
        currentKey = this.extractPoString(trimmed.slice(6))
        currentValue = ''
        inMsgstr = false
        hasMsgstr = false
      }
      else if (trimmed.startsWith('msgstr ')) {
        currentValue = this.extractPoString(trimmed.slice(7))
        inMsgstr = true
        hasMsgstr = true
      }
      else if (trimmed.startsWith('"') && inMsgstr) {
        currentValue += this.extractPoString(trimmed)
      }
    }

    commit()

    // po 头部（msgid ""）不是翻译条目
    delete result['']

    return result
  }

  dump(data: Record<string, any>, sort = false): string {
    const entries = Object.entries(data)
    if (sort)
      entries.sort(([a], [b]) => a.localeCompare(b))

    let result = ''
    for (const [key, value] of entries) {
      result += `msgid "${this.escapePoString(key)}"\n`
      result += `msgstr "${this.escapePoString(String(value))}"\n\n`
    }
    return result
  }

  navigateToKey(text: string, keypath: string, _keystyle: KeyStyle): { line: number; column: number } | null {
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('msgid ') && lines[i].includes(keypath))
        return { line: i, column: lines[i].indexOf('"') }
    }
    return null
  }

  private extractPoString(s: string): string {
    return s.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }

  private escapePoString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  }
}
