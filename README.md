# i18n Ally Pro

> Smart i18n Assistant — Zero Configuration, Auto Detection, Go First, Full Language Support

[English Documentation](README_EN.md) | [中文文档](README_ZH.md)

## ✨ Features

### 🔍 Smart Detection & Navigation

- **Zero Configuration Startup**: Automatically detects project framework (Go-RPC-Gateway / Vue-i18n / React-i18next), translation file format (JSON / YAML / PO / Properties), and key style (flat / nested)
- **Hover Preview**: Hover over i18n keys in code to instantly display translations in all languages with flag icons
- **JSON File Hover**: Hover over values in JSON translation files to see multi-language comparisons with inline editing and translation
- **Definition Jump**: Right-click "Go to Definition" to jump directly to the corresponding key location in translation files
- **CodeLens**: Inline display of current key translation status in code

### 🌳 Sidebar Tree View

<!-- TODO: Insert tree view screenshot -->
![Tree View](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/tree-view.png)

- **Flag Icons**: Each language node displays corresponding flag icons
- **Click to Open**: Click language nodes to automatically open corresponding JSON translation files
- **Auto Refresh**: Tree view automatically refreshes when translation files change
- **Manual Refresh**: Refresh button in title bar for reloading anytime
- **🔍 Search Filter**: Search button in title bar to filter by key name or translation value
- **➕ Add New Key**: Right-click language root or group nodes to add new i18n keys
- **✏️ Rename Key**: Right-click key nodes to rename globally
- **🗑️ Delete Key**: Right-click key nodes to delete from all languages
- **🌐 Batch Translate Group**: Right-click group nodes to translate all missing items in the group
- **🗑️ Delete Group**: Right-click group nodes to delete entire group and all its keys
- **🔀 Drag & Drop Keys**: Drag keys or groups to another group for automatic moving and renaming
- **📊 Completion Statistics**: Group nodes show `filled/total` completion rate

### 📝 Right Panel Key Editor

![Key Editor](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/dasboard-edit.png)

- **Flag Icons**: Each language row displays beautiful SVG flag icons (based on flag-icons library)
- **Multi-language Editing**: Edit translations for all languages of the same key side by side
- **🤖 Single Key Translation**: Click 🤖 button to automatically translate missing items for current language
- **📂 File Navigation**: Click 📂 button to jump to key location in corresponding JSON file
- **💾 Save**: Click 💾 to save edits, supports `Ctrl+S` shortcut
- **🗑️ Delete**: Delete key translation from specified language
- **🈳 Complete Missing**: One-click completion of missing translations for all languages of current key
- **🔄 Override All**: One-click override of all language translations for current key
- **✏️ Custom Text**: Input custom text to override all languages
- **Action Feedback**: Toast notifications for save, translate, delete operations

### 📊 Translation Matrix

![Translation Matrix](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/translation-matrix.png)

- Matrix view of all languages × all keys for clear overview
- **Editable Cells**: Click to modify translations
- **Filter / Search**: Filter by keyword, language, status
- **Sorting**: Sort by key, completion rate, language
- **Batch Operations**: Batch translate missing items
- **Export CSV**: One-click export of matrix data

### 📈 Progress Dashboard

![Progress Dashboard](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/dashboard.png)

- **Circular Charts**: Visual display of translation completion rate (translated / empty / missing)
- **Language Coverage Statistics**: Translation progress bars with SVG flag icons for each language
- **Category Progress**: Statistics by key prefix groups, long keys automatically truncated with hover for full display
- **Missing Translations List**: Quick location of translation gaps with click navigation
- **🤖 Auto Translate Button**: One-click batch translation of all missing items
- **🔄 Refresh Button**: Manual refresh of dashboard data
- **⏸️ Pause Translation**: Pause batch translation anytime during process
- **Click Navigation**: Category progress and missing items can be clicked to navigate to editor
- **Action Feedback**: Button clicks show loading status and toast notifications

### 🔄 ErrorCode Synchronization

- **Go Constants ↔ JSON Bidirectional Sync**: Automatic synchronization from Go `const` definitions to translation JSON
- **Integrity Check**: Detect keys present in Go but missing in JSON, and keys in JSON but not in Go
- **Bidirectional Navigation**: `Go to Go Const` / `Go to JSON Key` quick navigation
- **Batch Add Wizard**: Input constant name + key + Chinese description, automatically generate Go code and translate to all languages

### 🤖 Machine Translation

- Supports **Google / DeepL / OpenAI / Microsoft** four major translation engines
- **Full Language Special Support**: Traditional Chinese, Simplified Chinese, Burmese, Lao, Khmer, Thai, Vietnamese, Indonesian, Malay, etc.
- **Translation Cache**: Avoid duplicate API calls, save costs
- **Concurrent Translation**: Support concurrent API calls for significantly faster batch translation
- **Dynamic Progress**: Real-time progress display during batch translation with source text preview and target language flags
- **Three Translation Entry Points**:
  - 🤖 **Dashboard Batch Translation**: Click "🤖 Auto Translate" button in progress dashboard to automatically translate all missing items
  - 🤖 **Right Panel Single Key Translation**: Click 🤖 button in Key Editor to translate missing items for current language
  - 🤖 **Hover Translation**: Hover in code or JSON files, click "🤖 Translate Missing" to translate missing languages
- **Auto Translation**: Automatically translate empty keys when saving translation files (configurable `autoTranslateOnSave`)
- **Custom Endpoints**: Support proxy or privately deployed API endpoints
- **Confirm Override**: Confirmation prompt for existing translations during auto translation to prevent accidental overwrites

### ✏️ Inline Editing

- **Code Actions**: Right-click in Go / Vue / React code to edit translations, translate missing languages
- **Hover Editing**: Hover over values in JSON translation files, click ✏️ for inline editing
- No need to switch to translation files, complete translation modifications directly in code

### 🔧 Key Dependency Graph

![Key Dependencies](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/key-dependencies.png)

- **File ↔ Key Bidirectional Association**: Left side shows code files, right side shows i18n keys, connections show reference relationships
- **Reference Frequency Sorting**: Sort keys by A→Z / frequency descending / frequency ascending to quickly identify core translations
- **Line Number Navigation**: Click reference items to jump directly to corresponding code lines
- **📋 AI Prompt**: One-click copy of unused key list for AI review and cleanup
- **🗑️ Batch Cleanup**: One-click delete all unused keys (with confirmation dialog)
- **Search Filter**: Search files and keys by keywords

### 🔀 Translation Diff View

- **Source Language Comparison**: Compare all target language translations based on source language
- **Status Markers**: MISS (missing) / EMPTY (empty) / DIFF (different) / ✅ (consistent)
- **Filtering**: Filter by missing, empty, different status
- **Click Navigation**: Click keys to navigate to corresponding translation files

### 🔍 Translation Quality Check

- **Placeholder Consistency Check**: Detect if placeholders like `%s`, `%d`, `{name}` are consistent across all languages
- **Length Anomaly Detection**: Detect translations with length differences too large (>5x or <0.2x) compared to source language
- **Empty Source Value Detection**: Detect keys with empty values in source language
- **Visual Reports**: Output detailed quality check reports in Output Channel

### 📜 Translation History & Undo

- **Auto Recording**: Automatically record each translation modification (add, modify, delete) to history
- **One-click Undo**: Undo last translation modification, restore to previous value
- **History View**: View all translation modification history with time, operation type, key, old and new values
- **Max 200 Records**: History retains maximum 200 records, automatically removes oldest

### 💡 Auto Completion

- **Smart Completion**: Auto-complete list pops up when typing i18n keys in Go / Vue / React code
- **Multi-language Preview**: Completion items show translation values in all languages
- **Priority Sorting**: Keys with translation values appear first

### 📊 Status Bar

- **Real-time Progress**: Bottom status bar shows translation completion percentage
- **Icon Indicators**: 100% ✅ / ≥80% 🌐 / <80% ⚠️
- **Hover Details**: Mouse hover shows key count, language count, missing translation count
- **Click Navigation**: Click to open Progress Dashboard

### 🔧 Refactoring Tools

- **Rename Key**: Global replacement of i18n key, updating both translation files and code references
- **Delete Key**: Delete specified key from all language files
- **Find Unused Keys**: Scan codebase to find unused translation keys
- **Batch Delete Unused Keys**: One-click cleanup of all unused translations
- **Diff Reports**: Generate translation difference reports to view missing and empty value details
- **Key Sorting**: Sort JSON keys alphabetically for specified language
- **Drag & Drop**: Drag keys to new groups in tree view

### 🌐 Internationalization

- **Plugin Self-Internationalization**: Supports Chinese / English interface switching
- **Configuration Priority**: `env.language` > `displayLanguage` settings
- **Dynamic Switching**: Automatically reloads after changing language settings

## 📦 Installation

### Install from VSIX

1. Download the latest `.vsix` file
2. In VS Code, press `Ctrl+Shift+P`, type `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file

### Build from Source

```bash
git clone https://github.com/kamalyes/i18n-ally-pro.git
cd i18n-ally-pro
nvm install 20.20.2
npm install -g npm@11.13.0
npm install
npm run package # Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# Generated .vsix file is in project root directory
npx vsce package --allow-missing-repository
```

## 🚀 Usage

### Basic Usage

1. Open a project containing translation files
2. Plugin automatically detects translation directories, languages, and framework
3. 🌐 i18n Ally Pro icon appears in sidebar, expand to view translation tree

### Translation API Configuration

Before using machine translation features, configure translation API Key. See [Translation API Configuration Guide](https://cdn.jsdelivr.net/gh/kamalyes/i18n-ally-pro@master/docs/assets/translator-setup.png).

Quick Configuration (Google example):

```json
{
  "i18nAllyPro.translatorEngine": "google",
  "i18nAllyPro.translatorApiKey": "YOUR_API_KEY"
}
```

| Engine | Free Quota | Application URL |
|--------|------------|-----------------|
| **Google** | 500K chars/month | [Google Cloud Console](https://console.cloud.google.com/) |
| **DeepL** | 500K chars/month | [DeepL API](https://www.deepl.com/pro#developer) |
| **OpenAI** | Token-based billing | [OpenAI Platform](https://platform.openai.com/) |
| **Microsoft** | 2M chars/month | [Azure Portal](https://portal.azure.com/) |

### Command List

| Command | Description |
|---------|-------------|
| `i18n Pro: Extract Text to i18n Key` | Extract selected text as i18n key |
| `i18n Pro: Refresh Translations` | Refresh translation data |
| `i18n Pro: Open Translation File` | Open translation file and locate key |
| `i18n Pro: Edit Translation` | Edit translation |
| `i18n Pro: Copy i18n Key` | Copy key |
| `i18n Pro: Show Diagnostics` | Show diagnostic information (missing/empty values) |
| `i18n Pro: Auto Translate Empty Keys` | Auto translate all empty keys |
| `i18n Pro: Translate Current Key` | Translate key at cursor |
| `i18n Pro: Show Translation Matrix` | Open translation matrix |
| `i18n Pro: Show Progress Dashboard` | Open progress dashboard |
| `i18n Pro: Open Key Editor` | Open right panel Key Editor |
| `i18n Pro: Show Diff Report` | Show translation difference report (visual Diff view) |
| `i18n Pro: Show Key Dependencies` | Show Key dependency graph |
| `i18n Pro: Sync Error Codes from Go` | Sync ErrorCode from Go file |
| `i18n Pro: Add New Error Code` | Manually add ErrorCode |
| `i18n Pro: Add Error Code Wizard` | ErrorCode add wizard (auto translation) |
| `i18n Pro: Check Integrity` | Check Go constants and JSON consistency |
| `i18n Pro: Go to Go Const Definition` | Jump to Go constant definition |
| `i18n Pro: Go to JSON Translation` | Jump to JSON translation |
| `i18n Pro: Inline Edit Translation` | Inline edit translation in code |
| `i18n Pro: Inline Translate Missing` | Inline translate missing languages in code |
| `i18n Pro: Rename i18n Key` | Rename key (global replacement) |
| `i18n Pro: Delete i18n Key` | Delete key |
| `i18n Pro: Add New i18n Key` | Add new i18n key (with auto translation) |
| `i18n Pro: Batch Translate Group` | Batch translate all missing items in group |
| `i18n Pro: Delete Key Group` | Delete entire key group |
| `i18n Pro: Sort Translation Keys` | Sort translation keys alphabetically |
| `i18n Pro: Search Keys` | Search filter i18n keys |
| `i18n Pro: Clear Search Filter` | Clear search filter |
| `i18n Pro: Quality Check` | Translation quality check (placeholders & consistency) |
| `i18n Pro: Undo Last Translation Change` | Undo last translation change |
| `i18n Pro: Show Translation History` | Show translation modification history |
| `i18n Pro: Find Unused Keys` | Find unused keys |
| `i18n Pro: Delete Unused Keys` | Delete unused keys |
| `i18n Pro: Clear Translation Cache` | Clear translation cache |
| `i18n Pro: Init Locales from Go` | Initialize locale configuration from Go |
| `i18n Pro: Complete Missing Keys` | One-click completion of missing keys |

## ⚙️ Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `i18nAllyPro.localesPaths` | `string[]` | `[]` | Translation file directories (empty for auto detection) |
| `i18nAllyPro.framework` | `string` | `"auto"` | Framework type: auto / go-rpc-gateway / vue-i18n / react-i18next / general |
| `i18nAllyPro.keystyle` | `string` | `"auto"` | Key style: auto / flat / nested |
| `i18nAllyPro.enabledParsers` | `string[]` | `[]` | Enabled parsers: json / yaml / po / properties |
| `i18nAllyPro.sourceLanguage` | `string` | `""` | Source language (empty for auto detection) |
| `i18nAllyPro.displayLanguage` | `string` | `""` | Display language (default same as source language) |
| `i18nAllyPro.translatorEngine` | `string` | `"google"` | Translation engine: google / deepl / openai / microsoft |
| `i18nAllyPro.translatorApiKey` | `string` | `""` | Translation API Key |
| `i18nAllyPro.translatorApiEndpoint` | `string` | `""` | Custom API endpoint (support proxy/private deployment) |
| `i18nAllyPro.autoTranslateOnSave` | `boolean` | `false` | Auto translate empty keys on save |
| `i18nAllyPro.errorCodesPath` | `string` | `""` | Go ErrorCode file path (empty for auto detection) |
| `i18nAllyPro.ignoreDirs` | `string[]` | `[]` | Additional ignored directories during scanning (merged with defaults) |

## 🏗 Project Structure

```
i18n-ally-pro/
├── src/
│   ├── extension.ts              # Plugin entry point
│   ├── i18n/                     # Plugin self-internationalization
│   │   └── index.ts              # i18n loader + flag mapping
│   ├── core/
│   │   ├── store.ts              # Translation data storage (with history)
│   │   ├── detector.ts           # Project configuration detection
│   │   ├── constants.ts          # Constant definitions
│   │   └── types.ts              # Type definitions
│   ├── providers/
│   │   ├── hover.ts              # Hover provider (code + JSON)
│   │   ├── definition.ts         # Definition jump provider
│   │   ├── diagnostic.ts         # Diagnostic provider
│   │   ├── tree.ts               # Sidebar tree view (drag & drop + search + right-click menu)
│   │   ├── codelens.ts           # CodeLens provider
│   │   ├── completion.ts         # Auto completion provider
│   │   ├── inlineEdit.ts         # Inline edit CodeAction
│   │   ├── keyEditorPanel.ts     # Right panel Key Editor (SVG flags + 🤖 translation)
│   │   ├── matrixPanel.ts        # Translation matrix panel
│   │   ├── progressDashboard.ts  # Progress dashboard (SVG flags + batch translation)
│   │   └── diffViewPanel.ts      # Translation Diff view panel
│   ├── services/
│   │   ├── extraction.ts         # Text extraction service
│   │   ├── translator.ts         # Translation service (Google/DeepL/OpenAI/Microsoft)
│   │   ├── translators/          # Translation engine modules
│   │   │   ├── base.ts           # Translation engine base class
│   │   │   ├── google.ts         # Google Translate engine
│   │   │   ├── deepl.ts          # DeepL engine
│   │   │   ├── openai.ts         # OpenAI engine
│   │   │   └── microsoft.ts      # Microsoft engine
│   │   ├── errorCodeSync.ts      # ErrorCode synchronization service
│   │   ├── qualityCheck.ts       # Translation quality check service
│   │   ├── refactor.ts           # Refactoring tools service
│   │   └── history.ts            # Translation history service
│   ├── views/
│   │   ├── treeView.ts           # Tree view implementation
│   │   ├── keyEditorView.ts      # Key Editor view implementation
│   │   ├── matrixView.ts         # Matrix view implementation
│   │   ├── dashboardView.ts      # Dashboard view implementation
│   │   ├── diffView.ts           # Diff view implementation
│   │   └── dependencyView.ts     # Dependency graph view implementation
│   └── utils/
│       ├── file.ts               # File operations utilities
│       ├── string.ts             # String utilities
│       ├── array.ts              # Array utilities
│       ├── object.ts             # Object utilities
│       ├── regex.ts              # Regex utilities
│       ├── path.ts               # Path utilities
│       ├── flag.ts               # Flag icon utilities
│       ├── cache.ts              # Cache utilities
│       └── logger.ts             # Logging utilities
├── package.json                  # VS Code extension manifest
├── tsconfig.json                 # TypeScript configuration
├── webpack.config.js             # Webpack configuration
└── README.md                     # This file
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Flag icons provided by [flag-icons](https://github.com/lipis/flag-icons)
- Translation services by Google, DeepL, OpenAI, and Microsoft
- Inspired by various i18n tools and libraries in the ecosystem