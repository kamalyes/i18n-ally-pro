import { window, workspace, Uri, ProgressLocation, Position, Range, Selection, ViewColumn } from 'vscode'
import fs from 'fs'
import path from 'path'
import { TranslationStore } from '../core/store'

const GO_CONST_PATTERN = /(\w+)\s*=\s*"([\w.]+)"/g

export interface IntegrityResult {
  goOnlyKeys: string[]
  jsonOnlyKeys: string[]
  mismatchedKeys: { constName: string; keyValue: string; expectedKey: string }[]
  totalGoConsts: number
  totalJsonKeys: number
  localeCoverage: { locale: string; total: number; covered: number; pct: number }[]
}

export class ErrorCodeSyncService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async syncFromGoFile(goFilePath: string): Promise<{ added: number; skipped: number; errors: number }> {
    let added = 0
    let skipped = 0
    let errors = 0

    const content = fs.readFileSync(goFilePath, 'utf-8')
    const constMap = this.parseGoConsts(content)

    if (constMap.size === 0) {
      window.showWarningMessage('No i18n constants found in this Go file')
      return { added: 0, skipped: 0, errors: 0 }
    }

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Syncing error codes',
        cancellable: true,
      },
      async (progress) => {
        let current = 0
        const total = constMap.size * this.store.locales.length

        for (const [constName, keyValue] of constMap) {
          for (const locale of this.store.locales) {
            current++
            progress.report({
              message: `[${current}/${total}] ${constName} → ${locale}`,
              increment: 100 / total,
            })

            const existing = this.store.getTranslation(locale, keyValue)
            if (existing !== undefined && existing !== '') {
              skipped++
              continue
            }

            try {
              await this.store.setTranslation(locale, keyValue, '')
              added++
            }
            catch {
              errors++
            }
          }
        }
      },
    )

    return { added, skipped, errors }
  }

  async syncAllGoFiles(): Promise<{ added: number; skipped: number; errors: number; files: number }> {
    const rootPath = this.store.projectConfig.rootPath
    const goFiles = await this.findGoFilesWithI18n(rootPath)

    let totalAdded = 0
    let totalSkipped = 0
    let totalErrors = 0

    for (const file of goFiles) {
      const result = await this.syncFromGoFile(file)
      totalAdded += result.added
      totalSkipped += result.skipped
      totalErrors += result.errors
    }

    return { added: totalAdded, skipped: totalSkipped, errors: totalErrors, files: goFiles.length }
  }

  parseGoConsts(content: string): Map<string, string> {
    const result = new Map<string, string>()
    let match: RegExpExecArray | null

    const pattern = new RegExp(GO_CONST_PATTERN.source, 'g')
    while ((match = pattern.exec(content)) !== null) {
      const constName = match[1]
      const keyValue = match[2]

      if (!keyValue.includes('.') || keyValue.length < 3) continue
      if (this.isGoKeyword(constName)) continue

      result.set(constName, keyValue)
    }

    return result
  }

  async addNewErrorCode(constName: string, keyValue: string, zhDescription: string): Promise<boolean> {
    const rootPath = this.store.projectConfig.rootPath

    const goFile = await this.findOrCreateCodesGo(rootPath)
    if (!goFile) {
      window.showErrorMessage('Cannot find errors/codes.go in project')
      return false
    }

    const content = fs.readFileSync(goFile, 'utf-8')
    const constMap = this.parseGoConsts(content)

    if (constMap.has(constName)) {
      window.showWarningMessage(`Constant ${constName} already exists`)
      return false
    }

    const newConst = `\t${constName} = "${keyValue}"\n`

    const lastConstMatch = [...content.matchAll(/(\w+)\s*=\s*"([\w.]+)"/g)]
    if (lastConstMatch.length > 0) {
      const lastMatch = lastConstMatch[lastConstMatch.length - 1]
      const insertPos = lastMatch.index! + lastMatch[0].length
      const newContent = content.slice(0, insertPos) + '\n' + newConst + content.slice(insertPos)
      fs.writeFileSync(goFile, newContent, 'utf-8')
    }
    else {
      const constBlockMatch = content.match(/const\s*\(/)
      if (constBlockMatch) {
        const insertPos = constBlockMatch.index! + constBlockMatch[0].length
        const newContent = content.slice(0, insertPos) + '\n' + newConst + content.slice(insertPos)
        fs.writeFileSync(goFile, newContent, 'utf-8')
      }
    }

    await this.store.setTranslation('zh', keyValue, zhDescription)

    for (const locale of this.store.locales) {
      if (locale === 'zh') continue
      await this.store.setTranslation(locale, keyValue, '')
    }

    return true
  }

  async checkIntegrity(): Promise<IntegrityResult> {
    const rootPath = this.store.projectConfig.rootPath
    const goFile = await this.findOrCreateCodesGo(rootPath)

    const goConstKeys = new Map<string, string>()
    if (goFile) {
      const content = fs.readFileSync(goFile, 'utf-8')
      const constMap = this.parseGoConsts(content)
      for (const [constName, keyValue] of constMap) {
        goConstKeys.set(keyValue, constName)
      }
    }

    const allJsonKeys = new Set(this.store.getAllKeys())

    const goOnlyKeys: string[] = []
    const jsonOnlyKeys: string[] = []

    for (const [keyValue, constName] of goConstKeys) {
      if (!allJsonKeys.has(keyValue)) {
        goOnlyKeys.push(`${constName} = "${keyValue}"`)
      }
    }

    for (const key of allJsonKeys) {
      if (!goConstKeys.has(key)) {
        jsonOnlyKeys.push(key)
      }
    }

    const localeCoverage = this.store.locales.map(locale => {
      const keys = this.store.getKeysForLocale(locale)
      const covered = keys.filter(k => {
        const v = this.store.getTranslation(locale, k)
        return v !== undefined && v !== ''
      }).length
      const total = goConstKeys.size
      return {
        locale,
        total,
        covered,
        pct: total > 0 ? Math.round(covered / total * 100) : 0,
      }
    })

    return {
      goOnlyKeys,
      jsonOnlyKeys,
      mismatchedKeys: [],
      totalGoConsts: goConstKeys.size,
      totalJsonKeys: allJsonKeys.size,
      localeCoverage,
    }
  }

  async goToGoConst(keyValue: string): Promise<boolean> {
    const rootPath = this.store.projectConfig.rootPath
    const goFile = await this.findOrCreateCodesGo(rootPath)
    if (!goFile) return false

    const content = fs.readFileSync(goFile, 'utf-8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`"${keyValue}"`)) {
        const doc = await workspace.openTextDocument(Uri.file(goFile))
        const editor = await window.showTextDocument(doc, ViewColumn.One)
        const position = new Position(i, 0)
        editor.selection = new Selection(position, position)
        editor.revealRange(new Range(position, position))
        return true
      }
    }

    return false
  }

  async goToJsonKey(keyValue: string, locale: string): Promise<boolean> {
    const file = this.store.findFileForKey(keyValue, locale)
    if (!file) return false

    const pos = this.store.findKeyPosition(file.filepath, keyValue)
    const doc = await workspace.openTextDocument(Uri.file(file.filepath))
    const editor = await window.showTextDocument(doc, ViewColumn.One)

    if (pos) {
      const position = new Position(pos.line, pos.column)
      editor.selection = new Selection(position, position)
      editor.revealRange(new Range(position, position))
    }

    return true
  }

  async batchAddErrorCodes(entries: { constName: string; keyValue: string; zhDescription: string }[]): Promise<{ added: number; skipped: number; errors: number }> {
    let added = 0
    let skipped = 0
    let errors = 0

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Batch adding error codes',
        cancellable: true,
      },
      async (progress) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]
          progress.report({
            message: `[${i + 1}/${entries.length}] ${entry.constName}`,
            increment: 100 / entries.length,
          })

          try {
            const success = await this.addNewErrorCode(entry.constName, entry.keyValue, entry.zhDescription)
            if (success) added++
            else skipped++
          }
          catch {
            errors++
          }
        }
      },
    )

    return { added, skipped, errors }
  }

  async addErrorCodeWizard(): Promise<boolean> {
    const constName = await window.showInputBox({
      prompt: 'Go constant name (e.g. BizErrCodeUserNotFound)',
      placeHolder: 'BizErrCodeXxx',
      validateInput: (v) => {
        if (!v) return 'Name cannot be empty'
        if (!/^BizErrCode[A-Z]/.test(v)) return 'Must start with BizErrCode and PascalCase'
        return null
      },
    })
    if (!constName) return false

    const keyValue = await window.showInputBox({
      prompt: 'i18n key value (e.g. error.user.not_found)',
      placeHolder: 'error.xxx.yyy',
      value: this.constNameToKey(constName),
      validateInput: (v) => {
        if (!v) return 'Key cannot be empty'
        if (!v.includes('.')) return 'Key must contain at least one dot'
        return null
      },
    })
    if (!keyValue) return false

    const zhDescription = await window.showInputBox({
      prompt: 'Chinese description (will be set as zh translation)',
      placeHolder: '用户未找到',
    })
    if (!zhDescription) return false

    const shouldTranslate = await window.showQuickPick(
      ['Yes, auto-translate to all locales', 'No, leave empty for manual fill'],
      { placeHolder: 'Auto-translate to other locales?' },
    )

    const success = await this.addNewErrorCode(constName, keyValue, zhDescription)
    if (!success) return false

    if (shouldTranslate === 'Yes, auto-translate to all locales') {
      const { TranslatorService } = await import('./translator')
      const translator = new TranslatorService(this.store)
      const config = this.store.projectConfig
      const targetLocales = this.store.locales.filter(l => l !== 'zh')

      for (const locale of targetLocales) {
        try {
          const result = await translator.translateText(zhDescription, 'zh', locale)
          if (result) {
            await this.store.setTranslation(locale, keyValue, result)
          }
        } catch (err: any) {
          console.error(`Translation failed for ${keyValue} → ${locale}:`, err)
        }
      }
    }

    window.showInformationMessage(`✅ Added: ${constName} = "${keyValue}" → zh: "${zhDescription}"`)
    return true
  }

  private constNameToKey(constName: string): string {
    let key = constName.replace(/^BizErrCode/, '')
    key = key.replace(/([A-Z])/g, '.$1').toLowerCase().slice(1)
    return 'error.' + key
  }

  private async findGoFilesWithI18n(rootPath: string): Promise<string[]> {
    const fg = require('fast-glob')
    const files: string[] = await fg('**/*.go', {
      cwd: rootPath,
      ignore: ['vendor', 'node_modules', '.git'],
      onlyFiles: true,
      absolute: true,
    })

    return files.filter(f => {
      try {
        const content = fs.readFileSync(f, 'utf-8')
        return /(\w+)\s*=\s*"[\w.]+\.[\w.]+"/.test(content)
      }
      catch { return false }
    })
  }

  private async findOrCreateCodesGo(rootPath: string): Promise<string | null> {
    const candidates = [
      path.join(rootPath, 'errors', 'codes.go'),
      path.join(rootPath, 'errcodes', 'codes.go'),
      path.join(rootPath, 'constants', 'codes.go'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate))
        return candidate
    }

    const fg = require('fast-glob')
    const files: string[] = await fg('**/codes.go', {
      cwd: rootPath,
      ignore: ['vendor', 'node_modules'],
      onlyFiles: true,
      absolute: true,
    })

    return files.length > 0 ? files[0] : null
  }

  private isGoKeyword(name: string): boolean {
    const keywords = ['type', 'func', 'var', 'const', 'struct', 'interface', 'package', 'import', 'return', 'defer', 'go', 'range', 'for', 'if', 'else', 'switch', 'case', 'break', 'continue', 'select']
    return keywords.includes(name.toLowerCase())
  }
}
