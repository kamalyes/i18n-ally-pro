import {
  CodeActionProvider, CodeAction, CodeActionKind, TextDocument, Range, Position,
  CancellationToken, CodeActionContext, workspace, window, WorkspaceEdit,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { Scanner, ScannerMatch } from '../core/types'
import { GoScanner } from '../scanners/go'
import { VueScanner } from '../scanners/vue'
import { ReactScanner } from '../scanners/react'

export class I18nInlineEditProvider implements CodeActionProvider {
  private store: TranslationStore
  private scanners: Scanner[]

  constructor(store: TranslationStore) {
    this.store = store
    this.scanners = [new GoScanner(), new VueScanner(), new ReactScanner()]
  }

  async provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    _token: CancellationToken,
  ): Promise<CodeAction[]> {
    const actions: CodeAction[] = []
    const text = document.getText()
    const offset = document.offsetAt(range.start)

    for (const scanner of this.scanners) {
      if (!scanner.languageIds.includes(document.languageId)) continue

      const matches = scanner.scan(text, document.uri.fsPath)
      const match = matches.find(m => offset >= m.start && offset <= m.end)

      if (match) {
        actions.push(...this.createEditActions(match, document))
        actions.push(...this.createTranslateActions(match, document))
        actions.push(...this.createCopyActions(match, document))
        break
      }
    }

    return actions
  }

  private createEditActions(match: ScannerMatch, document: TextDocument): CodeAction[] {
    const actions: CodeAction[] = []
    const config = this.store.projectConfig

    for (const locale of this.store.locales) {
      const currentValue = this.store.getTranslation(locale, match.key) || ''
      const action = new CodeAction(
        `✏️ Edit ${locale}: "${currentValue.length > 30 ? currentValue.slice(0, 30) + '...' : currentValue}"`,
        CodeActionKind.QuickFix,
      )
      action.isPreferred = locale === config.sourceLanguage
      action.command = {
        command: 'i18nAllyPro.inlineEdit',
        title: 'Edit Translation',
        arguments: [match.key, locale],
      }
      actions.push(action)
    }

    return actions
  }

  private createTranslateActions(match: ScannerMatch, document: TextDocument): CodeAction[] {
    const actions: CodeAction[] = []
    const config = this.store.projectConfig

    const missingLocales = this.store.locales.filter(l => {
      const v = this.store.getTranslation(l, match.key)
      return v === undefined || v === ''
    })

    if (missingLocales.length > 0) {
      const action = new CodeAction(
        `🤖 Auto-translate to ${missingLocales.length} missing locale(s): ${missingLocales.join(', ')}`,
        CodeActionKind.QuickFix,
      )
      action.command = {
        command: 'i18nAllyPro.inlineTranslate',
        title: 'Auto Translate',
        arguments: [match.key, missingLocales],
      }
      actions.push(action)
    }

    return actions
  }

  private createCopyActions(match: ScannerMatch, document: TextDocument): CodeAction[] {
    const actions: CodeAction[] = []

    const copyKeyAction = new CodeAction(
      `📋 Copy key: ${match.key}`,
      CodeActionKind.QuickFix,
    )
    copyKeyAction.command = {
      command: 'i18nAllyPro.copyKey',
      title: 'Copy Key',
      arguments: [match.key],
    }
    actions.push(copyKeyAction)

    const openMatrixAction = new CodeAction(
      `🌐 Open in Matrix`,
      CodeActionKind.QuickFix,
    )
    openMatrixAction.command = {
      command: 'i18nAllyPro.showMatrix',
      title: 'Open Matrix',
    }
    actions.push(openMatrixAction)

    return actions
  }
}
