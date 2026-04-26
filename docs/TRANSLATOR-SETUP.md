# 翻译 API 配置指南

i18n Ally Pro 支持四种翻译引擎，可自动翻译缺失的翻译键值。

## 配置项

在 VS Code 设置中（`Ctrl+,`），搜索 `i18nAllyPro`：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `i18nAllyPro.translatorEngine` | 翻译引擎 | `google` |
| `i18nAllyPro.translatorApiKey` | API 密钥 | 空 |
| `i18nAllyPro.translatorApiEndpoint` | 自定义 API 端点（留空使用默认） | 空 |
| `i18nAllyPro.autoTranslateOnSave` | 保存时自动翻译缺失键 | `false` |

---

## 1. Google Cloud Translation API

### 申请步骤

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目或选择已有项目
3. 启用 **Cloud Translation API**：
   - 导航到「API 和服务」→「库」
   - 搜索「Cloud Translation API」→ 点击「启用」
4. 创建 API 密钥：
   - 导航到「API 和服务」→「凭据」
   - 点击「创建凭据」→「API 密钥」
   - 复制生成的密钥
5. **建议**：限制 API 密钥仅允许 Cloud Translation API，防止滥用

### 配置

```json
{
  "i18nAllyPro.translatorEngine": "google",
  "i18nAllyPro.translatorApiKey": "AIzaSy..."
}
```

### 自定义端点（可选）

如使用代理或私有部署：

```json
{
  "i18nAllyPro.translatorApiEndpoint": "https://your-proxy.example.com"
}
```

### 免费额度

- 每月前 50 万字符免费
- 超出后 $20 / 百万字符

---

## 2. DeepL API

### 申请步骤

1. 访问 [DeepL API](https://www.deepl.com/pro#developer)
2. 选择计划：
   - **Free**：每月 50 万字符免费（需信用卡验证，不扣费）
   - **Pro**：按用量付费，$5.49 / 百万字符
3. 注册并获取 **Authentication Key**
4. 注意区分 Free 和 Pro 的 API 端点不同

### 配置

**Free 版本**（密钥以 `:fx` 结尾，插件会自动识别并使用免费端点）：

```json
{
  "i18nAllyPro.translatorEngine": "deepl",
  "i18nAllyPro.translatorApiKey": "your-free-key:fx"
}
```

**Pro 版本**：

```json
{
  "i18nAllyPro.translatorEngine": "deepl",
  "i18nAllyPro.translatorApiKey": "your-pro-key"
}
```

### 自定义端点（可选）

```json
{
  "i18nAllyPro.translatorApiEndpoint": "https://api-free.deepl.com/v2"
}
```

### 特点

- 翻译质量高，尤其对欧洲语言
- Free 版密钥以 `:fx` 结尾，自动使用 `api-free.deepl.com`
- Pro 版自动使用 `api.deepl.com`

---

## 3. OpenAI API

### 申请步骤

1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 注册/登录账号
3. 导航到「API Keys」→「Create new secret key」
4. 复制密钥（只显示一次）
5. 确保账户有足够余额

### 配置

```json
{
  "i18nAllyPro.translatorEngine": "openai",
  "i18nAllyPro.translatorApiKey": "sk-..."
}
```

### 自定义端点（兼容 OpenAI 格式的第三方服务）

如使用 Azure OpenAI 或其他兼容服务：

```json
{
  "i18nAllyPro.translatorApiEndpoint": "https://your-endpoint.openai.azure.com/v1"
}
```

### 特点

- 默认使用 `gpt-3.5-turbo` 模型
- 翻译质量好，能理解上下文
- 保留占位符（如 `{name}`, `%s`, `{{variable}}`）
- 费用按 Token 计算

---

## 4. Microsoft Translator API

### 申请步骤

1. 访问 [Azure Portal](https://portal.azure.com/)
2. 创建「翻译」资源：
   - 搜索「Translator」→「创建」
   - 选择定价层（Free: 每月 200 万字符）
3. 获取密钥：
   - 进入资源 →「密钥和终结点」
   - 复制 KEY 1 或 KEY 2

### 配置

```json
{
  "i18nAllyPro.translatorEngine": "microsoft",
  "i18nAllyPro.translatorApiKey": "your-azure-key"
}
```

### 自定义端点（可选）

```json
{
  "i18nAllyPro.translatorApiEndpoint": "https://api.cognitive.microsofttranslator.com"
}
```

### 免费额度

- 每月 200 万字符免费
- 超出后 $10 / 百万字符

---

## 使用方式

配置完成后，可通过以下方式使用翻译功能：

1. **命令面板**（`Ctrl+Shift+P`）：
   - `i18n Ally Pro: Auto Translate Empty Keys` — 批量翻译所有缺失键
   - `i18n Ally Pro: Translate Current Key` — 翻译光标处的键

2. **右侧编辑器**：
   - 点击 🤖 按钮翻译单个缺失项

3. **Hover 悬浮窗**：
   - 点击「🤖 Translate Missing」翻译缺失语言

4. **自动翻译**（可选）：
   ```json
   {
     "i18nAllyPro.autoTranslateOnSave": true
   }
   ```
   保存翻译文件时自动翻译缺失键

---

## 推荐选择

| 场景 | 推荐引擎 | 原因 |
|------|----------|------|
| 中文 ↔ 英文 | DeepL / OpenAI | 翻译质量最高 |
| 欧洲语言 | DeepL | 欧洲语言翻译最优 |
| 亚洲语言 | Google / OpenAI | 语言覆盖面广 |
| 低成本 | Google / Microsoft | 免费额度大 |
| 高质量 | OpenAI | 理解上下文，保留占位符 |
| 国内使用 | OpenAI（自定义端点） | 可配置国内代理 |

---

## 常见问题

### Q: 提示 "Translation API key not configured"
A: 在 VS Code 设置中配置 `i18nAllyPro.translatorApiKey`。

### Q: 翻译速度慢
A: 批量翻译时每次请求间隔 200ms，避免触发 API 速率限制。可在进度条中取消。

### Q: 翻译不准确
A: 建议使用 DeepL 或 OpenAI 引擎，翻译质量更高。

### Q: 国内无法访问 Google/Microsoft API
A: 可通过 `translatorApiEndpoint` 配置代理端点，或使用 OpenAI 引擎配合国内中转服务。
