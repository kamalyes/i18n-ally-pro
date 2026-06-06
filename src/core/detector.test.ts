import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectDetector } from './detector'

const tempRoots: string[] = []

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-ally-pro-detect-'))
  tempRoots.push(root)

  for (const [relative, content] of Object.entries(files)) {
    const filepath = path.join(root, relative)
    fs.mkdirSync(path.dirname(filepath), { recursive: true })
    fs.writeFileSync(filepath, content, 'utf-8')
  }

  return root
}

afterEach(() => {
  while (tempRoots.length > 0)
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

describe('locales 目录与语言识别', () => {
  it('扁平布局 locales/en.json', async () => {
    const root = makeProject({
      'locales/en.json': '{"a":"A"}',
      'locales/ja.json': '{"a":"あ"}',
    })

    const config = await new ProjectDetector(root).detect()

    expect(config.localesPaths).toEqual(['locales'])
    const files = await new ProjectDetector(root).findTranslationFiles(config.localesPaths)
    expect(files.map(f => f.locale).sort()).toEqual(['en', 'ja'])
  })

  // 回归：原来 localesPaths 取的是「文件所在目录」，于是 locales/en 被当成根目录，
  // 语言从文件名解析 => common / errors 变成两门假语言，en 反而消失了
  it('namespace 布局 locales/<语言>/<命名空间>.json', async () => {
    const root = makeProject({
      'locales/en/common.json': '{"hello":"Hello"}',
      'locales/en/errors.json': '{"error.notfound":"Not found"}',
      'locales/ja/common.json': '{"hello":"こんにちは"}',
    })

    const detector = new ProjectDetector(root)
    const config = await detector.detect()

    expect(config.localesPaths).toEqual(['locales'])
    expect(config.namespace).toBe(true)

    const files = await detector.findTranslationFiles(config.localesPaths)
    expect(new Set(files.map(f => f.locale))).toEqual(new Set(['en', 'ja']))
    expect(files.filter(f => f.locale === 'en')).toHaveLength(2)
  })

  it('嵌套在子目录里的 locales 根', async () => {
    const root = makeProject({
      'src/i18n/locales/en.json': '{"a":"A"}',
    })

    const config = await new ProjectDetector(root).detect()
    expect(config.localesPaths).toEqual(['src/i18n/locales'])
  })

  it('单语言文件不算 namespace 布局', async () => {
    const root = makeProject({
      'locales/en.json': '{"a":"A"}',
      'locales/ja.json': '{"a":"あ"}',
    })

    const config = await new ProjectDetector(root).detect()
    expect(config.namespace).toBe(false)
  })
})

describe('key 风格识别', () => {
  it('嵌套对象识别为 nested', async () => {
    const root = makeProject({ 'locales/en.json': '{"error":{"user":{"gone":"Gone"}}}' })
    expect((await new ProjectDetector(root).detect()).keystyle).toBe('nested')
  })

  it('点号 key 识别为 flat', async () => {
    const root = makeProject({ 'locales/en.json': '{"error.user.gone":"Gone"}' })
    expect((await new ProjectDetector(root).detect()).keystyle).toBe('flat')
  })

  // 回归：数组被 isNested 跳过，只含数组的文件被判成 flat，
  // 写回时数组会被拆成 plural.0 / plural.1
  it('含数组的文件识别为 nested', async () => {
    const root = makeProject({ 'locales/en.json': '{"plural":["one","other"]}' })
    expect((await new ProjectDetector(root).detect()).keystyle).toBe('nested')
  })

  // 回归：原来对任何文件都用 JSON.parse，yaml 项目永远落到 catch 里返回 flat
  it('嵌套的 yaml 识别为 nested', async () => {
    const root = makeProject({ 'locales/en.yaml': 'error:\n  user:\n    gone: Gone\n' })
    const config = await new ProjectDetector(root).detect()

    expect(config.parsers).toEqual(['yaml'])
    expect(config.keystyle).toBe('nested')
  })

  it('扁平的 yaml 识别为 flat', async () => {
    const root = makeProject({ 'locales/en.yaml': '"error.user.gone": Gone\n' })
    expect((await new ProjectDetector(root).detect()).keystyle).toBe('flat')
  })
})

describe('源语言识别', () => {
  it('优先 en-US', async () => {
    const root = makeProject({
      'locales/en-US.json': '{"a":"A"}',
      'locales/ja.json': '{"a":"あ"}',
    })
    expect((await new ProjectDetector(root).detect()).sourceLanguage).toBe('en-US')
  })

  it('没有英文时回退到常见语言', async () => {
    const root = makeProject({
      'locales/ja.json': '{"a":"あ"}',
      'locales/zh.json': '{"a":"中"}',
    })
    const source = (await new ProjectDetector(root).detect()).sourceLanguage
    expect(['ja', 'zh']).toContain(source)
  })
})
