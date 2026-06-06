import type { TextDocument } from 'vscode'
import { Scanner, ScannerMatch } from '../core/types'
import { GoScanner } from './go'
import { VueScanner } from './vue'
import { ReactScanner } from './react'

/** 扫描器只需要 store 的 key 白名单判定 */
interface KeyLookup {
  hasKey(key: string): boolean
}

/**
 * 同一文档版本的扫描结果缓存。
 *
 * hover / codelens / 定义跳转 / 快速修复 / 诊断原本各自 new 一套扫描器，
 * 每次触发都把整份文件重新 sanitize + 正则扫一遍；一次鼠标悬停可能触发四次全文扫描。
 * 这里按 (uri, document.version, 翻译数据版本) 缓存，一个文档版本只扫一次。
 */
const MAX_ENTRIES = 32

interface CacheEntry {
  version: number
  generation: number
  matches: ScannerMatch[]
}

const scannerRegistry = new WeakMap<KeyLookup, Scanner[]>()
const cache = new Map<string, CacheEntry>()
/** 翻译数据版本：store 变更后旧的扫描结果（含 isKnownKey 判定）不再可信 */
let generation = 0

export function getScanners(store: KeyLookup): Scanner[] {
  let scanners = scannerRegistry.get(store)
  if (!scanners) {
    scanners = [
      new GoScanner({ isKnownKey: key => store.hasKey(key) }),
      new VueScanner(),
      new ReactScanner(),
    ]
    scannerRegistry.set(store, scanners)
  }
  return scanners
}

export function scanDocument(store: KeyLookup, document: TextDocument): ScannerMatch[] {
  const cacheKey = document.uri.toString()
  const hit = cache.get(cacheKey)
  if (hit && hit.version === document.version && hit.generation === generation)
    return hit.matches

  const matches: ScannerMatch[] = []
  for (const scanner of getScanners(store)) {
    if (!scanner.languageIds.includes(document.languageId)) continue
    matches.push(...scanner.scan(document.getText(), document.uri.fsPath))
  }

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(cacheKey, { version: document.version, generation, matches })

  return matches
}

/** 光标偏移落在哪个 key 上 */
export function findMatchAt(matches: readonly ScannerMatch[], offset: number): ScannerMatch | undefined {
  return matches.find(m => offset >= m.start && offset <= m.end)
}

export function invalidateScanCache() {
  generation++
  cache.clear()
}
