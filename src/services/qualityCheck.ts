import { window, ProgressLocation } from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, t } from '../i18n'

interface QualityIssue {
  key: string
  type: 'placeholder_mismatch' | 'length_inconsistency' | 'empty_source'
  message: string
  locale: string
}

export class QualityCheckService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  async checkQuality(): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = []
    const allKeys = this.store.getAllKeys()
    const locales = this.store.locales
    const sourceLocale = this.store.projectConfig.sourceLanguage

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: '🔍 i18n Pro: Quality Check',
        cancellable: true,
      },
      async (progress, token) => {
        for (let i = 0; i < allKeys.length; i++) {
          if (token.isCancellationRequested) break

          const key = allKeys[i]
          progress.report({
            message: `[${i + 1}/${allKeys.length}] Checking: ${key}`,
            increment: 100 / allKeys.length,
          })

          const sourceValue = this.store.getTranslation(sourceLocale, key)
          if (!sourceValue) {
            issues.push({
              key,
              type: 'empty_source',
              message: `Source value is empty in ${sourceLocale}`,
              locale: sourceLocale,
            })
            continue
          }

          const sourcePlaceholders = this.extractPlaceholders(sourceValue)

          for (const locale of locales) {
            if (locale === sourceLocale) continue
            const value = this.store.getTranslation(locale, key)
            if (!value) continue

            const targetPlaceholders = this.extractPlaceholders(value)
            if (sourcePlaceholders.length !== targetPlaceholders.length ||
                !sourcePlaceholders.every(p => targetPlaceholders.includes(p))) {
              const missing = sourcePlaceholders.filter(p => !targetPlaceholders.includes(p))
              const extra = targetPlaceholders.filter(p => !sourcePlaceholders.includes(p))
              const parts: string[] = []
              if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
              if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`)
              issues.push({
                key,
                type: 'placeholder_mismatch',
                message: `Placeholder mismatch in ${locale}: ${parts.join('; ')}`,
                locale,
              })
            }

            if (sourceValue.length > 0 && value.length > 0) {
              const ratio = value.length / sourceValue.length
              if (ratio > 5 || ratio < 0.2) {
                issues.push({
                  key,
                  type: 'length_inconsistency',
                  message: `Length inconsistency in ${locale}: source=${sourceValue.length} chars, target=${value.length} chars (ratio: ${ratio.toFixed(1)}x)`,
                  locale,
                })
              }
            }
          }
        }
      },
    )

    return issues
  }

  private extractPlaceholders(text: string): string[] {
    const placeholders: string[] = []

    const goFormat = text.match(/%[vdsficqouxXbeEgG]/g)
    if (goFormat) placeholders.push(...goFormat)

    const numberedFormat = text.match(/%\d+\$[vdsficqouxXbeEgG]/g)
    if (numberedFormat) placeholders.push(...numberedFormat)

    const curlyBraces = text.match(/\{[\w.]+\}/g)
    if (curlyBraces) placeholders.push(...curlyBraces)

    const vueI18n = text.match(/@:\w+/g)
    if (vueI18n) placeholders.push(...vueI18n)

    const templateLiteral = text.match(/\$\{[\w.]+\}/g)
    if (templateLiteral) placeholders.push(...templateLiteral)

    return [...new Set(placeholders)]
  }

  async showQualityReport() {
    const issues = await this.checkQuality()

    if (issues.length === 0) {
      window.showInformationMessage(t('quality.all_good'))
      return
    }

    const grouped = new Map<string, QualityIssue[]>()
    for (const issue of issues) {
      if (!grouped.has(issue.key)) grouped.set(issue.key, [])
      grouped.get(issue.key)!.push(issue)
    }

    const items: string[] = []
    items.push(`🔍 i18n Quality Check Report`)
    items.push(`Found ${issues.length} issue(s) across ${grouped.size} key(s)`)
    items.push('')

    const placeholderIssues = issues.filter(i => i.type === 'placeholder_mismatch')
    const lengthIssues = issues.filter(i => i.type === 'length_inconsistency')
    const emptyIssues = issues.filter(i => i.type === 'empty_source')

    if (emptyIssues.length > 0) {
      items.push(`🔴 Empty Source (${emptyIssues.length}):`)
      for (const issue of emptyIssues.slice(0, 20)) {
        items.push(`   ${issue.key}`)
      }
      if (emptyIssues.length > 20) items.push(`   ... and ${emptyIssues.length - 20} more`)
      items.push('')
    }

    if (placeholderIssues.length > 0) {
      items.push(`🟡 Placeholder Mismatch (${placeholderIssues.length}):`)
      for (const issue of placeholderIssues.slice(0, 20)) {
        items.push(`   ${getLocaleFlag(issue.locale)} ${issue.key}: ${issue.message}`)
      }
      if (placeholderIssues.length > 20) items.push(`   ... and ${placeholderIssues.length - 20} more`)
      items.push('')
    }

    if (lengthIssues.length > 0) {
      items.push(`🟠 Length Inconsistency (${lengthIssues.length}):`)
      for (const issue of lengthIssues.slice(0, 20)) {
        items.push(`   ${getLocaleFlag(issue.locale)} ${issue.key}: ${issue.message}`)
      }
      if (lengthIssues.length > 20) items.push(`   ... and ${lengthIssues.length - 20} more`)
      items.push('')
    }

    const outputChannel = window.createOutputChannel('i18n Quality Check')
    outputChannel.clear()
    outputChannel.appendLine(items.join('\n'))
    outputChannel.show()
  }
}
