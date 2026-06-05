import { describe, expect, it } from 'vitest'
import { GoScanner, isValidI18nKey } from './go'

const scanner = new GoScanner()

/** 只取 key，按出现顺序 */
function keysOf(src: string, instance: GoScanner = scanner): string[] {
  return instance.scan(src, '/project/main.go').map(m => m.key)
}

interface Case {
  name: string
  src: string
  keys: string[]
}

function runCases(cases: Case[], instance: GoScanner = scanner) {
  for (const c of cases) {
    it(c.name, () => {
      expect(keysOf(c.src, instance)).toEqual(c.keys)
    })
  }
}

// 缺陷 1：go-i18n 真实签名第一个参数是 ctx，旧模式要求 "(" 后紧跟引号，一个都匹配不到
describe('缺陷 1 - context 优先的调用形式', () => {
  runCases([
    {
      name: 'T(ctx, key, args...)',
      src: 'msg := i18n.T(ctx, "greeting", "John")',
      keys: ['greeting'],
    },
    {
      name: 'TWithMap(ctx, key, map)',
      src: 'msg := i18n.TWithMap(ctx, "greeting", map[string]any{"name": "John"})',
      keys: ['greeting'],
    },
    {
      name: 'GetMsgByKey(ctx, key)',
      src: 'msg := i18n.GetMsgByKey(ctx, "hello")',
      keys: ['hello'],
    },
    {
      name: 'GetMsgWithMap(ctx, key, data)',
      src: 'msg := i18n.GetMsgWithMap(ctx, "user.info", templateData)',
      keys: ['user.info'],
    },
    {
      name: '包别名前缀 goi18n.',
      src: 'return goi18n.T(ctx, "error.not_found")',
      keys: ['error.not_found'],
    },
    {
      name: '多级接收者前缀 s.i18n.',
      src: 'msg := s.i18n.T(ctx, "error.internal")',
      keys: ['error.internal'],
    },
    {
      name: '无前缀裸调用',
      src: 'msg := T(ctx, "goodbye")',
      keys: ['goodbye'],
    },
    {
      name: '第一个参数是表达式',
      src: 'msg := i18n.T(r.Context(), "welcome")',
      keys: ['welcome'],
    },
    {
      name: '退化写法：只有一个字符串参数',
      src: 'msg := i18n.T("success")',
      keys: ['success'],
    },
    {
      name: '同一行多次调用',
      src: 'a, b := i18n.T(ctx, "welcome"), i18n.T(ctx, "goodbye")',
      keys: ['welcome', 'goodbye'],
    },
    {
      name: '空格与换行容错',
      src: 'msg := i18n . T ( ctx , "user.created" )',
      keys: ['user.created'],
    },
    {
      name: '原生字符串（反引号）key',
      src: 'msg := i18n.T(ctx, `user.updated`)',
      keys: ['user.updated'],
    },
  ])
})

// 缺陷 2：旧 isValidI18nKey 强制要求含 "."，真实 locale 文件里的扁平键永远扫不到
describe('缺陷 2 - 扁平键', () => {
  runCases([
    { name: 'welcome', src: 'msg := i18n.T(ctx, "welcome")', keys: ['welcome'] },
    { name: 'success', src: 'msg := i18n.GetMsgByKey(ctx, "success")', keys: ['success'] },
    { name: 'hello', src: 'msg := goi18n.GetMsgByKey(ctx, "hello")', keys: ['hello'] },
    { name: 'goodbye', src: 'msg := goi18n.T(ctx, "goodbye")', keys: ['goodbye'] },
    { name: '两字符扁平键', src: 'msg := i18n.T(ctx, "ok")', keys: ['ok'] },
    { name: '单字符过短不取', src: 'msg := i18n.T(ctx, "a")', keys: [] },
    { name: '点分键照旧可用', src: 'msg := i18n.T(ctx, "validation.min_length")', keys: ['validation.min_length'] },
    { name: '带连字符与冒号的键', src: 'msg := i18n.T(ctx, "err-code:1001")', keys: ['err-code:1001'] },
  ])

  it('isValidI18nKey 不再强制要求点号', () => {
    expect(isValidI18nKey('welcome')).toBe(true)
    expect(isValidI18nKey('error.not_found')).toBe(true)
    expect(isValidI18nKey('127.0.0.1')).toBe(false)
    expect(isValidI18nKey('1.2.3')).toBe(false)
    expect(isValidI18nKey('config.yaml')).toBe(false)
    expect(isValidI18nKey('.leading')).toBe(false)
    expect(isValidI18nKey('trailing.')).toBe(false)
    expect(isValidI18nKey('a..b')).toBe(false)
    expect(isValidI18nKey('github.com/kamalyes/go-i18n')).toBe(false)
  })
})

// 缺陷 3：go-i18n 顶层 T 系函数 + Manager 的两个方法（language 优先，key 仍在第 2 位）
describe('缺陷 3 - 覆盖全部导出函数', () => {
  runCases([
    { name: 'T', src: 'i18n.T(ctx, "k.t")', keys: ['k.t'] },
    { name: 'TWithMap', src: 'i18n.TWithMap(ctx, "k.twithmap", data)', keys: ['k.twithmap'] },
    { name: 'GetMsgByKey', src: 'i18n.GetMsgByKey(ctx, "k.getmsgbykey")', keys: ['k.getmsgbykey'] },
    { name: 'GetMsgWithMap', src: 'i18n.GetMsgWithMap(ctx, "k.getmsgwithmap", data)', keys: ['k.getmsgwithmap'] },
    { name: 'Manager.GetMessage(lang, key)', src: 'manager.GetMessage("en", "welcome")', keys: ['welcome'] },
    { name: 'Manager.GetMessage(lang, key, args...)', src: 'manager.GetMessage("zh", "welcome", "张三")', keys: ['welcome'] },
    { name: 'Manager.GetMessageWithMap(lang, key, data)', src: 'manager.GetMessageWithMap("en", "legacy", map[string]any{"Name": "John"})', keys: ['legacy'] },
    { name: 'Translate 历史包装函数（需 i18n 前缀）', src: 'i18n.Translate(ctx, "error.bad_request")', keys: ['error.bad_request'] },
    { name: 'TranslateWithMap 历史包装函数', src: 'goi18n.TranslateWithMap(ctx, "user.updated", data)', keys: ['user.updated'] },
    { name: '多级前缀里带 i18n 的 Translate', src: 'msg := s.i18n.Translate(ctx, "error.internal")', keys: ['error.internal'] },
    { name: '语言参数本身不会被当成 key', src: 'manager.GetMessage("en", "notfound")', keys: ['notfound'] },
  ])

  it('一份混合源码里 6 个函数全部命中', () => {
    const src = [
      'package service',
      '',
      'func handle(ctx context.Context) {',
      '  _ = i18n.T(ctx, "welcome")',
      '  _ = i18n.TWithMap(ctx, "user.created", map[string]any{"name": "John"})',
      '  _ = i18n.GetMsgByKey(ctx, "success")',
      '  _ = i18n.GetMsgWithMap(ctx, "user.info", data)',
      '  _ = manager.GetMessage("en", "hello")',
      '  _ = manager.GetMessageWithMap("en", "goodbye", data)',
      '}',
    ].join('\n')

    expect(keysOf(src)).toEqual([
      'welcome', 'user.created', 'success', 'user.info', 'hello', 'goodbye',
    ])
  })
})

// 缺陷 4：旧兜底模式 /\w+\s*=\s*["']([\w.]+\.[\w.]+)["']/ 把配置值当成 key
describe('缺陷 4 - 不该被识别的样本', () => {
  runCases([
    { name: 'IP 地址', src: 'addr := "127.0.0.1"', keys: [] },
    { name: '版本号', src: 'version = "1.2.3"', keys: [] },
    { name: '配置文件名', src: 'cfgFile = "config.yaml"', keys: [] },
    { name: '域名', src: 'host = "example.com"', keys: [] },
    { name: '导入路径', src: 'modPath = "github.com/kamalyes/go-i18n"', keys: [] },
    { name: 'import 块', src: 'import (\n  "context"\n  "fmt"\n)', keys: [] },
    { name: '非 i18n 函数调用', src: 'fmt.Println("user.created")', keys: [] },
    { name: '格式化日志', src: 'log.Printf("user.created: %s", name)', keys: [] },
    { name: 'errors.New', src: 'err := errors.New("user.not.found")', keys: [] },
    { name: '无参 GetMessage（AppError 方法）', src: 'return appErr.GetMessage()', keys: [] },
    { name: 'key 是变量而非字面量', src: 'msg := i18n.T(ctx, key, args...)', keys: [] },
    { name: 'key 是常量标识符', src: 'msg := goi18n.GetMsgByKey(ctx, errors.BizErrCodeGameBrandNotFound)', keys: [] },
    { name: '字符串拼接表达式', src: 'msg := i18n.T(ctx, "user."+suffix)', keys: [] },
    { name: '行注释里的调用', src: '// i18n.T(ctx, "commented.key")', keys: [] },
    { name: '行尾注释里的调用', src: 'doSomething() // i18n.T(ctx, "trailing.key")', keys: [] },
    { name: '块注释里的调用', src: '/*\n  i18n.T(ctx, "block.key")\n*/', keys: [] },
    { name: '原生字符串里的调用（文档示例）', src: 'const doc = `\n  i18n.T(ctx, "doc.key")\n`', keys: [] },
    { name: '普通字符串里的调用', src: 'tpl := "i18n.T(ctx, \\"tpl.key\\")"', keys: [] },
    { name: '方法声明不是调用', src: 'func (m *Manager) GetMessage(language, key string, args ...any) string {', keys: [] },
    { name: '接口方法签名', src: '  GetMessageWithMap(language, key string, templateData map[string]any) string', keys: [] },
    { name: '同前缀的其它函数 GetMessageKeys', src: 'all := manager.GetMessageKeys("zh")', keys: [] },
    { name: '相对路径不是 key', src: 'msg := i18n.T(ctx, "./locales/zh.json")', keys: [] },
    { name: '带空格的整句不是 key', src: 'msg := i18n.T(ctx, "Hello world")', keys: [] },
    { name: '默认不启用裸赋值兜底', src: 'const KeyUserCreated = "user.created"', keys: [] },
    // go-argus 的 ValidationErrors.Translate(lang) 与 i18n 无关：同名方法不能只靠名字就认
    { name: '非 i18n 前缀的 Translate(lang)', src: 'msgs := ve.Translate("xx")', keys: [] },
    { name: '非 i18n 前缀的 Translate("en")', src: 'result := ve.Translate("en")', keys: [] },
    { name: '非 i18n 前缀的单参数 GetMessage', src: 'msg := appErr.GetMessage("fallback")', keys: [] },
    { name: '非 i18n 前缀的单参数 T', src: 'v := T("some.value")', keys: [] },
  ])

  it('断言库里嵌套的 GetMessage 只取 key', () => {
    const src = 'assert.Equal(t, "Hello", manager.GetMessage("en", "hello"))'
    expect(keysOf(src)).toEqual(['hello'])
  })
})

// 缺陷 5：lineOffset 原来在匹配循环里被调用，每个匹配走两遍前文 -> O(n²)
describe('缺陷 5 - 大文件性能与行号', () => {
  const lineCount = 5000
  const src = Array.from({ length: lineCount }, (_, i) => `\t_ = i18n.T(ctx, "key.n${i}")`).join('\n')

  it(`${lineCount} 个调用点线性时间内扫完`, () => {
    const started = Date.now()
    const matches = scanner.scan(src, '/project/big.go')
    const elapsed = Date.now() - started

    expect(matches).toHaveLength(lineCount)
    expect(elapsed).toBeLessThan(1500)
  })

  it('行号与列号在大文件里依然准确', () => {
    const matches = scanner.scan(src, '/project/big.go')
    const lines = src.split('\n')

    expect(matches[0].line).toBe(1)
    expect(matches[0].key).toBe('key.n0')
    expect(matches[lineCount - 1].line).toBe(lineCount)
    expect(matches[lineCount - 1].key).toBe(`key.n${lineCount - 1}`)

    for (const m of [matches[0], matches[2500], matches[lineCount - 1]]) {
      expect(src.slice(m.start, m.end)).toBe(m.key)
      expect(lines[m.line - 1].slice(m.column, m.column + m.key.length)).toBe(m.key)
    }
  })
})

// 缺陷 6：逐行扫描漏掉 Go 里非常常见的换行调用
describe('缺陷 6 - 跨行调用', () => {
  runCases([
    {
      name: 'key 在下一行',
      src: 'return i18n.T(ctx,\n\t"error.not_found")',
      keys: ['error.not_found'],
    },
    {
      name: '每个参数各占一行且有尾逗号',
      src: 'msg := i18n.TWithMap(\n\tctx,\n\t"user.created",\n\tmap[string]any{"name": name},\n)',
      keys: ['user.created'],
    },
    {
      name: '函数名与左括号之间换行',
      src: 'msg := i18n.GetMsgByKey(\n\tctx,\n\t"success",\n)',
      keys: ['success'],
    },
    {
      name: '跨行调用中夹注释',
      src: 'msg := i18n.T(ctx, // 语言从 ctx 取\n\t"goodbye")',
      keys: ['goodbye'],
    },
    {
      name: '跨行且第二参数是变量',
      src: 'return nil, errors.ToGRPCError(ctx,\n\terrors.BizErrCodeGameBrandNotFound)',
      keys: [],
    },
  ])
})

describe('偏移与去重', () => {
  const src = [
    'package handler',
    '',
    'func Create(ctx context.Context) error {',
    '\tif err != nil {',
    '\t\treturn status.Error(codes.NotFound, i18n.T(ctx, "error.not_found"))',
    '\t}',
    '\treturn nil, i18n.TWithMap(ctx, "user.created", map[string]any{"name": name})',
    '}',
  ].join('\n')

  it('start/end/line/column 与原文一致', () => {
    const matches = scanner.scan(src, '/project/handler.go')
    const lines = src.split('\n')

    expect(matches.map(m => m.key)).toEqual(['error.not_found', 'user.created'])
    for (const m of matches) {
      expect(src.slice(m.start, m.end)).toBe(m.key)
      expect(lines[m.line - 1].slice(m.column, m.column + m.key.length)).toBe(m.key)
    }
    expect(matches[0].line).toBe(5)
    expect(matches[1].line).toBe(7)
  })

  it('匹配按偏移升序返回', () => {
    const matches = scanner.scan(src, '/project/handler.go')
    const starts = matches.map(m => m.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('同一个 key 在不同位置各记一次', () => {
    const dup = 'a := i18n.T(ctx, "welcome")\nb := i18n.T(ctx, "welcome")'
    const matches = scanner.scan(dup, '/project/dup.go')
    expect(matches).toHaveLength(2)
    expect(matches[0].line).toBe(1)
    expect(matches[1].line).toBe(2)
  })
})

// 缺陷 2 与缺陷 4 的取舍：裸赋值兜底改成需要「key 能在 locale 里查到」才启用
describe('裸赋值兜底仅在提供已知 key 时启用', () => {
  const src = [
    'const (',
    '\tKeyUserCreated = "user.created"',
    '\tKeyWelcome     = "welcome"',
    ')',
    '',
    'var addr = "127.0.0.1"',
    'var version = "1.2.3"',
    'var cfgFile = "config.yaml"',
    'var host = "example.com"',
    'var typeName = "type.name"',
  ].join('\n')

  it('默认实例什么都不认', () => {
    expect(keysOf(src)).toEqual([])
  })

  it('knownKeys 命中的常量才被认成 key', () => {
    const gated = new GoScanner({ knownKeys: ['user.created', 'welcome', 'type.name'] })
    expect(keysOf(src, gated)).toEqual(['user.created', 'welcome'])
  })

  it('isKnownKey 回调形式等价', () => {
    const known = new Set(['user.created'])
    const gated = new GoScanner({ isKnownKey: key => known.has(key) })
    expect(keysOf(src, gated)).toEqual(['user.created'])
  })

  it('结构体字段里的已知 key 也能命中', () => {
    const gated = new GoScanner({ knownKeys: ['error.not_found'] })
    const structSrc = 'e := AppError{Key: "error.not_found", Code: 404}'
    expect(keysOf(structSrc, gated)).toEqual(['error.not_found'])
  })

  it('启用兜底后不会把注释里的已知 key 算进来', () => {
    const gated = new GoScanner({ knownKeys: ['welcome'] })
    expect(keysOf('// fallbackKey = "welcome"', gated)).toEqual([])
  })

  it('启用兜底后调用点与赋值点互不覆盖', () => {
    const gated = new GoScanner({ knownKeys: ['welcome'] })
    const mixed = 'var fallback = "welcome"\nmsg := i18n.T(ctx, "welcome")'
    const matches = gated.scan(mixed, '/project/mixed.go')
    expect(matches.map(m => m.line)).toEqual([1, 2])
  })
})

describe('真实 locale 键集合回归', () => {
  // 取自 go-rpc-gateway/locales/zh.json：扁平键与点分键混排
  const realKeys = [
    'welcome', 'error.not_found', 'error.bad_request', 'error.internal',
    'success', 'hello', 'goodbye', 'user.created', 'user.updated',
    'user.deleted', 'user.info', 'validation.required', 'validation.email',
    'validation.min_length',
  ]

  it('每个真实键都能从标准调用里扫出来', () => {
    const src = realKeys.map(k => `\t_ = i18n.T(ctx, "${k}")`).join('\n')
    expect(keysOf(src)).toEqual(realKeys)
  })
})
