import { Scanner, ScannerMatch } from '../core/types'

/**
 * go-i18n 的翻译入口分两族，key 一律落在第 2 个参数上：
 *   - context 优先：T(ctx, key, args...) / TWithMap(ctx, key, data)
 *                   GetMsgByKey(ctx, key) / GetMsgWithMap(ctx, key, data)
 *   - language 优先：Manager.GetMessage(lang, key, args...)
 *                   Manager.GetMessageWithMap(lang, key, data)
 */
const I18N_FUNCTION_NAMES = [
  'T',
  'TWithMap',
  'GetMsgByKey',
  'GetMsgWithMap',
  'GetMessage',
  'GetMessageWithMap',
]

/**
 * Translate / TranslateWithMap 是历史包装函数，名字又太通用
 * （例如 go-argus 的 ValidationErrors.Translate("en") 跟 i18n 无关），
 * 只有前缀里出现 i18n 时才算
 */
const LEGACY_FUNCTION_NAMES = [
  'Translate',
  'TranslateWithMap',
]

/** 包名/接收者前缀：i18n. / goi18n. / middleware. / s.i18n. / 无前缀 */
const QUALIFIER = '(?:\\b[A-Za-z_]\\w*\\s*\\.\\s*)*'

/** 长名优先，避免 T 先吃掉 TWithMap 时产生额外回溯 */
function buildCallPattern(names: string[], requireI18nQualifier: boolean): RegExp {
  const alternatives = [...names].sort((a, b) => b.length - a.length).join('|')
  const prefix = requireI18nQualifier
    ? `${QUALIFIER}\\b\\w*[iI]18[nN]\\w*\\s*\\.\\s*`
    : QUALIFIER
  return new RegExp(`${prefix}\\b(?:${alternatives})\\s*\\(`, 'g')
}

const CALL_PATTERN = buildCallPattern(I18N_FUNCTION_NAMES, false)
const LEGACY_CALL_PATTERN = buildCallPattern(LEGACY_FUNCTION_NAMES, true)

/**
 * 只有前缀里出现 i18n 才允许单参数退化写法 i18n.T("success")
 * 否则 ve.Translate("xx") / x.GetMessage("fallback") 这类会被误判
 */
const I18N_QUALIFIER = /[iI]18[nN]/

/**
 * 兜底模式：常量 / 变量 / 结构体字段上的裸字符串
 * 只有调用方显式提供 isKnownKey（通常是「能在 locale 文件里查到」）时才启用，
 * 否则 "127.0.0.1" / "1.2.3" / "config.yaml" 这类会被当成 key
 */
const ASSIGNMENT_PATTERN = /\b[\w.]+\s*(?::=|=|:)\s*(["`])([^"`\n]+)\1/g

/** key 允许的字符集：字母数字下划线 + . - : */
const KEY_CHARSET = /^[\w.:-]+$/
/** 看起来像文件名的字符串不是 key */
const FILE_LIKE = /\.(go|mod|sum|proto|json|ya?ml|toml|ini|txt|md|html?|css|js|ts|png|svg)$/i
/** 纯数字 + 点：IP、版本号 */
const NUMERIC_LIKE = /^[\d.]+$/

const GO_KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
])

/** 校验一个字符串是否可能是 i18n key；扁平 key（welcome / success）同样合法 */
export function isValidI18nKey(key: string): boolean {
  if (!key || key.length < 2) return false
  if (!KEY_CHARSET.test(key)) return false
  if (key.startsWith('.') || key.endsWith('.') || key.includes('..')) return false
  if (NUMERIC_LIKE.test(key)) return false
  if (FILE_LIKE.test(key)) return false
  return true
}

/** 兜底模式专用：首段是 Go 关键字的基本是代码而不是 key */
function isGoKeywordHead(key: string): boolean {
  return GO_KEYWORDS.has(key.split('.')[0])
}

interface OffsetRange {
  start: number
  end: number
}

interface SanitizedSource {
  /** 注释替换为空格（换行保留）后的代码视图，偏移与原文一一对应 */
  code: string
  /** 字符串字面量的内容区间（已排序），用于判断匹配是否落在字符串内部 */
  stringRanges: OffsetRange[]
}

/**
 * 一次扫描整份源码：剔除注释、记录字符串字面量区间
 * 全文处理（而不是逐行）才能匹配 Go 里常见的换行调用
 */
function sanitize(text: string): SanitizedSource {
  const n = text.length
  const comments: OffsetRange[] = []
  const stringRanges: OffsetRange[] = []
  let i = 0

  while (i < n) {
    const c = text[i]

    if (c === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i + 2)
      if (j < 0) j = n
      comments.push({ start: i, end: j })
      i = j
      continue
    }

    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const j = close < 0 ? n : close + 2
      comments.push({ start: i, end: j })
      i = j
      continue
    }

    // 解释型字符串与 rune 字面量：不跨行，支持反斜杠转义
    if (c === '"' || c === '\'') {
      let j = i + 1
      while (j < n) {
        const d = text[j]
        if (d === '\\') { j += 2; continue }
        if (d === c || d === '\n') break
        j++
      }
      const end = Math.min(j, n)
      stringRanges.push({ start: i + 1, end })
      i = j < n && text[j] === c ? j + 1 : end
      continue
    }

    // 原生字符串：可跨行
    if (c === '`') {
      const close = text.indexOf('`', i + 1)
      const j = close < 0 ? n : close
      stringRanges.push({ start: i + 1, end: j })
      i = j + 1
      continue
    }

    i++
  }

  let code = text
  if (comments.length > 0) {
    const chars = text.split('')
    for (const range of comments) {
      for (let k = range.start; k < range.end; k++) {
        if (chars[k] !== '\n') chars[k] = ' '
      }
    }
    code = chars.join('')
  }

  return { code, stringRanges }
}

/** 偏移落在任一区间内（区间有序，二分查找） */
function isInsideRanges(ranges: OffsetRange[], offset: number): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = ranges[mid]
    if (offset < range.start) hi = mid - 1
    else if (offset >= range.end) lo = mid + 1
    else return true
  }
  return false
}

/** 行号索引：前缀和 + 二分，替代原先每次匹配都重走一遍前文的 O(n²) 写法 */
class LineIndex {
  private starts: number[] = [0]

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') this.starts.push(i + 1)
    }
  }

  lineOf(offset: number): number {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  startOf(line: number): number {
    return this.starts[line]
  }
}

interface RawArg {
  /** 去掉首尾空白后的参数原文 */
  text: string
  /** text 首字符在源码中的绝对偏移 */
  start: number
}

/** 单个调用最多向后扫描的字符数，防止括号不配对时退化 */
const ARG_SCAN_BUDGET = 4000

/**
 * 从左括号开始取参数，最多 maxArgs 个
 * 括号/方括号/花括号计深度，字符串与 rune 整体跳过，所以 map[string]any{...} 不会被当成分隔
 */
function readArgs(code: string, openParen: number, maxArgs: number): RawArg[] {
  const args: RawArg[] = []
  const limit = Math.min(code.length, openParen + ARG_SCAN_BUDGET)
  let depth = 1
  let argStart = openParen + 1
  let i = argStart

  const push = (end: number) => {
    const raw = code.slice(argStart, end)
    const lead = raw.length - raw.trimStart().length
    args.push({ text: raw.trim(), start: argStart + lead })
  }

  while (i < limit) {
    const c = code[i]

    if (c === '"' || c === '\'') {
      let j = i + 1
      while (j < limit) {
        const d = code[j]
        if (d === '\\') { j += 2; continue }
        if (d === c || d === '\n') break
        j++
      }
      i = j < limit && code[j] === c ? j + 1 : j
      continue
    }

    if (c === '`') {
      const close = code.indexOf('`', i + 1)
      i = close < 0 ? limit : close + 1
      continue
    }

    if (c === '(' || c === '[' || c === '{') {
      depth++
      i++
      continue
    }

    if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        push(i)
        return args
      }
      i++
      continue
    }

    if (c === ',' && depth === 1) {
      push(i)
      if (args.length >= maxArgs) return args
      argStart = i + 1
      i++
      continue
    }

    i++
  }

  return args
}

/**
 * 取 key 所在的参数：
 *   - 两个及以上参数：第 2 个（ctx 优先与 language 优先两族都成立）
 *   - 恰好一个参数：第 1 个，且仅限 i18n 前缀的调用（兼容 i18n.T("success") 这类退化写法）
 */
function pickKeyArg(args: RawArg[], allowSingleArg: boolean): RawArg | null {
  if (args.length === 0) return null
  if (args.length === 1) return allowSingleArg ? args[0] : null
  return args[1]
}

/** 参数必须是单个字符串字面量；"a" + b 这类拼接表达式不取 */
function parseKeyLiteral(arg: RawArg): { key: string; start: number } | null {
  const text = arg.text
  if (text.length < 2) return null

  const quote = text[0]
  if (quote !== '"' && quote !== '`') return null
  if (text[text.length - 1] !== quote) return null

  const inner = text.slice(1, -1)
  if (quote === '"' && /(?:^|[^\\])"/.test(inner)) return null
  if (quote === '`' && inner.includes('`')) return null

  return { key: inner, start: arg.start + 1 }
}

export interface GoScannerOptions {
  /** 已知 key 判定；提供后才启用常量/赋值兜底扫描 */
  isKnownKey?: (key: string) => boolean
  /** isKnownKey 的便捷形式：直接给一组已知 key */
  knownKeys?: Iterable<string>
}

export class GoScanner implements Scanner {
  languageIds = ['go']

  private isKnownKey: ((key: string) => boolean) | null

  constructor(options: GoScannerOptions = {}) {
    if (options.isKnownKey) {
      this.isKnownKey = options.isKnownKey
    }
    else if (options.knownKeys) {
      const known = options.knownKeys instanceof Set
        ? options.knownKeys as Set<string>
        : new Set(options.knownKeys)
      this.isKnownKey = (key: string) => known.has(key)
    }
    else {
      this.isKnownKey = null
    }
  }

  scan(text: string, _filepath: string): ScannerMatch[] {
    const { code, stringRanges } = sanitize(text)
    const lineIndex = new LineIndex(text)
    const matches: ScannerMatch[] = []

    let match: RegExpExecArray | null

    for (const pattern of [CALL_PATTERN, LEGACY_CALL_PATTERN]) {
      pattern.lastIndex = 0

      while ((match = pattern.exec(code)) !== null) {
        // 写在字符串里的调用（文档示例、模板）不算
        if (isInsideRanges(stringRanges, match.index)) continue

        const openParen = match.index + match[0].length - 1
        const args = readArgs(code, openParen, 2)
        const keyArg = pickKeyArg(args, I18N_QUALIFIER.test(match[0]))
        if (!keyArg) continue

        const literal = parseKeyLiteral(keyArg)
        if (!literal || !isValidI18nKey(literal.key)) continue

        matches.push(this.toMatch(literal.key, literal.start, lineIndex))
      }
    }

    if (this.isKnownKey) {
      ASSIGNMENT_PATTERN.lastIndex = 0
      while ((match = ASSIGNMENT_PATTERN.exec(code)) !== null) {
        if (isInsideRanges(stringRanges, match.index)) continue

        const key = match[2]
        if (!isValidI18nKey(key) || isGoKeywordHead(key)) continue
        if (!this.isKnownKey(key)) continue

        // match[0] 以闭合引号结尾，key 内容紧贴在它前面
        const start = match.index + match[0].length - 1 - key.length
        matches.push(this.toMatch(key, start, lineIndex))
      }
    }

    return this.deduplicate(matches)
  }

  private toMatch(key: string, start: number, lineIndex: LineIndex): ScannerMatch {
    const line = lineIndex.lineOf(start)
    return {
      key,
      start,
      end: start + key.length,
      line: line + 1,
      column: start - lineIndex.startOf(line),
    }
  }

  private deduplicate(matches: ScannerMatch[]): ScannerMatch[] {
    const seen = new Set<string>()
    return matches
      .sort((a, b) => a.start - b.start || a.key.localeCompare(b.key))
      .filter(m => {
        const id = `${m.key}:${m.line}:${m.column}`
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
  }
}
