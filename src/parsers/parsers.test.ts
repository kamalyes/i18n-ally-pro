import { describe, expect, it } from 'vitest'
import { JsonParser } from './json'
import { YamlParser } from './yaml'
import { PoParser } from './po'
import { PropertiesParser } from './properties'

describe('JsonParser.dump 排序', () => {
  const parser = new JsonParser()

  it('按 key 排序嵌套对象', () => {
    const dumped = parser.dump({ b: '2', a: { d: '4', c: '3' } }, true)
    expect(dumped).toBe('{\n  "a": {\n    "c": "3",\n    "d": "4"\n  },\n  "b": "2"\n}\n')
  })

  // 回归：sortKeys 原来写成 obj.map(this.sortKeys)，回调里丢掉 this，
  // 数组元素是对象/数组时抛 TypeError: Cannot read properties of undefined
  it('数组里有对象时不抛异常', () => {
    expect(() => parser.dump({ a: [{ b: '1' }] }, true)).not.toThrow()
    expect(JSON.parse(parser.dump({ a: [{ b: '1', a: '2' }] }, true))).toEqual({ a: [{ a: '2', b: '1' }] })
  })

  it('嵌套数组不抛异常', () => {
    expect(() => parser.dump({ a: [['x']] }, true)).not.toThrow()
    expect(JSON.parse(parser.dump({ a: [['x']] }, true))).toEqual({ a: [['x']] })
  })

  it('保留字符串数组顺序', () => {
    expect(JSON.parse(parser.dump({ a: ['z', 'y'] }, true))).toEqual({ a: ['z', 'y'] })
  })
})

describe('YamlParser.dump 排序', () => {
  const parser = new YamlParser()

  it('数组里有对象时不抛异常', () => {
    expect(() => parser.dump({ a: [{ b: '1' }] }, true)).not.toThrow()
    expect(parser.parse(parser.dump({ a: [{ b: '1' }] }, true))).toEqual({ a: [{ b: '1' }] })
  })

  it('round-trip 保留数组', () => {
    const data = { plural: ['one', 'other'], nested: { k: 'v' } }
    expect(parser.parse(parser.dump(data, true))).toEqual(data)
  })
})

describe('PoParser.parse', () => {
  const parser = new PoParser()

  // 回归：原来 `if (currentKey && currentValue)` 把空 msgstr 的条目整条丢掉，
  // 待翻译条目在诊断里就变成「缺失」而不是「空」
  it('保留 msgstr 为空的条目', () => {
    const po = [
      'msgid "greeting"',
      'msgstr "Hello"',
      '',
      'msgid "farewell"',
      'msgstr ""',
      '',
    ].join('\n')

    expect(parser.parse(po)).toEqual({ greeting: 'Hello', farewell: '' })
  })

  it('忽略 po 头部条目', () => {
    const po = [
      'msgid ""',
      'msgstr "Content-Type: text/plain\\n"',
      '',
      'msgid "greeting"',
      'msgstr "Hello"',
    ].join('\n')

    expect(parser.parse(po)).toEqual({ greeting: 'Hello' })
  })

  it('拼接多行 msgstr', () => {
    const po = [
      'msgid "long"',
      'msgstr "first "',
      '"second"',
    ].join('\n')

    expect(parser.parse(po)).toEqual({ long: 'first second' })
  })

  it('dump 后能再 parse 回来', () => {
    const data = { greeting: 'Hello', empty: '' }
    expect(parser.parse(parser.dump(data, true))).toEqual(data)
  })
})

describe('PropertiesParser', () => {
  const parser = new PropertiesParser()

  it('解析 = 与 : 分隔，忽略注释', () => {
    const text = [
      '# comment',
      '! another comment',
      'a.b = value',
      'c.d:other',
      '',
    ].join('\n')

    expect(parser.parse(text)).toEqual({ 'a.b': 'value', 'c.d': 'other' })
  })

  it('dump 后能再 parse 回来', () => {
    const data = { 'a.b': 'value', 'c.d': 'multi\nline' }
    expect(parser.parse(parser.dump(data, true))).toEqual(data)
  })
})
