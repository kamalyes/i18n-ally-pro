import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationStore } from './store'

const tempRoots: string[] = []

/** 建一个临时项目：files 是「相对路径 -> 文件内容」 */
async function makeStore(files: Record<string, string>): Promise<TranslationStore> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-ally-pro-'))
  tempRoots.push(root)

  for (const [relative, content] of Object.entries(files)) {
    const filepath = path.join(root, relative)
    fs.mkdirSync(path.dirname(filepath), { recursive: true })
    fs.writeFileSync(filepath, content, 'utf-8')
  }

  const store = new TranslationStore(root)
  await store.init()
  return store
}

function readJson(store: TranslationStore, locale: string): any {
  const file = store.getTranslationFiles().find(f => f.locale === locale)!
  return JSON.parse(fs.readFileSync(file.filepath, 'utf-8'))
}

afterEach(() => {
  while (tempRoots.length > 0)
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

describe('flattenObject / nestObject 数组处理', () => {
  // 回归：原来 flattenObject 用 String(value) 把 ["a","b"] 压成 "a,b"，
  // 写回时数组就变成了一个逗号拼起来的字符串
  it('数组展平为索引 key 而不是逗号拼接', async () => {
    const store = await makeStore({ 'locales/en.json': '{}' })
    const arrayPaths = new Set<string>()

    expect(store.flattenObject({ plural: ['one', 'other'] }, '', arrayPaths)).toEqual({
      'plural.0': 'one',
      'plural.1': 'other',
    })
    expect(arrayPaths.has('plural')).toBe(true)
  })

  it('nestObject 按 arrayPaths 还原为数组', async () => {
    const store = await makeStore({ 'locales/en.json': '{}' })
    const nested = store.nestObject(
      { 'plural.0': 'one', 'plural.1': 'other', 'deep.k': 'v' },
      new Set(['plural']),
    )

    expect(nested).toEqual({ plural: ['one', 'other'], deep: { k: 'v' } })
  })

  it('没给 arrayPaths 时索引 key 还原为对象', async () => {
    const store = await makeStore({ 'locales/en.json': '{}' })
    expect(store.nestObject({ 'plural.0': 'one' })).toEqual({ plural: { 0: 'one' } })
  })

  it('写回时数组仍是数组', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ plural: ['one', 'other'], title: 'Hi' }, null, 2),
    })

    await store.setTranslation('en', 'title', 'Hello')

    expect(readJson(store, 'en')).toEqual({ plural: ['one', 'other'], title: 'Hello' })
  })
})

describe('多文件语言（namespace）写回', () => {
  // 回归：writeToFile 原来把整份语言的 key 全写进「第一个匹配到的文件」，
  // 一个语言拆成多个文件时，每个 key 都会被复制到那个文件里，另一个文件保持旧内容
  it('只写回 key 所属的那个文件', async () => {
    const store = await makeStore({
      'locales/en/common.json': JSON.stringify({ hello: 'Hello' }, null, 2),
      'locales/en/errors.json': JSON.stringify({ 'error.notfound': 'Not found' }, null, 2),
    })

    expect(store.getAllKeys().sort()).toEqual(['error.notfound', 'hello'])

    await store.setTranslation('en', 'hello', 'Hi')

    const files = store.getTranslationFiles()
    const common = files.find(f => f.filepath.endsWith('common.json'))!
    const errors = files.find(f => f.filepath.endsWith('errors.json'))!

    expect(JSON.parse(fs.readFileSync(common.filepath, 'utf-8'))).toEqual({ hello: 'Hi' })
    expect(JSON.parse(fs.readFileSync(errors.filepath, 'utf-8'))).toEqual({ 'error.notfound': 'Not found' })
  })

  it('findFileForKey 返回 key 实际所在的文件', async () => {
    const store = await makeStore({
      'locales/en/common.json': JSON.stringify({ hello: 'Hello' }),
      'locales/en/errors.json': JSON.stringify({ 'error.notfound': 'Not found' }),
    })

    expect(store.findFileForKey('error.notfound', 'en')!.filepath).toMatch(/errors\.json$/)
    expect(store.findFileForKey('hello', 'en')!.filepath).toMatch(/common\.json$/)
  })

  it('新 key 落到该语言的首个文件', async () => {
    const store = await makeStore({
      'locales/en/common.json': JSON.stringify({ hello: 'Hello' }),
      'locales/en/errors.json': JSON.stringify({ 'error.notfound': 'Not found' }),
    })

    await store.setTranslation('en', 'brand.new', 'New')
    expect(store.findFileForKey('brand.new', 'en')).toBeDefined()
    expect(store.getTranslation('en', 'brand.new')).toBe('New')
  })
})

describe('setTranslation 持久化', () => {
  // 回归：原来 files.find(f => f.locale === locale) 找不到文件就直接 return，
  // 写入只留在内存里，刷新一次就全丢了（新增语言、硬编码 zh 的流程都会踩到）
  it('语言还没有文件时自动建文件', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ hello: 'Hello' }),
    })

    await store.setTranslation('ja', 'hello', 'こんにちは')

    const jaFile = store.getTranslationFiles().find(f => f.locale === 'ja')
    expect(jaFile).toBeDefined()
    expect(JSON.parse(fs.readFileSync(jaFile!.filepath, 'utf-8'))).toEqual({ hello: 'こんにちは' })

    // 重新加载后依然在
    await store.refresh()
    expect(store.getTranslation('ja', 'hello')).toBe('こんにちは')
  })

  it('setTranslations 批量写入后数据一致', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ a: '1' }),
      'locales/ja.json': '{}',
    })

    await store.setTranslations([
      { locale: 'en', key: 'b', value: '2' },
      { locale: 'ja', key: 'a', value: 'あ' },
      { locale: 'en', key: 'a', value: undefined },
    ])

    expect(readJson(store, 'en')).toEqual({ b: '2' })
    expect(readJson(store, 'ja')).toEqual({ a: 'あ' })
  })
})

describe('key 风格保持', () => {
  // 回归：getWriteKeyStyle 对 json 一律返回 'nested'，
  // 本来是扁平 key 的文件第一次编辑就被整体重排成嵌套结构
  it('扁平 json 编辑后仍是扁平', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ 'error.user.not_found': 'Not found' }, null, 2),
    })

    expect(store.projectConfig.keystyle).toBe('flat')
    await store.setTranslation('en', 'error.user.gone', 'Gone')

    expect(readJson(store, 'en')).toEqual({
      'error.user.not_found': 'Not found',
      'error.user.gone': 'Gone',
    })
  })

  it('嵌套 json 编辑后仍是嵌套', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ error: { user: { not_found: 'Not found' } } }, null, 2),
    })

    expect(store.projectConfig.keystyle).toBe('nested')
    await store.setTranslation('en', 'error.user.gone', 'Gone')

    expect(readJson(store, 'en')).toEqual({
      error: { user: { not_found: 'Not found', gone: 'Gone' } },
    })
  })
})

describe('cloneLocale', () => {
  it('复制到新语言并按源文件的扩展名建文件', async () => {
    const store = await makeStore({
      'locales/en.yaml': 'hello: Hello\nbye: Bye\n',
    })

    const result = await store.cloneLocale('en', 'de')

    expect(result.cloned).toBe(2)
    const deFile = store.getTranslationFiles().find(f => f.locale === 'de')!
    // 回归：原来无论源文件是什么格式，新文件都用 JSON.stringify 写，
    // yaml 项目会得到一个内容是 JSON 的 .yaml 文件
    expect(deFile.filepath).toMatch(/de\.yaml$/)
    expect(deFile.parser).toBe('yaml')

    await store.refresh()
    expect(store.getTranslation('de', 'hello')).toBe('Hello')
  })

  it('默认不覆盖已有非空译文', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ a: 'A', b: 'B' }),
      'locales/de.json': JSON.stringify({ a: 'bereits' }),
    })

    const result = await store.cloneLocale('en', 'de')

    expect(result).toEqual({ cloned: 1, skipped: 1 })
    expect(store.getTranslation('de', 'a')).toBe('bereits')
    expect(store.getTranslation('de', 'b')).toBe('B')
  })
})

describe('key 索引与 locale 匹配', () => {
  it('getAllKeys 汇总所有语言的 key 且在变更后更新', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ a: 'A' }),
      'locales/ja.json': JSON.stringify({ b: 'B' }),
    })

    expect(store.getAllKeys().sort()).toEqual(['a', 'b'])
    expect(store.hasKey('a')).toBe(true)
    expect(store.hasKey('zzz')).toBe(false)

    await store.setTranslation('en', 'c', 'C')
    expect(store.getAllKeys().sort()).toEqual(['a', 'b', 'c'])
    expect(store.hasKey('c')).toBe(true)

    await store.deleteTranslation('en', 'c')
    expect(store.hasKey('c')).toBe(false)
  })

  it('en 与 en-US 互认', async () => {
    const store = await makeStore({
      'locales/en-US.json': JSON.stringify({ a: 'A' }),
    })

    expect(store.matchLocale('en')).toBe('en-US')
    expect(store.getTranslation('en', 'a')).toBe('A')
  })

  it('resolveSourceTranslation 支持 key 路径别名', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ 'menu.save': 'Save' }),
    })

    expect(store.resolveSourceTranslation('save')).toEqual({
      locale: 'en',
      value: 'Save',
      resolvedKey: 'menu.save',
    })
  })
})

describe('getDiagnostics', () => {
  it('区分缺失与空值', async () => {
    const store = await makeStore({
      'locales/en.json': JSON.stringify({ a: 'A', b: 'B' }),
      'locales/ja.json': JSON.stringify({ a: '' }),
    })

    const diagnostics = store.getDiagnostics()

    expect(diagnostics).toContainEqual({ type: 'empty', key: 'a', locale: 'ja' })
    expect(diagnostics).toContainEqual({ type: 'missing', key: 'b', locale: 'ja' })
    expect(diagnostics.some(d => d.locale === 'en')).toBe(false)
  })
})
