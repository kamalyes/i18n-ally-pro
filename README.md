# i18n Ally Pro

> 智能 i18n 助手 — 零配置、自动检测、Go 优先、完整语言支持

## ✨ 功能特性

### 🔍 智能检测与导航

- **零配置启动**：自动检测项目框架（Go-RPC-Gateway / Vue-i18n / React-i18next）、翻译文件格式（JSON / YAML / PO / Properties）、Key 风格（flat / nested）
- **Hover 预览**：鼠标悬停在代码中的 i18n key 上，即时显示所有语言的翻译，带国旗图标
- **JSON 文件 Hover**：在 JSON 翻译文件中悬浮到 value 上，显示多语言对比，支持 inline 编辑和翻译
- **定义跳转**：右键 Go to Definition，直接跳转到翻译文件中对应 key 的位置
- **CodeLens**：在代码中 inline 显示当前 key 的翻译状态

### 🌳 侧边栏树视图

<!-- TODO: 插入树视图截图 -->
![Tree View](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/tree-view.png)

- **国旗图标**：每个语言节点显示对应的国旗图标
- **点击打开**：点击语言节点自动打开对应的 JSON 翻译文件
- **自动刷新**：翻译文件变更时自动刷新树视图
- **手动刷新**：标题栏刷新按钮，随时重新加载
- **🔍 搜索过滤**：标题栏搜索按钮，按 key 名称或翻译值过滤
- **➕ 新增 Key**：右键语言根节点或分组节点，新增 i18n key
- **✏️ 重命名 Key**：右键 key 节点，全局重命名
- **🗑️ 删除 Key**：右键 key 节点，从所有语言中删除
- **🌐 批量翻译分组**：右键分组节点，一键翻译该分组下所有缺失项
- **🗑️ 删除分组**：右键分组节点，删除整个分组及其所有 key
- **🔀 拖拽移动 Key**：拖拽 key 或分组到另一个分组，自动移动并重命名
- **📊 完成率统计**：分组节点显示 `已填充/总数` 的完成率

### 📝 右侧 Key 编辑器 (Key Editor Panel)

![Key Editor](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/dasboard-edit.png)

- **国旗图标**：每个语言行显示精美的 SVG 国旗图标（基于 flag-icons 库）
- **多语言编辑**：同一 key 下所有语言的翻译并排编辑
- **🤖 单 key 翻译**：点击 🤖 按钮自动翻译当前语言的缺失项
- **📂 文件跳转**：点击 📂 按钮跳转到对应 JSON 文件的 key 所在行
- **💾 保存**：编辑后点击 💾 保存，支持 `Ctrl+S` 快捷键
- **🗑️ 删除**：从指定语言中删除该 key 的翻译
- **🈳 补全剩余**：一键补全当前 key 所有语言的缺失翻译
- **🔄 覆盖所有**：一键覆盖当前 key 所有语言的翻译
- **✏️ 自定义文本**：输入自定义文本覆盖所有语言
- **操作反馈**：保存、翻译、删除等操作均有 Toast 通知提示

### 📊 翻译矩阵 (Translation Matrix)

![Translation Matrix](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/translation-matrix.png)

- 全语言 × 全 Key 的矩阵视图，一目了然
- **可编辑单元格**：点击即可修改翻译
- **筛选 / 搜索**：按关键词、语言、状态过滤
- **排序**：按 Key、完成度、语言排序
- **批量操作**：批量翻译缺失项
- **导出 CSV**：一键导出矩阵数据

### 📈 进度仪表盘 (Progress Dashboard)

![Progress Dashboard](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/dashboard.png)

- **环形图**：直观展示翻译完成率（已翻译 / 空值 / 缺失）
- **语言覆盖率统计**：每种语言带 SVG 国旗图标的翻译进度条
- **分类进度**：按 key 前缀分组统计，长 key 自动截断，悬浮显示完整
- **缺失翻译列表**：快速定位翻译缺口，点击跳转
- **🤖 Auto Translate 按钮**：一键批量翻译所有缺失项
- **🔄 Refresh 按钮**：手动刷新仪表盘数据
- **⏸️ 暂停翻译**：批量翻译过程中可随时暂停
- **点击跳转**：分类进度和缺失项均可点击跳转到编辑器
- **操作反馈**：按钮点击有 loading 状态和 toast 提示

### 🔄 ErrorCode 同步

- **Go 常量 ↔ JSON 双向同步**：从 Go `const` 定义自动同步到翻译 JSON
- **完整性检查**：检测 Go 中有但 JSON 中缺失的 key，以及 JSON 中有但 Go 中没有的 key
- **双向跳转**：`Go to Go Const` / `Go to JSON Key` 快速导航
- **批量新增向导**：输入常量名 + key + 中文描述，自动生成 Go 代码并翻译到所有语言

### 🤖 机器翻译

- 支持 **Google / DeepL / OpenAI / Microsoft** 四大翻译引擎
- **完整语言专项支持**：中文繁体、中文简体、缅甸语、老挝语、高棉语、泰语、越南语、印尼语、马来语等
- **翻译缓存**：避免重复调用 API，节省费用
- **并发翻译**：支持并发调用翻译 API，大幅提升批量翻译速度
- **动态进度**：批量翻译时显示实时进度，包含源文本预览和目标语言国旗
- **三种翻译入口**：
  - 🤖 **Dashboard 批量翻译**：在进度仪表盘点击「🤖 Auto Translate」按钮，自动翻译所有缺失项
  - 🤖 **右侧编辑器单 key 翻译**：在 Key Editor 中点击 🤖 按钮，翻译当前语言的缺失项
  - 🤖 **Hover 翻译**：在代码或 JSON 文件中悬浮，点击「🤖 Translate Missing」翻译缺失语言
- **自动翻译**：保存翻译文件时自动翻译空 key（可配置 `autoTranslateOnSave`）
- **自定义端点**：支持配置代理或私有部署的 API 端点
- **确认覆盖**：自动翻译时，已有翻译的 key 会弹出确认提示，防止误覆盖

### ✏️ Inline 编辑

- **Code Actions**：在 Go / Vue / React 代码中，右键即可编辑翻译、翻译缺失语言
- **Hover 编辑**：在 JSON 翻译文件中悬浮到 value，点击 ✏️ 即可 inline 编辑
- 无需切换到翻译文件，直接在代码中完成翻译修改

### 🔧 Key 依赖图 (Dependency Graph)

![Key Dependencies](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/key-dependencies.png)

- **文件 ↔ Key 双向关联**：左侧展示代码文件，右侧展示 i18n key，连线显示引用关系
- **引用频率排序**：按 A→Z / 频率降序 / 频率升序排列 key，快速发现核心翻译
- **行号跳转**：点击引用项直接跳转到代码对应行
- **📋 AI Prompt**：一键复制未引用 key 列表，交给 AI 审查清理
- **🗑️ 批量清理**：一键删除所有未引用的 key（带确认弹窗）
- **搜索过滤**：按关键词搜索文件和 key

### 🔀 翻译 Diff 视图

- **源语言对比**：以源语言为基准，对比所有目标语言的翻译差异
- **状态标记**：MISS（缺失）/ EMPTY（空值）/ DIFF（不同）/ ✅（一致）
- **筛选过滤**：按缺失、空值、不同状态筛选
- **点击跳转**：点击 key 可跳转到对应翻译文件

### 🔍 翻译质量检查 (Quality Check)

- **占位符一致性检查**：检测翻译中 `%s`、`%d`、`{name}` 等占位符是否在所有语言中保持一致
- **长度异常检测**：检测翻译长度与源语言差异过大（>5x 或 <0.2x）的情况
- **空源值检测**：检测源语言中值为空的 key
- **可视化报告**：在 Output Channel 中输出详细的质量检查报告

### 📜 翻译历史与撤销

- **自动记录**：每次翻译修改（新增、修改、删除）自动记录到历史
- **一键撤销**：撤销最近一次翻译修改，恢复到修改前的值
- **历史查看**：查看所有翻译修改历史，包含时间、操作类型、key、旧值和新值
- **最多 200 条**：历史记录最多保留 200 条，自动淘汰最旧的记录

### 💡 自动补全

- **智能补全**：在 Go / Vue / React 代码中输入 i18n key 时自动弹出补全列表
- **多语言预览**：补全项显示所有语言的翻译值
- **优先排序**：有翻译值的 key 排在前面

### 📊 Status Bar 状态

- **实时进度**：底部状态栏显示翻译完成度百分比
- **图标提示**：100% ✅ / ≥80% 🌐 / <80% ⚠️
- **悬浮详情**：鼠标悬浮显示 key 数量、语言数、缺失翻译数
- **点击跳转**：点击打开 Progress Dashboard

### 🔧 重构工具

- **重命名 Key**：全局替换 i18n key，同时更新翻译文件和代码引用
- **删除 Key**：从所有语言文件中删除指定 key
- **查找未使用 Key**：扫描代码库，找出没有被引用的翻译 key
- **批量删除未使用 Key**：一键清理所有未使用的翻译
- **Diff 报告**：生成翻译差异报告，查看缺失和空值详情
- **Key 排序**：按字母顺序排序指定语言的 JSON key
- **拖拽移动**：在树视图中拖拽 key 到新分组

### 🌐 国际化

- **插件自身国际化**：支持中文 / 英文界面切换
- **配置优先级**：`env.language` > `displayLanguage` 设置
- **动态切换**：修改语言设置后自动重新加载

## 📦 安装

### 从 VSIX 安装

1. 下载最新的 `.vsix` 文件
2. 在 VS Code 中按 `Ctrl+Shift+P`，输入 `Extensions: Install from VSIX...`
3. 选择下载的 `.vsix` 文件

### 从源码构建

```bash
git clone https://github.com/kamalyes/i18n-ally-pro.git
cd i18n-ally-pro
nvm install 20.20.2
npm install -g npm@11.13.0
npm install
npm run package # Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# 生成的 .vsix 文件在项目根目录
npx vsce package --allow-missing-repository
```

## 🚀 使用

### 基本使用

1. 打开包含翻译文件的项目
2. 插件自动检测翻译目录、语言和框架
3. 侧边栏出现 🌐 i18n Ally Pro 图标，展开查看翻译树

### 翻译 API 配置

使用机器翻译功能前，需要配置翻译 API Key。详见 [翻译 API 配置指南](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/translator-setup.png)。

快速配置（以 Google 为例）：

```json
{
  "i18nAllyPro.translatorEngine": "google",
  "i18nAllyPro.translatorApiKey": "YOUR_API_KEY"
}
```

| 引擎 | 免费额度 | 申请地址 |
|------|---------|---------|
| **Google** | 50万字符/月 | [Google Cloud Console](https://console.cloud.google.com/) |
| **DeepL** | 50万字符/月 | [DeepL API](https://www.deepl.com/pro#developer) |
| **OpenAI** | 按 Token 计费 | [OpenAI Platform](https://platform.openai.com/) |
| **Microsoft** | 200万字符/月 | [Azure Portal](https://portal.azure.com/) |

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
| `i18n Pro: Open Key Editor` | 打开右侧 Key 编辑器 |
| `i18n Pro: Show Diff Report` | 显示翻译差异报告（可视化 Diff 视图） |
| `i18n Pro: Show Key Dependencies` | 显示 Key 依赖图 |
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
| `i18n Pro: Add New i18n Key` | 新增 i18n key（含自动翻译） |
| `i18n Pro: Batch Translate Group` | 批量翻译分组下所有缺失项 |
| `i18n Pro: Delete Key Group` | 删除整个 key 分组 |
| `i18n Pro: Sort Translation Keys` | 按字母顺序排序翻译 key |
| `i18n Pro: Search Keys` | 搜索过滤 i18n key |
| `i18n Pro: Clear Search Filter` | 清除搜索过滤 |
| `i18n Pro: Quality Check` | 翻译质量检查（占位符 & 一致性） |
| `i18n Pro: Undo Last Translation Change` | 撤销上次翻译修改 |
| `i18n Pro: Show Translation History` | 显示翻译修改历史 |
| `i18n Pro: Find Unused Keys` | 查找未使用的 key |
| `i18n Pro: Delete Unused Keys` | 删除未使用的 key |
| `i18n Pro: Clear Translation Cache` | 清除翻译缓存 |
| `i18n Pro: Init Locales from Go` | 从 Go 初始化语言配置 |
| `i18n Pro: Complete Missing Keys` | 一键补全缺失 key |

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
| `i18nAllyPro.translatorApiEndpoint` | `string` | `""` | 自定义 API 端点（支持代理/私有部署） |
| `i18nAllyPro.autoTranslateOnSave` | `boolean` | `false` | 保存时自动翻译空 key |
| `i18nAllyPro.errorCodesPath` | `string` | `""` | Go ErrorCode 文件路径（留空自动检测） |
| `i18nAllyPro.ignoreDirs` | `string[]` | `[]` | 扫描时额外忽略的目录（与默认值合并） |

## 🏗 项目结构

```
i18n-ally-pro/
├── src/
│   ├── extension.ts              # 插件入口
│   ├── i18n/                     # 插件自身国际化
│   │   └── index.ts              # i18n 加载器 + 国旗映射
│   ├── core/
│   │   ├── store.ts              # 翻译数据存储（含历史记录）
│   │   ├── detector.ts           # 项目配置检测
│   │   ├── constants.ts          # 常量定义
│   │   └── types.ts              # 类型定义
│   ├── providers/
│   │   ├── hover.ts              # Hover 提供者（代码 + JSON）
│   │   ├── definition.ts         # 定义跳转提供者
│   │   ├── diagnostic.ts         # 诊断提供者
│   │   ├── tree.ts               # 侧边栏树视图（拖拽 + 搜索 + 右键菜单）
│   │   ├── codelens.ts           # CodeLens 提供者
│   │   ├── completion.ts         # 自动补全提供者
│   │   ├── inlineEdit.ts         # Inline 编辑 CodeAction
│   │   ├── keyEditorPanel.ts     # 右侧 Key 编辑器（SVG 国旗 + 🤖翻译）
│   │   ├── matrixPanel.ts        # 翻译矩阵面板
│   │   ├── progressDashboard.ts  # 进度仪表盘（SVG 国旗 + 批量翻译）
│   │   └── diffViewPanel.ts      # 翻译 Diff 视图面板
│   ├── services/
│   │   ├── extraction.ts         # 文本提取服务
│   │   ├── translator.ts         # 翻译服务（Google/DeepL/OpenAI/Microsoft）
│   │   ├── translators/          # 翻译引擎模块
│   │   │   ├── base.ts           # 翻译引擎基类
│   │   │   ├── google.ts         # Google 翻译
│   │   │   ├── deepl.ts          # DeepL 翻译
│   │   │   ├── openai.ts         # OpenAI 翻译
│   │   │   └── microsoft.ts      # Microsoft 翻译
│   │   ├── localeInit.ts         # 语言初始化服务
│   │   ├── errorCodeSync.ts      # ErrorCode 同步服务
│   │   ├── refactor.ts           # 重构服务
│   │   ├── keyDependency.ts      # Key 依赖图服务
│   │   ├── qualityCheck.ts       # 翻译质量检查服务
│   │   ├── translationHistory.ts # 翻译历史与撤销服务
│   │   └── statusBar.ts          # Status Bar 状态服务
│   ├── scanners/
│   │   ├── go.ts                 # Go 代码扫描器
│   │   ├── vue.ts                # Vue 代码扫描器
│   │   └── react.ts              # React 代码扫描器
│   ├── parsers/
│   │   ├── json.ts               # JSON 解析器
│   │   ├── yaml.ts               # YAML 解析器
│   │   ├── po.ts                 # PO 解析器
│   │   └── properties.ts         # Properties 解析器
│   └── utils/
│       ├── concurrency.ts        # 并发控制工具
│       └── slug.ts               # 工具函数
├── locales/                      # 插件自身翻译文件
│   ├── en.json                   # 英文
│   └── zh-CN.json                # 中文
├── scripts/
│   └── build-with-env.js         # 环境变量注入构建脚本
├── docs/
│   ├── translator-setup.md       # 翻译 API 配置指南
│   └── assets/                   # 截图资源
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

| Locale | 语言 | 国旗 | 所属区域 |
|--------|------|------|---------|
| `ar` | 阿拉伯语 | 🇸🇦 | 中东 |
| `bm` | 马来语 | 🇲🇾 | 东南亚 |
| `bn` | 孟加拉语 | 🇧🇩 | 南亚 |
| `de` | 德语 | 🇩🇪 | 欧洲 |
| `en` | 英语 | 🇺🇸 | 全球 |
| `es` | 西班牙语 | 🇪🇸 | 欧洲/拉美 |
| `fr` | 法语 | 🇫🇷 | 欧洲 |
| `fr-fr` | 法语 (法国) | 🇫🇷 | 欧洲 |
| `hi` | 印地语 | 🇮🇳 | 南亚 |
| `id` | 印尼语 | 🇮🇩 | 东南亚 |
| `it` | 意大利语 | 🇮🇹 | 欧洲 |
| `ja` | 日语 | 🇯🇵 | 东亚 |
| `kh` | 高棉语 (柬埔寨) | 🇰🇭 | 东南亚 |
| `ko` | 韩语 | 🇰🇷 | 东亚 |
| `lo` | 老挝语 | 🇱🇦 | 东南亚 |
| `my` | 缅甸语 | 🇲🇲 | 东南亚 |
| `nl` | 荷兰语 | 🇳🇱 | 欧洲 |
| `pt` | 葡萄牙语 | 🇵🇹 | 欧洲/拉美 |
| `pt-br` | 葡萄牙语 (巴西) | 🇧🇷 | 拉美 |
| `ru` | 俄语 | 🇷🇺 | 欧洲/中亚 |
| `sv` | 瑞典语 | 🇸🇪 | 欧洲 |
| `tc` | 繁体中文 | 🇹🇼 | 东亚 |
| `th` | 泰语 | 🇹🇭 | 东南亚 |
| `tr` | 土耳其语 | 🇹🇷 | 欧洲/中东 |
| `ur` | 乌尔都语 | 🇵🇰 | 南亚 |
| `vi` | 越南语 | 🇻🇳 | 东南亚 |
| `zh` | 简体中文 | 🇨🇳 | 东亚 |
| `zh-tw` | 繁体中文 (台湾) | 🇹🇼 | 东亚 |

## 📄 License

本项目采用 [Apache 2.0 License 许可证](LICENSE) 开源
