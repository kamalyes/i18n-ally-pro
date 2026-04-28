import { ExtensionContext, languages, window, workspace, commands, Uri, ViewColumn, Position, Range, Selection, CodeActionKind, RelativePattern, ProgressLocation } from 'vscode'
import { TranslationStore } from './core/store'
import { I18nHoverProvider } from './providers/hover'
import { I18nDefinitionProvider } from './providers/definition'
import { I18nDiagnosticProvider } from './providers/diagnostic'
import { I18nTreeProvider, I18nDragAndDropController } from './providers/tree'
import { I18nCodeLensProvider } from './providers/codelens'
import { I18nInlineEditProvider } from './providers/inlineEdit'
import { I18nCompletionProvider } from './providers/completion'
import { ExtractionService } from './services/extraction'
import { TranslatorService } from './services/translator'
import { ErrorCodeSyncService } from './services/errorCodeSync'
import { LocaleInitService } from './services/localeInit'
import { RefactorService } from './services/refactor'
import { KeyDependencyService } from './services/keyDependency'
import { QualityCheckService } from './services/qualityCheck'
import { TranslationHistoryService } from './services/translationHistory'
import { StatusBarService } from './services/statusBar'
import { TranslationMatrixPanel } from './providers/matrixPanel'
import { ProgressDashboard } from './providers/progressDashboard'
import { KeyEditorPanel } from './providers/keyEditorPanel'
import { DiffViewPanel } from './providers/diffViewPanel'
import { initI18n, reloadI18n, getCurrentLanguage, t, getLocaleFlag } from './i18n'

let store: TranslationStore | null = null
let diagnosticProvider: I18nDiagnosticProvider | null = null
let translatorService: TranslatorService | null = null
let errorCodeSyncService: ErrorCodeSyncService | null = null
let localeInitService: LocaleInitService | null = null
let refactorService: RefactorService | null = null
let matrixPanel: TranslationMatrixPanel | null = null
let progressDashboard: ProgressDashboard | null = null
let treeProvider: I18nTreeProvider | null = null
let keyEditorPanel: KeyEditorPanel | null = null
let keyDependencyService: KeyDependencyService | null = null
let qualityCheckService: QualityCheckService | null = null
let translationHistoryService: TranslationHistoryService | null = null
let diffViewPanel: DiffViewPanel | null = null
let diffOutputChannel: import('vscode').OutputChannel | null = null

function getStore(): TranslationStore {
  if (!store) throw new Error('i18n Ally Pro not initialized')
  return store
}

export async function activate(context: ExtensionContext) {
  const rootPath = workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!rootPath) return

  const outputChannel = window.createOutputChannel('i18n Ally Pro')
  context.subscriptions.push(outputChannel)

  initI18n(context.extensionPath)

  store = new TranslationStore(rootPath)

  // 设置上下文条件
  commands.executeCommand('setContext', 'i18nAllyPro.hasTranslations', true)

  treeProvider = new I18nTreeProvider(store)
  const dragAndDropController = new I18nDragAndDropController(store, () => {
    store?.refresh()
    treeProvider?.refresh()
  })
  context.subscriptions.push(
    window.createTreeView('i18nAllyPro.tree', {
      treeDataProvider: treeProvider,
      dragAndDropController,
      showCollapseAll: true,
    }),
  )

  let initialized = false
  try {
    await store.init()
    initialized = true
    const config = store.projectConfig
    outputChannel.appendLine(`i18n Ally Pro: Initialized successfully`)
    outputChannel.appendLine(`  Framework: ${config.framework}`)
    outputChannel.appendLine(`  Key style: ${config.keystyle}`)
    outputChannel.appendLine(`  Locales: ${store.locales.join(', ')}`)
    outputChannel.appendLine(`  Source language: ${config.sourceLanguage}`)
  }
  catch (err: any) {
    outputChannel.appendLine(`i18n Ally Pro: Initialization failed - ${err.message}`)
    outputChannel.show()
    window.showWarningMessage(t('misc.init_failed', err.message))
  }

  if (initialized) {
    try {
      registerProviders(context)
      registerServices(context)
    }
    catch (err: any) {
      outputChannel.appendLine(`i18n Ally Pro: Provider registration failed - ${err.message}`)
    }
  }

  keyEditorPanel = new KeyEditorPanel(store)
  diffOutputChannel = window.createOutputChannel('i18n Ally Pro - Diff Report')
  context.subscriptions.push(diffOutputChannel)

  context.subscriptions.push(
    commands.registerCommand('i18nAllyPro.refresh', async () => {
      try {
        if (!initialized && store) {
          await store.init()
          initialized = true
          registerProviders(context)
          registerServices(context)
        }
        await store!.refresh()
        treeProvider!.refresh()
        window.showInformationMessage(t('misc.refreshed'))
      }
      catch (err: any) {
        window.showErrorMessage(t('misc.refresh_failed', err.message))
      }
    }),
    commands.registerCommand('i18nAllyPro.copyKey', async (key?: string) => {
      if (key) {
        await commands.executeCommand('copy', key)
        window.showInformationMessage(t('misc.copied', key))
      }
    }),
    commands.registerCommand('i18nAllyPro.openKeyAndFile', async (key?: string, locale?: string) => {
      if (!store || !key) return
      if (!locale) locale = store.projectConfig.sourceLanguage

      const file = store.findFileForKey(key, locale)
      if (file) {
        const pos = store.findKeyPosition(file.filepath, key)
        const doc = await workspace.openTextDocument(Uri.file(file.filepath))
        const editor = await window.showTextDocument(doc, ViewColumn.One, true)
        if (pos) {
          const position = new Position(pos.line, pos.column)
          editor.selection = new Selection(position, position)
          editor.revealRange(new Range(position, position))
        }
      }

      if (keyEditorPanel) {
        keyEditorPanel.show(key)
      }
    }),
  )

  if (initialized) {
    registerCommands(context)
    await diagnosticProvider!.validateAll()
  }

  context.subscriptions.push(
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('i18nAllyPro.displayLanguage')) {
        reloadI18n()
        treeProvider?.refresh()
        window.showInformationMessage(t('misc.language_changed', getCurrentLanguage()))
      }
    }),
  )
}

function registerProviders(context: ExtensionContext) {
  if (!store) return

  const hoverProvider = new I18nHoverProvider(store)
  const definitionProvider = new I18nDefinitionProvider(store)
  diagnosticProvider = new I18nDiagnosticProvider(store)
  const codeLensProvider = new I18nCodeLensProvider(store)
  const inlineEditProvider = new I18nInlineEditProvider(store)
  const completionProvider = new I18nCompletionProvider(store)

  const selector = [
    { scheme: 'file', language: 'go' },
    { scheme: 'file', language: 'vue' },
    { scheme: 'file', language: 'html' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'javascriptreact' },
    { scheme: 'file', language: 'typescriptreact' },
  ]

  context.subscriptions.push(
    languages.registerHoverProvider(selector, hoverProvider),
    languages.registerHoverProvider([{ scheme: 'file', language: 'json' }, { scheme: 'file', language: 'jsonc' }], hoverProvider),
    languages.registerDefinitionProvider(selector, definitionProvider),
    languages.registerCodeLensProvider(selector, codeLensProvider),
    languages.registerCodeActionsProvider(selector, inlineEditProvider, {
      providedCodeActionKinds: [CodeActionKind.QuickFix],
    }),
    languages.registerCompletionItemProvider(selector, completionProvider, '"', "'", '`'),
  )
}

function registerServices(context: ExtensionContext) {
  if (!store) return

  const extractionService = new ExtractionService(store)
  translatorService = new TranslatorService(store)
  errorCodeSyncService = new ErrorCodeSyncService(store)
  localeInitService = new LocaleInitService(store, translatorService)
  refactorService = new RefactorService(store)
  keyDependencyService = new KeyDependencyService(store)
  qualityCheckService = new QualityCheckService(store)
  translationHistoryService = new TranslationHistoryService(store)
  store.setHistoryService(translationHistoryService)
  matrixPanel = new TranslationMatrixPanel(store, translatorService)
  progressDashboard = new ProgressDashboard(store, translatorService, () => { treeProvider?.refresh() })
  diffViewPanel = new DiffViewPanel(store)

  const statusBarService = new StatusBarService(store)
  context.subscriptions.push(statusBarService)

  context.subscriptions.push(
    workspace.onDidSaveTextDocument(async (doc) => {
      if (!store) return
      const isTranslationFile = store.getTranslationFiles().some(f => f.filepath === doc.uri.fsPath)
      if (isTranslationFile) {
        await store.refresh()
        treeProvider?.refresh()
        progressDashboard?.refresh()

        const autoTranslate = workspace.getConfiguration('i18nAllyPro').get<boolean>('autoTranslateOnSave', false)
        if (autoTranslate && translatorService) {
          const result = await translatorService.autoTranslateEmptyKeys()
          if (result.translated > 0) {
            window.showInformationMessage(t('misc.auto_translated', result.translated, translatorService.getEffectiveEngine()))
            await store.refresh()
            treeProvider?.refresh()
            progressDashboard?.refresh()
          }
        }
      }
      else {
        await diagnosticProvider?.validateDocument(doc)
      }
    }),
  )

  const localesPaths = store.projectConfig.localesPaths
  if (localesPaths && localesPaths.length > 0) {
    const path = require('path')
    const localesDir = path.resolve(store.projectConfig.rootPath, localesPaths[0])
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(localesDir, '**/*.{json,yaml,yml}')
    )
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(async () => {
        if (!store) return
        await store.refresh()
        treeProvider?.refresh()
        progressDashboard?.refresh()
      }, 500)
    }
    watcher.onDidChange(debouncedRefresh)
    watcher.onDidCreate(debouncedRefresh)
    watcher.onDidDelete(debouncedRefresh)
    context.subscriptions.push(watcher)
  }
}

function registerCommands(context: ExtensionContext) {
  if (!store) return

  context.subscriptions.push(
    commands.registerCommand('i18nAllyPro.extractText', () => {
      if (!store) return
      const extractionService = new ExtractionService(store)
      extractionService.extractText()
    }),
    commands.registerCommand('i18nAllyPro.openTranslation', async (keyOrUri?: Uri | string, key?: string) => {
      if (!store) return
      if (typeof keyOrUri === 'string') {
        const k = keyOrUri
        const file = store.findFileForKey(k, store.projectConfig.sourceLanguage)
        if (file) {
          const pos = store.findKeyPosition(file.filepath, k)
          const doc = await workspace.openTextDocument(Uri.file(file.filepath))
          const editor = await window.showTextDocument(doc, ViewColumn.One)
          if (pos) {
            const position = new Position(pos.line, pos.column)
            editor.selection = new Selection(position, position)
            editor.revealRange(new Range(position, position))
          }
        }
      }
      else if (keyOrUri instanceof Uri && key) {
        const doc = await workspace.openTextDocument(keyOrUri)
        await window.showTextDocument(doc, ViewColumn.One)
      }
    }),
    commands.registerCommand('i18nAllyPro.editTranslation', async (node: any) => {
      if (!store || !node?.key) return
      const locale = node.locale || store.projectConfig.sourceLanguage
      const currentValue = store.getTranslation(locale, node.key) || ''
      const newValue = await window.showInputBox({
        prompt: `Edit translation for "${node.key}" (${locale})`,
        value: currentValue,
      })
      if (newValue !== undefined)
        await store.setTranslation(locale, node.key, newValue)
    }),
    commands.registerCommand('i18nAllyPro.showDiagnostics', async () => {
      if (!store || !diagnosticProvider) return
      await diagnosticProvider.validateAll()
      const diags = store.getDiagnostics()
      const missing = diags.filter(d => d.type === 'missing')
      const empty = diags.filter(d => d.type === 'empty')
      window.showInformationMessage(
        t('misc.diagnostics_summary', missing.length, empty.length),
      )
    }),
    commands.registerCommand('i18nAllyPro.autoTranslate', async () => {
      if (!store || !translatorService) return
      const engine = translatorService.getEffectiveEngine()
      const result = await translatorService.autoTranslateEmptyKeys()
      const msg = t('misc.translate_result', engine, result.translated, result.skipped, result.errors)
      if (result.errors > 0)
        window.showWarningMessage(msg)
      else
        window.showInformationMessage(msg)
      await store.refresh()
      treeProvider?.refresh()
    }),
    commands.registerCommand('i18nAllyPro.translateKey', async () => {
      if (!store || !translatorService) return
      const editor = window.activeTextEditor
      if (!editor) return

      const text = editor.document.getText()
      const offset = editor.document.offsetAt(editor.selection.active)

      const { GoScanner } = await import('./scanners/go')
      const { VueScanner } = await import('./scanners/vue')
      const { ReactScanner } = await import('./scanners/react')
      const scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]

      let matchedKey: string | null = null
      for (const scanner of scanners) {
        if (!scanner.languageIds.includes(editor.document.languageId)) continue
        const matches = scanner.scan(text, editor.document.uri.fsPath)
        const match = matches.find(m => offset >= m.start && offset <= m.end)
        if (match) { matchedKey = match.key; break }
      }

      if (!matchedKey) {
        window.showWarningMessage(t('misc.no_key_at_cursor'))
        return
      }

      const targetLocales = store!.locales.filter(l => {
        const val = store!.getTranslation(l, matchedKey!)
        return val === undefined || val === ''
      })

      if (targetLocales.length === 0) {
        window.showInformationMessage(t('misc.already_translated', matchedKey))
        return
      }

      let translated = 0
      for (const locale of targetLocales) {
        const result = await translatorService.translateSingleKey(matchedKey, locale)
        if (result) {
          await store.setTranslation(locale, matchedKey, result)
          translated++
        }
      }

      window.showInformationMessage(t('misc.translated_key', matchedKey, translated))
      treeProvider?.refresh()
    }),
    commands.registerCommand('i18nAllyPro.syncErrorCodes', async (uri?: Uri) => {
      if (!store || !errorCodeSyncService) return
      if (uri) {
        const result = await errorCodeSyncService.syncFromGoFile(uri.fsPath)
        window.showInformationMessage(
          t('misc.synced', uri.fsPath, result.added, result.skipped, result.errors),
        )
      }
      else {
        const result = await errorCodeSyncService.syncAllGoFiles()
        window.showInformationMessage(
          t('misc.synced_all', result.files, result.added, result.skipped, result.errors),
        )
      }
      await store.refresh()
      treeProvider?.refresh()
    }),
    commands.registerCommand('i18nAllyPro.addErrorCode', async () => {
      if (!store || !errorCodeSyncService) return
      const constName = await window.showInputBox({
        prompt: 'Go constant name (e.g. BizErrCodeUserNotFound)',
        placeHolder: 'BizErrCodeXxx',
      })
      if (!constName) return

      const keyValue = await window.showInputBox({
        prompt: 'i18n key value (e.g. error.user.not_found)',
        placeHolder: 'error.xxx.yyy',
      })
      if (!keyValue) return

      const zhDescription = await window.showInputBox({
        prompt: 'Chinese description (will be set as zh translation)',
        placeHolder: '用户未找到',
      })
      if (!zhDescription) return

      const success = await errorCodeSyncService.addNewErrorCode(constName, keyValue, zhDescription)
      if (success) {
        window.showInformationMessage(
          t('misc.added', constName, keyValue, zhDescription),
        )
        await store.refresh()
        treeProvider?.refresh()
      }
    }),
    commands.registerCommand('i18nAllyPro.addErrorCodeWizard', async () => {
      if (!store || !errorCodeSyncService) return
      const success = await errorCodeSyncService.addErrorCodeWizard()
      if (success) {
        await store.refresh()
        treeProvider?.refresh()
      }
    }),
    commands.registerCommand('i18nAllyPro.showMatrix', () => {
      if (!store || !matrixPanel) return
      matrixPanel.show()
    }),
    commands.registerCommand('i18nAllyPro.showDashboard', () => {
      if (!store || !progressDashboard) return
      progressDashboard.show()
    }),
    commands.registerCommand('i18nAllyPro.checkIntegrity', async () => {
      if (!store || !errorCodeSyncService) return
      const result = await errorCodeSyncService.checkIntegrity()

      const items: string[] = []
      if (result.goOnlyKeys.length > 0) {
        items.push(`🔴 ${result.goOnlyKeys.length} keys in Go but missing from JSON:`)
        items.push(...result.goOnlyKeys.slice(0, 10).map(k => `   ${k}`))
        if (result.goOnlyKeys.length > 10) items.push(`   ... and ${result.goOnlyKeys.length - 10} more`)
      }
      if (result.jsonOnlyKeys.length > 0) {
        items.push(`🟡 ${result.jsonOnlyKeys.length} keys in JSON but not in Go consts:`)
        items.push(...result.jsonOnlyKeys.slice(0, 10).map(k => `   ${k}`))
        if (result.jsonOnlyKeys.length > 10) items.push(`   ... and ${result.jsonOnlyKeys.length - 10} more`)
      }
      if (result.goOnlyKeys.length === 0 && result.jsonOnlyKeys.length === 0) {
        items.push('✅ All Go consts and JSON keys are in sync!')
      }

      items.push('')
      items.push(`📊 Go consts: ${result.totalGoConsts}, JSON keys: ${result.totalJsonKeys}`)
      items.push('')
      items.push('Locale coverage:')
      for (const lc of result.localeCoverage) {
        items.push(`   ${lc.locale}: ${lc.covered}/${lc.total} (${lc.pct}%)`)
      }

      const outputChannel = window.createOutputChannel('i18n Integrity Check')
      outputChannel.clear()
      outputChannel.appendLine(items.join('\n'))
      outputChannel.show()
    }),
    commands.registerCommand('i18nAllyPro.goToGoConst', async (keyValue?: string) => {
      if (!errorCodeSyncService) return
      if (!keyValue) {
        keyValue = await window.showInputBox({
          prompt: 'Enter i18n key to find Go const (e.g. error.user.not_found)',
          placeHolder: 'error.xxx.yyy',
        })
      }
      if (!keyValue) return
      const found = await errorCodeSyncService.goToGoConst(keyValue)
      if (!found) window.showWarningMessage(t('misc.not_found', keyValue))
    }),
    commands.registerCommand('i18nAllyPro.goToJsonKey', async (keyValue?: string) => {
      if (!store || !errorCodeSyncService) return
      if (!keyValue) {
        keyValue = await window.showInputBox({
          prompt: 'Enter i18n key to find JSON translation (e.g. error.user.not_found)',
          placeHolder: 'error.xxx.yyy',
        })
      }
      if (!keyValue) return

      const locale = await window.showQuickPick(store.locales, { placeHolder: 'Select locale' })
      if (!locale) return

      const found = await errorCodeSyncService.goToJsonKey(keyValue, locale)
      if (!found) window.showWarningMessage(t('misc.json_not_found', keyValue, locale))
    }),
    commands.registerCommand('i18nAllyPro.inlineEdit', async (key?: string, locale?: string) => {
      if (!store || !key || !locale) return
      const currentValue = store.getTranslation(locale, key) || ''
      const newValue = await window.showInputBox({
        prompt: `Edit "${key}" (${locale})`,
        value: currentValue,
      })
      if (newValue !== undefined) {
        await store.setTranslation(locale, key, newValue)
        window.showInformationMessage(t('misc.updated', key, locale))
      }
    }),
    commands.registerCommand('i18nAllyPro.inlineTranslate', async (key?: string, locales?: string[]) => {
      if (!store || !translatorService || !key || !locales) return
      const config = store.projectConfig
      const sourceValue = store.getTranslation(config.sourceLanguage, key)
      if (!sourceValue) {
        window.showWarningMessage(t('misc.no_source', key))
        return
      }

      let translated = 0
      for (const locale of locales) {
        try {
          const result = await translatorService.translateText(sourceValue, config.sourceLanguage, locale)
          if (result) {
            await store.setTranslation(locale, key, result)
            translated++
          }
        } catch (err: any) {
          window.showErrorMessage(t('misc.translation_failed', locale, err.message))
        }
      }

      window.showInformationMessage(t('misc.translated_key', key, translated))
    }),
    commands.registerCommand('i18nAllyPro.renameKey', async (node?: any) => {
      if (!store || !refactorService) return
      let oldKey = ''
      if (node && node.keypath) {
        oldKey = node.keypath
      } else {
        oldKey = (await window.showInputBox({
          prompt: 'Enter the i18n key to rename',
          placeHolder: 'error.old_key',
        })) || ''
      }
      if (!oldKey) return

      const newKey = await window.showInputBox({
        prompt: `Rename "${oldKey}" to`,
        value: oldKey,
      })
      if (!newKey || newKey === oldKey) return

      const result = await refactorService.renameKey(oldKey, newKey)
      window.showInformationMessage(t('misc.renamed', result.files, result.replacements))
      await store.refresh()
      treeProvider?.refresh()
    }),
    commands.registerCommand('i18nAllyPro.deleteKey', async (node?: any) => {
      if (!store || !refactorService) return
      let key = ''
      if (node && node.keypath) {
        key = node.keypath
      } else {
        key = (await window.showInputBox({
          prompt: 'Enter the i18n key to delete',
          placeHolder: 'error.xxx',
        })) || ''
      }
      if (!key) return

      const result = await refactorService.deleteKey(key)
      window.showInformationMessage(t('misc.deleted', result.files))
      await store.refresh()
      treeProvider?.refresh()
    }),
    commands.registerCommand('i18nAllyPro.addKey', async (node?: any) => {
      if (!store) return
      let prefix = ''
      if (node && node.keypath) {
        prefix = node.keypath + '.'
      }
      const key = await window.showInputBox({
        prompt: t('editor.add_key_prompt'),
        placeHolder: prefix ? `${prefix}new_key` : 'error.xxx.yyy',
        value: prefix,
        validateInput: (v) => {
          if (!v) return t('editor.key_required')
          if (/\s/.test(v)) return t('editor.key_no_spaces')
          if (store!.getTranslation(store!.projectConfig.sourceLanguage, v) !== undefined) return t('editor.key_exists')
          return null
        },
      })
      if (!key) return

      const sourceValue = await window.showInputBox({
        prompt: t('editor.add_key_source_value', store.projectConfig.sourceLanguage, key),
        placeHolder: '',
      })
      if (sourceValue === undefined) return

      await store.setTranslation(store.projectConfig.sourceLanguage, key, sourceValue)

      const shouldTranslate = await window.showInformationMessage(
        t('editor.add_key_translate', key),
        t('editor.translate'),
        t('editor.skip'),
      )
      if (shouldTranslate === t('editor.translate')) {
        const { TranslatorService } = await import('./services/translator')
        const ts = new TranslatorService(store)
        const sourceLocale = store.projectConfig.sourceLanguage
        const targetLocales = store.locales.filter(l => l !== sourceLocale)
        let translated = 0
        for (const locale of targetLocales) {
          try {
            const result = await ts.translateText(sourceValue, store.projectConfig.sourceLanguage, locale)
            if (result) {
              await store.setTranslation(locale, key, result)
              translated++
            }
          } catch { /* skip */ }
        }
        window.showInformationMessage(t('editor.add_key_done', key, String(translated)))
      } else {
        window.showInformationMessage(t('editor.add_key_done_no_translate', key))
      }

      await store.refresh()
      treeProvider?.refresh()
      keyEditorPanel?.show(key)
    }),
    commands.registerCommand('i18nAllyPro.batchTranslateGroup', async (node?: any) => {
      if (!store || !node?.keypath) return
      const groupPrefix = node.keypath
      const allKeys = store.getAllKeys().filter(k => k.startsWith(groupPrefix + '.') || k === groupPrefix)

      if (allKeys.length === 0) {
        window.showWarningMessage(t('editor.group_empty', groupPrefix))
        return
      }

      const sourceLocale = store.projectConfig.sourceLanguage
      const targetLocales = store.locales.filter(l => l !== sourceLocale)

      const pendingItems: { key: string; sourceValue: string; locale: string }[] = []
      for (const key of allKeys) {
        const sourceValue = store.getTranslation(sourceLocale, key)
        if (!sourceValue) continue
        for (const locale of targetLocales) {
          const existing = store.getTranslation(locale, key)
          if (existing === undefined || existing === '') {
            pendingItems.push({ key, sourceValue, locale })
          }
        }
      }

      if (pendingItems.length === 0) {
        window.showInformationMessage(t('editor.group_all_translated', groupPrefix))
        return
      }

      const { TranslatorService } = await import('./services/translator')
      const ts = new TranslatorService(store)
      let translated = 0
      let errors = 0
      let skipped = 0
      const total = pendingItems.length

      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: `🌐 i18n Pro: ${t('editor.batch_translate_group', groupPrefix)}`,
          cancellable: true,
        },
        async (progress, token) => {
          progress.report({ message: `[0/${total}] ⏳ Preparing...`, increment: 0 })

          for (let i = 0; i < pendingItems.length; i++) {
            if (token.isCancellationRequested) break
            const { key, sourceValue, locale } = pendingItems[i]
            const preview = sourceValue.length > 20 ? sourceValue.slice(0, 20) + '...' : sourceValue
            const pct = ((i + 1) / total) * 100

            progress.report({
              message: `[${i + 1}/${total}] 🔤 "${preview}" → ${getLocaleFlag(locale)} ${locale}`,
              increment: 100 / total,
            })
            try {
              const result = await ts.translateText(sourceValue, sourceLocale, locale)
              if (result) {
                await store!.setTranslation(locale, key, result)
                translated++
              } else {
                skipped++
              }
            } catch {
              errors++
            }
          }

          progress.report({
            message: `[${total}/${total}] ✅ ${translated} translated, ❌ ${errors} errors, ⏭️ ${skipped} skipped`,
          })
        },
      )

      await store.refresh()
      treeProvider?.refresh()
      window.showInformationMessage(t('editor.batch_translate_result', groupPrefix, String(translated), String(errors)))
    }),
    commands.registerCommand('i18nAllyPro.deleteGroup', async (node?: any) => {
      if (!store || !refactorService || !node?.keypath) return
      const groupPrefix = node.keypath
      const allKeys = store.getAllKeys().filter(k => k.startsWith(groupPrefix + '.') || k === groupPrefix)

      if (allKeys.length === 0) {
        window.showWarningMessage(t('editor.group_empty', groupPrefix))
        return
      }

      const confirm = await window.showWarningMessage(
        t('editor.delete_group_confirm', groupPrefix, String(allKeys.length)),
        { modal: true },
        t('editor.delete'),
      )
      if (confirm !== t('editor.delete')) return

      let deleted = 0
      for (const key of allKeys) {
        await refactorService.deleteKey(key)
        deleted++
      }
      window.showInformationMessage(t('editor.deleted_group', groupPrefix, String(deleted)))
      await store.refresh()
      treeProvider?.refresh()
    }),
    commands.registerCommand('i18nAllyPro.sortKeys', async (node?: any) => {
      if (!store) return
      const locale = node?.locale
      if (!locale) return

      const keys = store.getKeysForLocale(locale)
      const sorted = [...keys].sort()
      if (JSON.stringify(keys) === JSON.stringify(sorted)) {
        window.showInformationMessage(t('editor.already_sorted', locale))
        return
      }

      const translations: Record<string, string> = {}
      for (const key of sorted) {
        const v = store.getTranslation(locale, key)
        if (v !== undefined) translations[key] = v
      }

      const file = store.findFileForKey('', locale)
      if (file) {
        const { JsonParser } = await import('./parsers/json')
        const parser = new JsonParser()
        const data = store.projectConfig.keystyle === 'nested'
          ? store.nestObject(translations)
          : translations
        const content = parser.dump(data, true)
        const fs = await import('fs')
        fs.writeFileSync(file.filepath, content, 'utf-8')
      }

      await store.refresh()
      treeProvider?.refresh()
      window.showInformationMessage(t('editor.sorted', locale))
    }),
    commands.registerCommand('i18nAllyPro.searchKeys', async () => {
      if (!treeProvider) return
      const keyword = await window.showInputBox({
        prompt: t('editor.search_prompt'),
        placeHolder: 'error.xxx',
      })
      if (keyword !== undefined) {
        treeProvider.setSearchFilter(keyword)
      }
    }),
    commands.registerCommand('i18nAllyPro.clearSearch', () => {
      if (!treeProvider) return
      treeProvider.clearSearchFilter()
    }),
    commands.registerCommand('i18nAllyPro.qualityCheck', async () => {
      if (!qualityCheckService) return
      await qualityCheckService.showQualityReport()
    }),
    commands.registerCommand('i18nAllyPro.undoTranslation', async () => {
      if (!translationHistoryService) return
      if (!translationHistoryService.canUndo()) {
        window.showWarningMessage(t('editor.no_undo_history'))
        return
      }
      const success = await translationHistoryService.undo()
      if (success) {
        await store?.refresh()
        treeProvider?.refresh()
        window.showInformationMessage(t('editor.undo_success'))
      } else {
        window.showErrorMessage(t('editor.undo_failed'))
      }
    }),
    commands.registerCommand('i18nAllyPro.showTranslationHistory', () => {
      if (!translationHistoryService) return
      const history = translationHistoryService.getHistory()
      if (history.length === 0) {
        window.showInformationMessage(t('editor.no_history'))
        return
      }
      const outputChannel = window.createOutputChannel('i18n Translation History')
      outputChannel.clear()
      outputChannel.appendLine(`📜 i18n Translation History (${history.length} entries)`)
      outputChannel.appendLine('')
      for (const entry of [...history].reverse()) {
        const time = new Date(entry.timestamp).toLocaleString()
        const oldPreview = entry.oldValue ? (entry.oldValue.length > 30 ? entry.oldValue.slice(0, 30) + '...' : entry.oldValue) : '(empty)'
        const newPreview = entry.newValue ? (entry.newValue.length > 30 ? entry.newValue.slice(0, 30) + '...' : entry.newValue) : '(empty)'
        outputChannel.appendLine(`[${time}] ${entry.action} | ${getLocaleFlag(entry.locale)} ${entry.locale} | ${entry.key}`)
        outputChannel.appendLine(`  ${oldPreview} → ${newPreview}`)
      }
      outputChannel.show()
    }),
    commands.registerCommand('i18nAllyPro.findUnusedKeys', async () => {
      if (!store || !refactorService) return
      const unusedKeys = await refactorService.findUnusedKeys()
      if (unusedKeys.length === 0) {
        window.showInformationMessage(t('misc.no_unused'))
        return
      }

      const outputChannel = window.createOutputChannel('i18n Unused Keys')
      outputChannel.clear()
      outputChannel.appendLine(`Found ${unusedKeys.length} unused keys:\n`)
      for (const key of unusedKeys) {
        const zhValue = store.getTranslation('zh', key) || ''
        outputChannel.appendLine(`  ${key}  →  ${zhValue}`)
      }
      outputChannel.show()

      window.showInformationMessage(t('misc.unused_found', unusedKeys.length))
    }),
    commands.registerCommand('i18nAllyPro.deleteUnusedKeys', async () => {
      if (!store || !refactorService) return
      const result = await refactorService.deleteUnusedKeys()
      if (result.deleted > 0) {
        await store.refresh()
        treeProvider?.refresh()
        window.showInformationMessage(t('misc.deleted_unused', result.deleted, result.skipped))
      }
    }),
    commands.registerCommand('i18nAllyPro.clearTranslationCache', () => {
      if (!translatorService) return
      translatorService.clearCache()
      window.showInformationMessage(t('misc.cache_cleared'))
    }),
    commands.registerCommand('i18nAllyPro.openKeyEditor', async (node?: any) => {
      if (!store || !keyEditorPanel) return
      let keypath = ''
      if (node && typeof node === 'string') {
        keypath = node
      } else if (node && node.keypath) {
        keypath = node.keypath
      } else {
        keypath = (await window.showInputBox({
          prompt: 'Enter i18n key to edit',
          placeHolder: 'error.xxx.yyy',
        })) || ''
      }
      if (!keypath) return
      keyEditorPanel.show(keypath)
    }),
    commands.registerCommand('i18nAllyPro.showDiffReport', async () => {
      if (!diffViewPanel) return
      diffViewPanel.show()
    }),
    commands.registerCommand('i18nAllyPro.showKeyDependencies', async () => {
      if (!keyDependencyService) {
        window.showWarningMessage(t('misc.not_initialized'))
        return
      }
      await keyDependencyService.showDependencyGraph()
    }),
    commands.registerCommand('i18nAllyPro.initLocales', async () => {
      if (!store || !localeInitService) return
      const confirm = await window.showWarningMessage(
        'This will initialize/update 28 locale files from Go code definitions. Existing translations will be preserved. Continue?',
        { modal: true },
        'Yes',
      )
      if (confirm !== 'Yes') return

      const result = await localeInitService.initLocalesFromGo()
      if (result.createdFiles > 0 || result.updatedFiles > 0 || result.skippedFiles > 0) {
        window.showInformationMessage(
          t('misc.init_locales_result', result.createdFiles, result.updatedFiles, result.skippedFiles, result.totalKeys, result.translatedKeys),
        )
        await store.refresh()
        treeProvider?.refresh()
        progressDashboard?.refresh()
      }
    }),
    commands.registerCommand('i18nAllyPro.completeKeys', async () => {
      if (!store || !localeInitService) return
      const result = await localeInitService.completeMissingKeys()
      if (result.completed > 0) {
        window.showInformationMessage(
          t('misc.complete_keys_result', result.completed, result.translated, result.skipped, result.errors),
        )
        await store.refresh()
        treeProvider?.refresh()
        progressDashboard?.refresh()
      } else {
        window.showInformationMessage(t('misc.all_keys_complete'))
      }
    }),
  )
}

export function deactivate() {
  diagnosticProvider?.dispose()
  translatorService?.dispose()
}
