import { window, workspace, WorkspaceEdit, Range, Uri, ProgressLocation } from 'vscode'
import fs from 'fs'
import { TranslationStore, TranslationEdit } from '../core/store'
import { getIgnoreDirs } from '../core/constants'

const CODE_GLOB = '**/*.{go,vue,js,ts,jsx,tsx,html}'

/** 代码里成对引号包起来的完整字面量；i18n key 的引用形态就是这个 */
const QUOTED_LITERAL = /(['"`])((?:[^'"`\\\n]){2,256})\1/g

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

    // 整条重命名一次写盘：原来每个语言都要 set + delete 两次全文件 dump
    const edits: TranslationEdit[] = []
    for (const locale of this.store.locales) {
      const value = this.store.getTranslation(locale, oldKey)
      if (value !== undefined) {
        edits.push({ locale, key: newKey, value })
        edits.push({ locale, key: oldKey, value: undefined })
        files++
        replacements++
      }
    }
    await this.store.setTranslations(edits)

    const codeFiles = await this.findCodeFilesUsingKey(oldKey)
    const edit = new WorkspaceEdit()

    for (const fileResult of codeFiles) {
      const doc = await workspace.openTextDocument(Uri.file(fileResult.filepath))
      const text = doc.getText()

      const newContent = this.replaceKeyInText(text, oldKey, newKey)
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

  /**
   * 删除一个 key（所有语言）。
   * confirm=false 时不再弹确认框 —— 批量删除的调用方已经整批确认过一次，
   * 否则删 50 个 key 会连弹 50 个模态框。
   */
  async deleteKey(key: string, options: { confirm?: boolean } = {}): Promise<{ files: number }> {
    const { confirm = true } = options

    if (confirm) {
      const answer = await window.showWarningMessage(
        `Delete key "${key}" from ALL locales and code references?`,
        { modal: true },
        'Delete',
      )
      if (answer !== 'Delete') return { files: 0 }
    }

    const edits: TranslationEdit[] = []
    for (const locale of this.store.locales) {
      if (this.store.getTranslation(locale, key) !== undefined)
        edits.push({ locale, key, value: undefined })
    }

    await this.store.setTranslations(edits)
    return { files: edits.length }
  }

  /** 批量删除：整批只写一次盘、只触发一次刷新 */
  async deleteKeys(keys: readonly string[]): Promise<{ deleted: number }> {
    const edits: TranslationEdit[] = []
    for (const key of keys) {
      for (const locale of this.store.locales) {
        if (this.store.getTranslation(locale, key) !== undefined)
          edits.push({ locale, key, value: undefined })
      }
    }

    await this.store.setTranslations(edits)
    return { deleted: keys.length }
  }

  async findUnusedKeys(): Promise<string[]> {
    const allKeys = this.store.getAllKeys()
    let unusedKeys: string[] = []

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Finding unused keys',
        cancellable: true,
      },
      async (progress, token) => {
        const codeFiles = await this.listCodeFiles()

        // 单遍扫描收集代码里出现过的字符串字面量，再用集合求差。
        // 原来是「每个 key × 每个文件」做一次 includes，key 和文件一多就是分钟级。
        const usedLiterals = new Set<string>()
        for (let i = 0; i < codeFiles.length; i++) {
          if (token.isCancellationRequested) return

          if (i % 50 === 0) {
            progress.report({
              message: `[${i + 1}/${codeFiles.length}] Scanning code files`,
              increment: (50 / codeFiles.length) * 100,
            })
          }

          try {
            const content = fs.readFileSync(codeFiles[i], 'utf-8')
            QUOTED_LITERAL.lastIndex = 0
            let match: RegExpExecArray | null
            while ((match = QUOTED_LITERAL.exec(content)) !== null)
              usedLiterals.add(match[2])
          } catch { /* skip */ }
        }

        unusedKeys = allKeys.filter(key => !usedLiterals.has(key))
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

    const confirm = await window.showWarningMessage(
      `Delete ${selected.length} unused key(s) from ALL locales?`,
      { modal: true },
      'Delete',
    )
    if (confirm !== 'Delete') return { deleted: 0, skipped: unusedKeys.length }

    const { deleted } = await this.deleteKeys(selected.map(item => item.label))
    return { deleted, skipped: unusedKeys.length - deleted }
  }

  private replaceKeyInText(text: string, oldKey: string, newKey: string): string {
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

  private async listCodeFiles(): Promise<string[]> {
    const fg = require('fast-glob')
    return fg(CODE_GLOB, {
      cwd: this.store.projectConfig.rootPath,
      ignore: getIgnoreDirs(),
      onlyFiles: true,
      absolute: true,
    })
  }

  private async findCodeFilesUsingKey(key: string): Promise<{ filepath: string; occurrences: number }[]> {
    const codeFiles = await this.listCodeFiles()
    const results: { filepath: string; occurrences: number }[] = []

    const doubleQuoted = new RegExp(this.escapeRegex(`"${key}"`), 'g')
    const singleQuoted = new RegExp(this.escapeRegex(`'${key}'`), 'g')

    for (const file of codeFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        if (this.isKeyUsedInContent(key, content)) {
          const occurrences = (content.match(doubleQuoted) || []).length
            + (content.match(singleQuoted) || []).length
          results.push({ filepath: file, occurrences })
        }
      } catch { /* skip */ }
    }

    return results
  }

  private escapeRegex(s: string): string {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
