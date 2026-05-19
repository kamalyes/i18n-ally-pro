import { window, ProgressLocation, env, commands } from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, t } from '../i18n'

type IssueType =
  | 'placeholder_mismatch'
  | 'length_inconsistency'
  | 'empty_source'
  | 'identical_to_source'
  | 'html_tag_mismatch'
  | 'icu_mismatch'
  | 'whitespace_mismatch'
  | 'duplicate_value'
  | 'punctuation_mismatch'

interface QualityIssue {
  key: string
  type: IssueType
  message: string
  locale: string
}

const ISSUE_LABELS: Record<IssueType, { icon: string; title: string }> = {
  empty_source: { icon: '🔴', title: 'Empty Source' },
  placeholder_mismatch: { icon: '🟡', title: 'Placeholder Mismatch' },
  icu_mismatch: { icon: '🟡', title: 'ICU/Plural Mismatch' },
  html_tag_mismatch: { icon: '🟠', title: 'HTML Tag Mismatch' },
  identical_to_source: { icon: '🔵', title: 'Identical to Source (Untranslated)' },
  length_inconsistency: { icon: '🟠', title: 'Length Inconsistency' },
  whitespace_mismatch: { icon: '⚪', title: 'Leading/Trailing Whitespace Mismatch' },
  duplicate_value: { icon: '🟣', title: 'Duplicate Value in Same Locale' },
  punctuation_mismatch: { icon: '🟤', title: 'Punctuation Mismatch' },
}

const ISSUE_ORDER: IssueType[] = [
  'empty_source',
  'placeholder_mismatch',
  'icu_mismatch',
  'html_tag_mismatch',
  'identical_to_source',
  'punctuation_mismatch',
  'whitespace_mismatch',
  'length_inconsistency',
  'duplicate_value',
]

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
        title: 'i18n Pro: Quality Check',
        cancellable: true,
      },
      async (progress, token) => {
        const valueLocaleMap = new Map<string, { key: string; locale: string }[]>()

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
          const sourceIcu = this.extractIcuPlurals(sourceValue)
          const sourceHtmlTags = this.extractHtmlTags(sourceValue)
          const sourceTrimmed = sourceValue.trim()
          const sourceStartsSpace = sourceValue !== sourceTrimmed && sourceValue.startsWith(' ')
          const sourceEndsSpace = sourceValue !== sourceTrimmed && sourceValue.endsWith(' ')
          const sourceEndPunctuation = this.extractEndPunctuation(sourceValue)

          for (const locale of locales) {
            if (locale === sourceLocale) continue
            const value = this.store.getTranslation(locale, key)
            if (!value) continue

            // 1. Placeholder mismatch
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

            // 2. ICU/Plural mismatch
            const targetIcu = this.extractIcuPlurals(value)
            if (sourceIcu.length !== targetIcu.length ||
                !sourceIcu.every(p => targetIcu.includes(p))) {
              const missing = sourceIcu.filter(p => !targetIcu.includes(p))
              const extra = targetIcu.filter(p => !sourceIcu.includes(p))
              const parts: string[] = []
              if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
              if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`)
              if (parts.length > 0) {
                issues.push({
                  key,
                  type: 'icu_mismatch',
                  message: `ICU/plural mismatch in ${locale}: ${parts.join('; ')}`,
                  locale,
                })
              }
            }

            // 3. HTML tag mismatch
            const targetHtmlTags = this.extractHtmlTags(value)
            if (!this.arraysMatch(sourceHtmlTags, targetHtmlTags)) {
              const missing = sourceHtmlTags.filter(t => !targetHtmlTags.includes(t))
              const extra = targetHtmlTags.filter(t => !sourceHtmlTags.includes(t))
              const parts: string[] = []
              if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
              if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`)
              issues.push({
                key,
                type: 'html_tag_mismatch',
                message: `HTML tag mismatch in ${locale}: ${parts.join('; ')}`,
                locale,
              })
            }

            // 4. Identical to source (likely untranslated)
            if (value === sourceValue && sourceValue.length > 3) {
              // Skip for CJK-like locales where source is also CJK
              const sourceIsCjk = this.isCjk(sourceValue)
              const targetIsCjkLocale = this.isCjkLocale(locale)
              if (!(sourceIsCjk && targetIsCjkLocale)) {
                issues.push({
                  key,
                  type: 'identical_to_source',
                  message: `Translation in ${locale} is identical to source (possibly untranslated)`,
                  locale,
                })
              }
            }

            // 5. Punctuation mismatch
            const targetEndPunctuation = this.extractEndPunctuation(value)
            if (sourceEndPunctuation !== targetEndPunctuation && sourceValue.length > 1 && value.length > 1) {
              // Only flag if source ends with punctuation but target doesn't, or vice versa
              const sourceHasPunct = /[.!?。！？]$/.test(sourceValue.trim())
              const targetHasPunct = /[.!?。！？]$/.test(value.trim())
              if (sourceHasPunct !== targetHasPunct) {
                issues.push({
                  key,
                  type: 'punctuation_mismatch',
                  message: `Punctuation mismatch in ${locale}: source ends with "${sourceEndPunctuation || '(none)'}", target ends with "${targetEndPunctuation || '(none)'}"`,
                  locale,
                })
              }
            }

            // 6. Leading/trailing whitespace mismatch
            const targetTrimmed = value.trim()
            const targetStartsSpace = value !== targetTrimmed && value.startsWith(' ')
            const targetEndsSpace = value !== targetTrimmed && value.endsWith(' ')
            if (sourceStartsSpace !== targetStartsSpace || sourceEndsSpace !== targetEndsSpace) {
              const parts: string[] = []
              if (sourceStartsSpace !== targetStartsSpace) {
                parts.push(`leading space: source=${sourceStartsSpace}, target=${targetStartsSpace}`)
              }
              if (sourceEndsSpace !== targetEndsSpace) {
                parts.push(`trailing space: source=${sourceEndsSpace}, target=${targetEndsSpace}`)
              }
              issues.push({
                key,
                type: 'whitespace_mismatch',
                message: `Whitespace mismatch in ${locale}: ${parts.join('; ')}`,
                locale,
              })
            }

            // 7. Length inconsistency
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

            // 8. Duplicate value detection (within same locale)
            const dedupeKey = `${locale}::${value}`
            if (!valueLocaleMap.has(dedupeKey)) {
              valueLocaleMap.set(dedupeKey, [])
            }
            valueLocaleMap.get(dedupeKey)!.push({ key, locale })
          }
        }

        // Check for duplicates
        for (const [, entries] of valueLocaleMap) {
          if (entries.length > 1 && entries[0].locale !== sourceLocale) {
            const keys = entries.map(e => e.key)
            const value = this.store.getTranslation(entries[0].locale, entries[0].key) || ''
            // Only flag non-trivial values
            if (value.length > 3) {
              issues.push({
                key: keys.join(', '),
                type: 'duplicate_value',
                message: `Duplicate value in ${entries[0].locale}: "${value.length > 40 ? value.slice(0, 40) + '...' : value}" shared by keys: ${keys.join(', ')}`,
                locale: entries[0].locale,
              })
            }
          }
        }
      },
    )

    return issues
  }

  private extractPlaceholders(text: string): string[] {
    const placeholders: string[] = []

    // Go fmt verbs: %s, %d, %v, etc.
    const goFormat = text.match(/%[vdsficqouxXbeEgG]/g)
    if (goFormat) placeholders.push(...goFormat)

    // Go numbered: %1$s, %2$d
    const numberedFormat = text.match(/%\d+\$[vdsficqouxXbeEgG]/g)
    if (numberedFormat) placeholders.push(...numberedFormat)

    // Go width: %5s, %-10d
    const goWidthFormat = text.match(/%-?\d*[vdsficqouxXbeEgG]/g)
    if (goWidthFormat) placeholders.push(...goWidthFormat.filter(p => !placeholders.includes(p)))

    // Curly braces: {name}, {count}, {0}, etc.
    const curlyBraces = text.match(/\{[\w.]+\}/g)
    if (curlyBraces) placeholders.push(...curlyBraces)

    // Vue i18n linked: @:key
    const vueI18n = text.match(/@:[\w.]+/g)
    if (vueI18n) placeholders.push(...vueI18n)

    // Template literals: ${name}
    const templateLiteral = text.match(/\$\{[\w.]+\}/g)
    if (templateLiteral) placeholders.push(...templateLiteral)

    // Python format: %(name)s
    const pythonFormat = text.match(/%\([\w.]+\)[sdrifFeEgGxXoc]/g)
    if (pythonFormat) placeholders.push(...pythonFormat)

    // Rails/i18n: %{name}
    const railsFormat = text.match(/%\{[\w.]+\}/g)
    if (railsFormat) placeholders.push(...railsFormat)

    return [...new Set(placeholders)]
  }

  private extractIcuPlurals(text: string): string[] {
    const icu: string[] = []
    // {count, plural, one{...} other{...}}
    const pluralMatch = text.match(/\{[\w.]+,\s*plural,\s*[^}]+\}/g)
    if (pluralMatch) icu.push(...pluralMatch)
    // {count, select, ...}
    const selectMatch = text.match(/\{[\w.]+,\s*select,\s*[^}]+\}/g)
    if (selectMatch) icu.push(...selectMatch)
    // {count, selectordinal, ...}
    const selectOrdinalMatch = text.match(/\{[\w.]+,\s*selectordinal,\s*[^}]+\}/g)
    if (selectOrdinalMatch) icu.push(...selectOrdinalMatch)
    return [...new Set(icu)]
  }

  private extractHtmlTags(text: string): string[] {
    const tags = text.match(/<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?\/?>/g)
    return tags ? [...tags] : []
  }

  private extractEndPunctuation(text: string): string {
    const match = text.trim().match(/[.!?;:，。！？；：]+$/)
    return match ? match[0] : ''
  }

  private arraysMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.every((v, i) => v === sortedB[i])
  }

  private isCjk(text: string): boolean {
    return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)
  }

  private isCjkLocale(locale: string): boolean {
    return /^(zh|ja|ko)/.test(locale)
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
    items.push(`i18n Quality Check Report`)
    items.push(`Found ${issues.length} issue(s) across ${grouped.size} key(s)`)
    items.push('')

    for (const type of ISSUE_ORDER) {
      const typeIssues = issues.filter(i => i.type === type)
      if (typeIssues.length === 0) continue

      const label = ISSUE_LABELS[type]
      items.push(`${label.icon} ${label.title} (${typeIssues.length}):`)
      for (const issue of typeIssues.slice(0, 20)) {
        items.push(`   ${getLocaleFlag(issue.locale)} ${issue.key}: ${issue.message}`)
      }
      if (typeIssues.length > 20) items.push(`   ... and ${typeIssues.length - 20} more`)
      items.push('')
    }

    const outputChannel = window.createOutputChannel('i18n Quality Check')
    outputChannel.clear()
    outputChannel.appendLine(items.join('\n'))
    outputChannel.show()
  }

  buildQualityPrompt(): string {
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage
    const locales = this.store.locales
    const allKeys = this.store.getAllKeys()

    const sourceEntries: string[] = []
    const targetEntries: string[] = []
    const diagnostics = this.store.getDiagnostics()

    for (const key of allKeys) {
      const sourceValue = this.store.getTranslation(sourceLocale, key)
      if (!sourceValue) continue
      sourceEntries.push(`  "${key}": "${sourceValue.replace(/"/g, '\\"')}"`)

      for (const locale of locales) {
        if (locale === sourceLocale) continue
        const value = this.store.getTranslation(locale, key)
        if (value === undefined || value === '') continue
        targetEntries.push(`  "${key}" [${locale}]: "${value.replace(/"/g, '\\"')}"`)
      }
    }

    const missingEntries = diagnostics
      .filter(d => d.type === 'missing' || d.type === 'empty')
      .slice(0, 100)
      .map(d => `  - ${d.locale}: ${d.key}`)
      .join('\n')

    return `You are an expert i18n quality assurance reviewer. Perform a thorough quality check on the following translation data.

## Project Info
- Root: ${config.rootPath}
- Source locale: ${sourceLocale}
- Target locales: ${locales.filter(l => l !== sourceLocale).join(', ')}
- Total keys: ${allKeys.length}

## Source Translations (${sourceLocale})
{
${sourceEntries.slice(0, 200).join(',\n')}
${sourceEntries.length > 200 ? `  // ... ${sourceEntries.length - 200} more entries` : ''}
}

## Target Translations
{
${targetEntries.slice(0, 300).join(',\n')}
${targetEntries.length > 300 ? `  // ... ${targetEntries.length - 300} more entries` : ''}
}

## Missing/Empty Translations
${missingEntries || 'None'}

## Quality Check Checklist
Review each translation against ALL of the following criteria:

1. **Placeholder Integrity**: Every interpolation token (%s, %d, {name}, \${var}, %(name)s, %{name}, @:link) in the source MUST appear in the target. No extra or missing placeholders.

2. **ICU/Plural Syntax**: ICU message format ({count, plural, ...}, {gender, select, ...}) must be structurally valid and contain the same categories (one, other, zero, etc.) unless the target language requires different plural rules.

3. **HTML/Markup Tags**: All HTML tags (<b>, <a>, <br/>, etc.) in the source must be preserved in the target with matching open/close tags.

4. **Untranslated Strings**: If a target translation is identical to the source (and the target is not a CJK locale sharing the same script), flag it as likely untranslated.

5. **Punctuation Consistency**: If the source ends with punctuation (., !, ?, 。, ！, ？), the target should also end with appropriate punctuation for its language.

6. **Whitespace Consistency**: Leading/trailing whitespace in the source should match the target. Extra or missing spaces can break UI layouts.

7. **Length Sanity**: Target translations that are more than 5x longer or shorter than the source may indicate a problem (wrong translation, partial translation, or copy-paste error).

8. **Duplicate Values**: If multiple keys in the same locale have identical non-trivial values, flag them as potential copy-paste errors.

9. **Contextual Accuracy**: Where you can infer the context, check that the translation is semantically correct and culturally appropriate for the target locale.

10. **Key Completeness**: Report any keys present in the source locale but missing from target locales.

## Output Format
For each issue found, output:
- **Severity**: CRITICAL (breaks functionality), WARNING (quality issue), INFO (suggestion)
- **Key**: The i18n key
- **Locale**: The target locale
- **Issue Type**: One of the checklist categories above
- **Description**: What's wrong
- **Suggested Fix**: The corrected translation (if applicable)

End with a summary: total issues by severity and type.`
  }

  async copyQualityPromptToClipboard() {
    const prompt = this.buildQualityPrompt()
    await env.clipboard.writeText(prompt)
    window.showInformationMessage('i18n quality check prompt copied to clipboard. Paste it into your AI assistant.')
  }

  async openQualityPromptInCopilot() {
    const prompt = this.buildQualityPrompt()

    const attempts: Array<() => Thenable<unknown>> = [
      () => commands.executeCommand('workbench.action.chat.open', { query: prompt }),
      () => commands.executeCommand('workbench.action.chat.open', prompt),
      () => commands.executeCommand('github.copilot.openChat'),
      () => commands.executeCommand('workbench.action.chat.open'),
    ]

    for (const attempt of attempts) {
      try {
        await attempt()
        await env.clipboard.writeText(prompt)
        window.showInformationMessage('i18n quality check prompt opened in Copilot Chat.')
        return
      } catch {
        continue
      }
    }

    await env.clipboard.writeText(prompt)
    window.showInformationMessage('i18n quality check prompt copied to clipboard.')
  }
}
