import { describe, expect, it } from 'vitest'
import { ReactScanner } from './react'
import { VueScanner } from './vue'

// 这两个扫描器本次没有改动，这里只锁住现有行为，防止后续重构顺手改坏
describe('ReactScanner 现有行为', () => {
  const scanner = new ReactScanner()

  it('languageIds 不变', () => {
    expect(scanner.languageIds).toEqual([
      'javascript', 'javascriptreact', 'typescript', 'typescriptreact',
    ])
  })

  it('识别 t / i18n.t / i18next.t', () => {
    const src = [
      'const a = t("home.title")',
      'const b = i18n.t(\'user.name\')',
      'const c = i18next.t(`order.total`)',
    ].join('\n')
    expect(scanner.scan(src, '/app/a.tsx').map(m => m.key))
      .toEqual(['home.title', 'user.name', 'order.total'])
  })

  it('仍然要求点号、忽略 import 与路径', () => {
    const src = [
      'import { t } from "i18next"',
      'const flat = t("welcome")',
      'const rel = t("./a.json")',
    ].join('\n')
    expect(scanner.scan(src, '/app/a.tsx').map(m => m.key)).toEqual([])
  })

  it('偏移与原文一致', () => {
    const src = 'const a = t("home.title")'
    const [match] = scanner.scan(src, '/app/a.tsx')
    expect(src.slice(match.start, match.end)).toBe('home.title')
    expect(match.line).toBe(1)
  })
})

describe('VueScanner 现有行为', () => {
  const scanner = new VueScanner()

  it('languageIds 不变', () => {
    expect(scanner.languageIds).toEqual(['vue', 'html'])
  })

  it('识别 $t / t / i18n.t', () => {
    const src = [
      '<span>{{ $t("nav.home") }}</span>',
      'const b = t(\'nav.about\')',
      'const c = i18n.t("nav.help")',
    ].join('\n')
    expect(scanner.scan(src, '/app/a.vue').map(m => m.key))
      .toEqual(['nav.home', 'nav.about', 'nav.help'])
  })

  it('仍然要求点号', () => {
    expect(scanner.scan('<span>{{ $t("welcome") }}</span>', '/app/a.vue')).toEqual([])
  })
})
