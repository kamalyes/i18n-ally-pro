import { window, workspace, WorkspaceEdit, Range, Uri, ProgressLocation } from 'vscode'
import fs from 'fs'
import { TranslationStore } from '../core/store'

export class RefactorService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async renameKey(oldKey: string, newKey: string): Promise<{ files: number; replacements: number }> {
    if (oldKey === newKey) return { files: 0, replacements: 0 }

    const existingValue = this.store.getTranslation(this.store.projectConfig.sourceLanguage, newKey)
    if (existingValue !== undefined) {
      const overwrite = await window.showWarningMessage(
        `Key "${newKey}" already exists. Overwrite?`,
        { modal: true },
        'Overwrite',
      )
      if (overwrite !== 'Overwrite') return { files: 0, replacements: 0 }
    }

    let files = 0
    let replacements = 0

    for (const locale of this.store.locales) {
      const value = this.store.getTranslation(locale, oldKey)
      if (value !== undefined) {
        await this.store.setTranslation(locale, newKey, value)
        await this.store.deleteTranslation(locale, oldKey)
        files++
        replacements++
      }
    }

    const codeFiles = await this.findCodeFilesUsingKey(oldKey)
    const edit = new WorkspaceEdit()

    for (const fileResult of codeFiles) {
      const doc = await workspace.openTextDocument(Uri.file(fileResult.filepath))
      const text = doc.getText()

      const newContent = this.replaceKeyInText(text, oldKey, newKey, doc.languageId)
      if (newContent !== text) {
        const fullRange = new Range(
          doc.positionAt(0),
          doc.positionAt(text.length),
        )
        edit.replace(doc.uri, fullRange, newContent)
        files++
        replacements += fileResult.occurrences
      }
    }

    if (edit.size > 0) {
      await workspace.applyEdit(edit)
    }

    return { files, replacements }
  }

  async deleteKey(key: string): Promise<{ files: number }> {
    const confirm = await window.showWarningMessage(
      `Delete key "${key}" from ALL locales and code references?`,
      { modal: true },
      'Delete',
    )
    if (confirm !== 'Delete') return { files: 0 }

    let files = 0

    for (const locale of this.store.locales) {
      const value = this.store.getTranslation(locale, key)
      if (value !== undefined) {
        await this.store.deleteTranslation(locale, key)
        files++
      }
    }

    return { files }
  }

  async findUnusedKeys(): Promise<string[]> {
    const allKeys = this.store.getAllKeys()
    const unusedKeys: string[] = []

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Finding unused keys',
        cancellable: true,
      },
      async (progress, token) => {
        const rootPath = this.store.projectConfig.rootPath
        const fg = require('fast-glob')
        const codeFiles: string[] = await fg('**/*.{go,vue,js,ts,jsx,tsx,html}', {
          cwd: rootPath,
          ignore: ['vendor', 'node_modules', '.git', 'dist', 'build'],
          onlyFiles: true,
          absolute: true,
        })

        const allCodeContent = new Map<string, string>()
        for (const file of codeFiles) {
          try {
            allCodeContent.set(file, fs.readFileSync(file, 'utf-8'))
          } catch { /* skip */ }
        }

        for (let i = 0; i < allKeys.length; i++) {
          if (token.isCancellationRequested) break

          const key = allKeys[i]
          progress.report({
            message: `[${i + 1}/${allKeys.length}] Checking: ${key}`,
            increment: 100 / allKeys.length,
          })

          let isUsed = false
          for (const [, content] of allCodeContent) {
            if (this.isKeyUsedInContent(key, content)) {
              isUsed = true
              break
            }
          }

          if (!isUsed) {
            unusedKeys.push(key)
          }
        }
      },
    )

    return unusedKeys
  }

  async deleteUnusedKeys(): Promise<{ deleted: number; skipped: number }> {
    const unusedKeys = await this.findUnusedKeys()

    if (unusedKeys.length === 0) {
      window.showInformationMessage('No unused keys found!')
      return { deleted: 0, skipped: 0 }
    }

    const selected = await window.showQuickPick(
      unusedKeys.map(k => ({ label: k, description: this.store.getTranslation(this.store.projectConfig.sourceLanguage, k) || '' })),
      { canPickMany: true, placeHolder: `Select keys to delete (${unusedKeys.length} unused keys found)` },
    )

    if (!selected || selected.length === 0) return { deleted: 0, skipped: unusedKeys.length }

    let deleted = 0
    for (const item of selected) {
      await this.deleteKey(item.label)
      deleted++
    }

    return { deleted, skipped: unusedKeys.length - deleted }
  }

  private replaceKeyInText(text: string, oldKey: string, newKey: string, languageId: string): string {
    let result = text

    result = result.replace(new RegExp(this.escapeRegex(`"${oldKey}"`), 'g'), `"${newKey}"`)
    result = result.replace(new RegExp(this.escapeRegex(`'${oldKey}'`), 'g'), `'${newKey}'`)
    result = result.replace(new RegExp(this.escapeRegex(`\`${oldKey}\``), 'g'), `\`${newKey}\``)

    return result
  }

  private isKeyUsedInContent(key: string, content: string): boolean {
    const patterns = [
      `"${key}"`,
      `'${key}'`,
      `\`${key}\``,
    ]

    return patterns.some(p => content.includes(p))
  }

  private async findCodeFilesUsingKey(key: string): Promise<{ filepath: string; occurrences: number }[]> {
    const rootPath = this.store.projectConfig.rootPath
    const fg = require('fast-glob')
    const codeFiles: string[] = await fg('**/*.{go,vue,js,ts,jsx,tsx,html}', {
      cwd: rootPath,
      ignore: ['vendor', 'node_modules', '.git', 'dist', 'build'],
      onlyFiles: true,
      absolute: true,
    })

    const results: { filepath: string; occurrences: number }[] = []

    for (const file of codeFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        if (this.isKeyUsedInContent(key, content)) {
          const occurrences = (content.match(new RegExp(this.escapeRegex(`"${key}"`), 'g')) || []).length
            + (content.match(new RegExp(this.escapeRegex(`'${key}'`), 'g')) || []).length
          results.push({ filepath: file, occurrences })
        }
      } catch { /* skip */ }
    }

    return results
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
