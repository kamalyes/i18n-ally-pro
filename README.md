# i18n Ally Pro

> 智能 i18n 助手 — 零配置、自动检测、Go 优先、完整语言支持

## ✨ 功能特性

### 🔍 智能检测与导航

- **零配置启动**：自动检测项目框架（Go-RPC-Gateway / Vue-i18n / React-i18next）、翻译文件格式（JSON / YAML / PO / Properties）、Key 风格（flat / nested）
- **Hover 预览**：鼠标悬停在代码中的 i18n key 上，即时显示所有语言的翻译
- **定义跳转**：右键 Go to Definition，直接跳转到翻译文件中对应 key 的位置
- **CodeLens**：在代码中 inline 显示当前 key 的翻译状态

### 📊 翻译矩阵 (Translation Matrix)

- 全语言 × 全 Key 的矩阵视图，一目了然
- **可编辑单元格**：点击即可修改翻译
- **筛选 / 搜索**：按关键词、语言、状态过滤
- **排序**：按 Key、完成度、语言排序
- **批量操作**：批量翻译缺失项
- **导出 CSV**：一键导出矩阵数据

### 📈 进度仪表盘 (Progress Dashboard)

- **环形图**：直观展示翻译完成率（已翻译 / 空值 / 缺失）
- **语言覆盖率统计**：每种语言的翻译进度
- **缺失热力图**：快速定位翻译缺口

### 🔄 ErrorCode 同步

- **Go 常量 ↔ JSON 双向同步**：从 Go `const` 定义自动同步到翻译 JSON
- **完整性检查**：检测 Go 中有但 JSON 中缺失的 key，以及 JSON 中有但 Go 中没有的 key
- **双向跳转**：`Go to Go Const` / `Go to JSON Key` 快速导航
- **批量新增向导**：输入常量名 + key + 中文描述，自动生成 Go 代码并翻译到所有语言

### 🤖 机器翻译

- 支持 **Google / DeepL / OpenAI / Microsoft** 四大翻译引擎
- **完整语言专项支持**：中文繁体、中文简体、缅甸语、老挝语、高棉语、泰语、越南语、印尼语、马来语等
- **翻译缓存**：避免重复调用 API，节省费用
- **自动翻译**：保存翻译文件时自动翻译空 key（可配置）
- **单 key 翻译**：光标定位到 key 上，一键翻译到所有缺失语言

### ✏️ Inline 编辑

- **Code Actions**：在 Go / Vue / React 代码中，右键即可编辑翻译、翻译缺失语言
- 无需切换到翻译文件，直接在代码中完成翻译修改

### 🔧 重构工具

- **重命名 Key**：全局替换 i18n key，同时更新翻译文件和代码引用
- **删除 Key**：从所有语言文件中删除指定 key
- **查找未使用 Key**：扫描代码库，找出没有被引用的翻译 key
- **批量删除未使用 Key**：一键清理所有未使用的翻译

## 📦 安装

### 从 VSIX 安装

1. 下载最新的 `.vsix` 文件
2. 在 VS Code 中按 `Ctrl+Shift+P`，输入 `Extensions: Install from VSIX...`
3. 选择下载的 `.vsix` 文件

### 从源码构建

```bash
git clone https://github.com/kamalyes/i18n-ally-pro.git
cd i18n-ally-pro
npm install
npm run package
# 生成的 .vsix 文件在项目根目录
npx vsce package --allow-missing-repository
```

## 🚀 使用

### 基本使用

1. 打开包含翻译文件的项目
2. 插件自动检测翻译目录、语言和框架
3. 侧边栏出现 🌐 i18n Ally Pro 图标，展开查看翻译树

### 命令列表

| 命令 | 说明 |
|------|------|
| `i18n Pro: Extract Text to i18n Key` | 提取选中文本为 i18n key |
| `i18n Pro: Refresh Translations` | 刷新翻译数据 |
| `i18n Pro: Open Translation File` | 打开翻译文件并定位到 key |
| `i18n Pro: Edit Translation` | 编辑翻译 |
| `i18n Pro: Copy i18n Key` | 复制 key |
| `i18n Pro: Show Diagnostics` | 显示诊断信息（缺失/空值） |
| `i18n Pro: Auto Translate Empty Keys` | 自动翻译所有空 key |
| `i18n Pro: Translate Current Key` | 翻译光标处的 key |
| `i18n Pro: Show Translation Matrix` | 打开翻译矩阵 |
| `i18n Pro: Show Progress Dashboard` | 打开进度仪表盘 |
| `i18n Pro: Sync Error Codes from Go` | 从 Go 文件同步 ErrorCode |
| `i18n Pro: Add New Error Code` | 手动添加 ErrorCode |
| `i18n Pro: Add Error Code Wizard` | ErrorCode 添加向导（自动翻译） |
| `i18n Pro: Check Integrity` | 检查 Go 常量与 JSON 一致性 |
| `i18n Pro: Go to Go Const Definition` | 跳转到 Go 常量定义 |
| `i18n Pro: Go to JSON Translation` | 跳转到 JSON 翻译 |
| `i18n Pro: Inline Edit Translation` | 在代码中 inline 编辑翻译 |
| `i18n Pro: Inline Translate Missing` | 在代码中 inline 翻译缺失语言 |
| `i18n Pro: Rename i18n Key` | 重命名 key（全局替换） |
| `i18n Pro: Delete i18n Key` | 删除 key |
| `i18n Pro: Find Unused Keys` | 查找未使用的 key |
| `i18n Pro: Delete Unused Keys` | 删除未使用的 key |
| `i18n Pro: Clear Translation Cache` | 清除翻译缓存 |

## ⚙️ 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `i18nAllyPro.localesPaths` | `string[]` | `[]` | 翻译文件目录（留空自动检测） |
| `i18nAllyPro.framework` | `string` | `"auto"` | 框架类型：auto / go-rpc-gateway / vue-i18n / react-i18next / general |
| `i18nAllyPro.keystyle` | `string` | `"auto"` | Key 风格：auto / flat / nested |
| `i18nAllyPro.enabledParsers` | `string[]` | `[]` | 启用的解析器：json / yaml / po / properties |
| `i18nAllyPro.sourceLanguage` | `string` | `""` | 源语言（留空自动检测） |
| `i18nAllyPro.displayLanguage` | `string` | `""` | 显示语言（默认同源语言） |
| `i18nAllyPro.translatorEngine` | `string` | `"google"` | 翻译引擎：google / deepl / openai / microsoft |
| `i18nAllyPro.translatorApiKey` | `string` | `""` | 翻译 API Key |
| `i18nAllyPro.translatorApiEndpoint` | `string` | `""` | 自定义 API 端点 |
| `i18nAllyPro.autoTranslateOnSave` | `boolean` | `false` | 保存时自动翻译空 key |
| `i18nAllyPro.errorCodesPath` | `string` | `""` | Go ErrorCode 文件路径（留空自动检测） |

## 🏗 项目结构

```
i18n-ally-pro/
├── src/
│   ├── extension.ts          # 插件入口
│   ├── core/
│   │   ├── store.ts          # 翻译数据存储
│   │   ├── detector.ts       # 项目配置检测
│   │   └── types.ts          # 类型定义
│   ├── providers/
│   │   ├── hover.ts          # Hover 提供者
│   │   ├── definition.ts     # 定义跳转提供者
│   │   ├── diagnostic.ts     # 诊断提供者
│   │   ├── tree.ts           # 侧边栏树视图
│   │   ├── codelens.ts       # CodeLens 提供者
│   │   ├── inlineEdit.ts     # Inline 编辑 CodeAction
│   │   ├── matrixPanel.ts    # 翻译矩阵面板
│   │   └── progressDashboard.ts  # 进度仪表盘
│   ├── services/
│   │   ├── extraction.ts     # 文本提取服务
│   │   ├── translator.ts     # 翻译服务（多引擎）
│   │   ├── errorCodeSync.ts  # ErrorCode 同步服务
│   │   └── refactor.ts       # 重构服务
│   ├── scanners/
│   │   ├── go.ts             # Go 代码扫描器
│   │   ├── vue.ts            # Vue 代码扫描器
│   │   └── react.ts          # React 代码扫描器
│   ├── parsers/
│   │   ├── json.ts           # JSON 解析器
│   │   ├── yaml.ts           # YAML 解析器
│   │   ├── po.ts             # PO 解析器
│   │   └── properties.ts     # Properties 解析器
│   └── utils/
│       └── slug.ts           # 工具函数
├── package.json
├── tsconfig.json
└── webpack.config.js
```
## 🌏 支持语言

基于以下项目的翻译文件汇总，共支持 **28 种语言**：

- `go-rpc-gateway/locales` (28 种语言)
- `xxx-open-service/locales` (12 种语言)
- `xxx-pyament-service/locales` (12 种语言)

### 完整语言列表

| Locale | 语言 | 所属区域 |
|--------|------|---------|
| `ar` | 阿拉伯语 | 中东 |
| `bm` | 马来语 | 东南亚 |
| `bn` | 孟加拉语 | 南亚 |
| `de` | 德语 | 欧洲 |
| `en` | 英语 | 全球 |
| `es` | 西班牙语 | 欧洲/拉美 |
| `fr` | 法语 | 欧洲 |
| `fr-fr` | 法语 (法国) | 欧洲 |
| `hi` | 印地语 | 南亚 |
| `id` | 印尼语 | 东南亚 |
| `it` | 意大利语 | 欧洲 |
| `ja` | 日语 | 东亚 |
| `kh` | 高棉语 (柬埔寨) | 东南亚 |
| `ko` | 韩语 | 东亚 |
| `lo` | 老挝语 | 东南亚 |
| `my` | 缅甸语 | 东南亚 |
| `nl` | 荷兰语 | 欧洲 |
| `pt` | 葡萄牙语 | 欧洲/拉美 |
| `pt-br` | 葡萄牙语 (巴西) | 拉美 |
| `ru` | 俄语 | 欧洲/中亚 |
| `sv` | 瑞典语 | 欧洲 |
| `tc` | 繁体中文 | 东亚 |
| `th` | 泰语 | 东南亚 |
| `tr` | 土耳其语 | 欧洲/中东 |
| `ur` | 乌尔都语 | 南亚 |
| `vi` | 越南语 | 东南亚 |
| `zh` | 简体中文 | 东亚 |
| `zh-tw` | 繁体中文 (台湾) | 东亚 |

## 📄 License

MIT
