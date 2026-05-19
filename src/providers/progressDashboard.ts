import { window, ViewColumn, commands, env, ProgressLocation } from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, getLocaleName, getLocaleFlagCssClass, t } from '../i18n'
import { buildCloneLocaleData, getCloneDialogCss, getCloneDialogHtml, getCloneDialogJs } from './cloneDialog'
import type { TranslatorService } from '../services/translator'
import type { KeyDependencyGraph, KeyDependencyService, KeyReference } from '../services/keyDependency'

interface DependencyDashboardData {
  graph: KeyDependencyGraph
  totalKeys: number
  referencedKeys: string[]
  unreferencedKeys: string[]
  codeOnlyKeys: string[]
  codeOnlyItems: { key: string; count: number; refs: KeyReference[] }[]
  topReferenced: { key: string; count: number; value: string; refs: KeyReference[] }[]
  topUnreferenced: { key: string; value: string }[]
}

export class ProgressDashboard {
  private store: TranslationStore
  private translatorService: TranslatorService | null
  private dependencyService: KeyDependencyService | null
  private dependencyData: DependencyDashboardData | null = null
  private dependencyLoading = false
  private dependencyError = ''
  private panel: import('vscode').WebviewPanel | null = null
  private onRefresh: (() => void) | null = null

  constructor(
    store: TranslationStore,
    translatorService?: TranslatorService,
    dependencyServiceOrRefresh?: KeyDependencyService | (() => void),
    onRefresh?: () => void,
  ) {
    this.store = store
    this.translatorService = translatorService || null
    if (typeof dependencyServiceOrRefresh === 'function') {
      this.dependencyService = null
      this.onRefresh = dependencyServiceOrRefresh
    } else {
      this.dependencyService = dependencyServiceOrRefresh || null
      this.onRefresh = onRefresh || null
    }
  }

  show() {
    if (this.panel) {
      this.panel.reveal()
      this.update()
      this.ensureDependenciesScanned()
      return
    }

    this.panel = window.createWebviewPanel(
      'i18nAllyPro.dashboard',
      'i18n Progress Dashboard',
      ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.onDidDispose(() => { this.panel = null })
    this.panel.webview.onDidReceiveMessage(async (msg: {
      type: string
      category?: string
      key?: string
      sourceLocale?: string
      targetLocale?: string
      overwrite?: boolean
      target?: 'codex' | 'copilot'
    }) => {
      if (msg.type === 'refresh') {
        try {
          await this.store.refresh()
          this.dependencyData = null
          this.update()
          this.ensureDependenciesScanned()
          if (this.onRefresh) this.onRefresh()
          window.showInformationMessage(t('dashboard.refreshed'))
        } catch (err: any) {
          window.showErrorMessage(t('dashboard.refresh_failed', err.message))
        }
      }
      if (msg.type === 'formatAll') {
        try {
          const result = await this.store.formatAllFiles('nested')
          this.update()
          if (this.onRefresh) this.onRefresh()
          if (result.errors.length > 0) {
            window.showWarningMessage(`Formatted ${result.formatted} file(s), ${result.errors.length} failed`)
          } else {
            window.showInformationMessage(`Formatted ${result.formatted} file(s), ${result.unchanged} unchanged`)
          }
          this.panel?.webview.postMessage({
            type: 'formatDone',
            formatted: result.formatted,
            unchanged: result.unchanged,
            errors: result.errors.length,
          })
        } catch (err: any) {
          window.showErrorMessage(`Format failed - ${err.message}`)
          this.panel?.webview.postMessage({ type: 'formatDone', error: true })
        }
      }
      if (msg.type === 'autoTranslate') {
        try {
          await commands.executeCommand('i18nAllyPro.autoTranslate')
          await this.store.refresh()
          this.update()
          if (this.onRefresh) this.onRefresh()
          this.panel?.webview.postMessage({ type: 'translateDone' })
        } catch (err: any) {
          window.showErrorMessage(t('dashboard.auto_translate_failed', err.message))
          this.panel?.webview.postMessage({ type: 'translateDone', error: true })
        }
      }
      if (msg.type === 'openAIPrompt') {
        await this.openAIPrompt(msg.target || 'codex')
      }
      if (msg.type === 'scanDependencies') {
        await this.scanDependencies(true)
      }
      if (msg.type === 'cloneLocale' && msg.sourceLocale && msg.targetLocale) {
        try {
          const result = await this.store.cloneLocale(msg.sourceLocale, msg.targetLocale, msg.overwrite || false)
          await this.store.refresh()
          this.update()
          if (this.onRefresh) this.onRefresh()
          window.showInformationMessage(
            t('dashboard.clone_result', msg.sourceLocale, msg.targetLocale, String(result.cloned), String(result.skipped))
          )
          this.panel?.webview.postMessage({ type: 'cloneDone', cloned: result.cloned, skipped: result.skipped })
          if (this.translatorService && msg.sourceLocale !== msg.targetLocale) {
            const translateResult = await this.translatorService.translateLocale(msg.sourceLocale, msg.targetLocale, msg.overwrite || false)
            await this.store.refresh()
            this.update()
            if (this.onRefresh) this.onRefresh()
            window.showInformationMessage(
              `🌐 Translated ${msg.sourceLocale} → ${msg.targetLocale}: ${translateResult.translated} keys translated`
            )
            this.panel?.webview.postMessage({ type: 'translateDone' })
          }
        } catch (err: any) {
          window.showErrorMessage(t('dashboard.clone_failed', err.message))
          this.panel?.webview.postMessage({ type: 'cloneDone', error: true })
        }
      }
      if (msg.type === 'openCategory' && msg.category) {
        const keys = this.store.getAllKeys().filter(k => {
          const parts = k.split('.')
          const cat = parts.length >= 2 ? parts.slice(0, 2).join('.') : parts[0]
          return cat === msg.category
        })
        if (keys.length > 0) {
          const key = keys[0]
          await commands.executeCommand('i18nAllyPro.openKeyAndFile', key)
        }
      }
      if (msg.type === 'openKey' && msg.key) {
        await commands.executeCommand('i18nAllyPro.openKeyAndFile', msg.key)
      }
    })

    this.update()
    this.ensureDependenciesScanned()
  }

  refresh() {
    this.dependencyData = null
    this.update()
    this.ensureDependenciesScanned()
  }

  async showDependencies() {
    this.show()
    await this.scanDependencies(true)
  }

  private ensureDependenciesScanned() {
    void this.scanDependencies(false)
  }

  private async scanDependencies(force = false) {
    if (this.dependencyLoading) return
    if (!force && this.dependencyData) return

    if (!this.dependencyService) {
      window.showWarningMessage('i18n dependency scanner is not initialized')
      this.panel?.webview.postMessage({ type: 'dependencyDone', error: true })
      return
    }

    this.dependencyLoading = true
    this.dependencyError = ''
    this.update()

    try {
      const graph = await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: 'i18n Pro: Scanning key dependencies...',
          cancellable: false,
        },
        async () => this.dependencyService!.buildDependencyGraph(),
      )

      this.dependencyData = this.buildDependencyData(graph)
      window.showInformationMessage(
        `Dependency scan complete: ${this.dependencyData.referencedKeys.length} referenced, ${this.dependencyData.unreferencedKeys.length} unreferenced`,
      )
    } catch (err: any) {
      this.dependencyError = err?.message || String(err)
      window.showErrorMessage(`Dependency scan failed - ${this.dependencyError}`)
    } finally {
      this.dependencyLoading = false
      this.update()
      this.panel?.webview.postMessage({ type: 'dependencyDone', error: !!this.dependencyError })
    }
  }

  private buildDependencyData(graph: KeyDependencyGraph): DependencyDashboardData {
    const allKeys = this.store.getAllKeys().sort()
    const allKeySet = new Set(allKeys)
    const graphKeys = Object.keys(graph).sort()
    const referencedKeys = graphKeys.filter(key => allKeySet.has(key))
    const referencedSet = new Set(referencedKeys)
    const unreferencedKeys = allKeys.filter(key => !referencedSet.has(key))
    const codeOnlyKeys = graphKeys.filter(key => !allKeySet.has(key))

    const codeOnlyItems = codeOnlyKeys
      .map(key => ({
        key,
        count: graph[key]?.length || 0,
        refs: graph[key] || [],
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

    const topReferenced = referencedKeys
      .map(key => ({
        key,
        count: graph[key]?.length || 0,
        refs: graph[key] || [],
        value: this.store.getTranslation(this.store.projectConfig.sourceLanguage, key) || '',
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, 12)

    const topUnreferenced = unreferencedKeys
      .slice(0, 30)
      .map(key => ({
        key,
        value: this.store.getTranslation(this.store.projectConfig.sourceLanguage, key) || '',
      }))

    return {
      graph,
      totalKeys: allKeys.length,
      referencedKeys,
      unreferencedKeys,
      codeOnlyKeys,
      codeOnlyItems,
      topReferenced,
      topUnreferenced,
    }
  }

  private async openAIPrompt(target: 'codex' | 'copilot') {
    const prompt = this.buildDashboardPrompt(target)
    await env.clipboard.writeText(prompt)

    if (target === 'codex') {
      const opened = await this.openCodexTarget()
      if (opened) {
        window.showInformationMessage('i18n AI prompt copied. Codex is open; paste it into the composer to run.')
      } else {
        window.showWarningMessage('i18n AI prompt copied, but Codex extension command was not found.')
      }
      return
    }

    if (await this.openCopilotTarget(prompt)) {
      window.showInformationMessage('i18n AI prompt copied and opened Copilot/Chat')
    } else {
      window.showInformationMessage('i18n AI prompt copied to clipboard')
    }
  }

  private async openCodexTarget(): Promise<boolean> {
    const available = new Set(await commands.getCommands(true))

    // Try Codex / ChatGPT extension commands
    const codexCommands = [
      'chatgpt.newCodexPanel',
      'chatgpt.newChat',
      'chatgpt.openSidebar',
    ]

    for (const cmd of codexCommands) {
      if (available.has(cmd)) {
        try {
          await commands.executeCommand(cmd)
          return true
        } catch {
          // continue trying
        }
      }
    }

    // Fallback: open VS Code's built-in chat (Copilot) as a generic AI target
    if (available.has('workbench.action.chat.open')) {
      try {
        await commands.executeCommand('workbench.action.chat.open')
        return true
      } catch {
        // ignore
      }
    }

    return false
  }

  private async openCopilotTarget(prompt: string): Promise<boolean> {
    const available = new Set(await commands.getCommands(true))

    // Preferred: open chat with query pre-filled
    if (available.has('workbench.action.chat.open')) {
      try {
        await commands.executeCommand('workbench.action.chat.open', { query: prompt })
        return true
      } catch {
        // fallback: try without query object
      }
      try {
        await commands.executeCommand('workbench.action.chat.open', prompt)
        return true
      } catch {
        // fallback: just open chat
      }
      try {
        await commands.executeCommand('workbench.action.chat.open')
        return true
      } catch {
        // ignore
      }
    }

    // Older Copilot Chat extension command
    if (available.has('github.copilot.openChat')) {
      try {
        await commands.executeCommand('github.copilot.openChat')
        return true
      } catch {
        // ignore
      }
    }

    return false
  }

  private buildDashboardPrompt(target: 'codex' | 'copilot'): string {
    const config = this.store.projectConfig
    const locales = this.store.locales
    const allKeys = this.store.getAllKeys().sort()
    const diagnostics = this.store.getDiagnostics().filter(d => d.type === 'missing' || d.type === 'empty')
    const missingRows = diagnostics.slice(0, 200).map(d => {
      const sourceValue = this.store.getTranslation(config.sourceLanguage, d.key) || ''
      return `- ${d.type}: ${d.key} -> ${d.locale || '(unknown locale)'} | source(${config.sourceLanguage}): ${sourceValue || '(empty)'}`
    })

    const localeSummaries = locales.map(locale => {
      const filled = allKeys.filter(key => {
        const value = this.store.getTranslation(locale, key)
        return value !== undefined && value !== ''
      }).length
      const pct = allKeys.length > 0 ? Math.round(filled / allKeys.length * 100) : 100
      return `- ${locale}: ${filled}/${allKeys.length} (${pct}%)`
    })

    const fileSummaries = this.store.getTranslationFiles()
      .map(file => `- ${file.locale}: ${file.filepath} (${file.parser})`)
    const dependencySummary = this.buildDependencyPromptBlock()

    const extraCount = diagnostics.length > missingRows.length
      ? `\n\nThere are ${diagnostics.length - missingRows.length} additional missing/empty entries not listed here. Inspect the locale files before editing.`
      : ''

    const assistantName = target === 'codex' ? 'Codex' : 'Copilot'

    return `You are ${assistantName} working inside this VS Code workspace. Please complete the i18n translations shown by the i18n Ally Pro dashboard.

Project root:
${config.rootPath}

Source locale:
${config.sourceLanguage}

Locales:
${locales.join(', ')}

Locale files:
${fileSummaries.join('\n') || '- No locale files detected'}

Dashboard coverage:
${localeSummaries.join('\n') || '- No locale data'}

Key dependency scan:
${dependencySummary}

Missing or empty translations:
${missingRows.join('\n') || '- None'}
${extraCount}

Instructions:
- Edit the existing locale files directly.
- Preserve the current key naming, nesting, JSON/YAML formatting, placeholders, and interpolation tokens.
- Use the source locale text as the translation source.
- Keep existing non-empty translations unless they are clearly broken.
- Search the codebase and nearby locale files for existing wording before inventing new translations.
- Use dependency scan data when available, but inspect code before deleting or renaming any key.
- Report the files changed and any entries that could not be translated safely.`
  }

  private buildDependencyPromptBlock(): string {
    const data = this.dependencyData
    if (!data) {
      return '- Not scanned in this dashboard yet. Run the dependency scan before cleanup work if key usage matters.'
    }

    const unreferenced = data.topUnreferenced
      .slice(0, 20)
      .map(item => `- unreferenced: ${item.key} | source: ${item.value || '(empty)'}`)
    const referenced = data.topReferenced
      .slice(0, 10)
      .map(item => `- referenced: ${item.key} | refs: ${item.count} | from: ${this.formatPromptReferences(item.refs)} | source: ${item.value || '(empty)'}`)
    const codeOnly = data.codeOnlyItems
      .slice(0, 20)
      .map(item => `- code-only: ${item.key} | refs: ${item.count} | from: ${this.formatPromptReferences(item.refs)}`)

    return [
      `- Total locale keys: ${data.totalKeys}`,
      `- Referenced locale keys: ${data.referencedKeys.length}`,
      `- Unreferenced locale keys: ${data.unreferencedKeys.length}`,
      `- Code references without locale keys: ${data.codeOnlyKeys.length}`,
      '',
      'Top referenced keys:',
      referenced.join('\n') || '- None',
      '',
      'Top unreferenced keys:',
      unreferenced.join('\n') || '- None',
      '',
      'Code-only keys:',
      codeOnly.join('\n') || '- None',
    ].join('\n')
  }

  private update() {
    if (!this.panel) return

    const locales = this.store.locales
    const allKeys = this.store.getAllKeys()
    const config = this.store.projectConfig
    const sourceLocale = config.sourceLanguage

    const cloneLocaleData = buildCloneLocaleData(locales)
    const diagnostics = this.store.getDiagnostics()

    const totalCells = allKeys.length * locales.length
    const missingCells = diagnostics.filter(d => d.type === 'missing').length
    const emptyCells = diagnostics.filter(d => d.type === 'empty').length
    const filledCells = totalCells - missingCells - emptyCells
    const overallPct = totalCells > 0 ? Math.round(filledCells / totalCells * 100) : 100

    const localeData = locales.map(locale => {
      const keys = this.store.getKeysForLocale(locale)
      const filled = keys.filter(k => {
        const v = this.store.getTranslation(locale, k)
        return v !== undefined && v !== ''
      }).length
      const missing = allKeys.length - filled
      return {
        locale,
        total: allKeys.length,
        filled,
        missing,
        pct: allKeys.length > 0 ? Math.round(filled / allKeys.length * 100) : 100,
      }
    })

    const donutSvg = this.generateDonutSvg(filledCells, emptyCells, missingCells, overallPct)
    const dependencyStat = this.renderDependencyStat(allKeys.length)
    const dependencyButtonLabel = this.dependencyLoading
      ? 'Scanning...'
      : 'Rescan'
    const dependencySubtitle = this.renderDependencySubtitle()
    const codeOnlyReferences = this.renderCodeOnlyReferences()

    const localeBars = localeData.map(d => {
      const barColor = d.pct === 100 ? 'var(--color-success)' : d.pct > 70 ? 'var(--color-warning)' : d.pct > 40 ? 'var(--color-orange)' : 'var(--color-danger)'
      const name = getLocaleName(d.locale)
      const flagCss = getLocaleFlagCssClass(d.locale)
      return `
        <div class="locale-row">
          <div class="locale-label">
            <span class="flag-icon-wrap"><span class="fi ${flagCss}"></span></span>
            <span class="locale-name">${name}</span>
            <span class="locale-code">${d.locale}</span>
          </div>
          <div class="locale-bar-wrap">
            <div class="locale-bar" style="width:${d.pct}%;background:${barColor}"></div>
          </div>
          <div class="locale-stats">
            <span class="pct" style="color:${barColor}">${d.pct}%</span>
            <span class="detail">${d.filled}/${d.total}</span>
          </div>
          <button class="btn-icon" onclick="showCloneDialog('${d.locale}')" title="Clone this locale to another">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5h-2v2a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5h2zm2.5 1h-4v5h4zm4.5 1h-4v1h3.5v4h-3.5v1h4z"/></svg>
          </button>
        </div>`
    }).join('')

    const categoryData = this.analyzeByCategory(allKeys)

    const categoryBars = categoryData.map(cat => {
      const barColor = cat.pct === 100 ? 'var(--color-success)' : cat.pct > 70 ? 'var(--color-warning)' : 'var(--color-danger)'
      return `
        <div class="category-row clickable" onclick="openCategory('${this.escJs(cat.category)}')" title="${this.escAttr(cat.category)}">
          <div class="category-label" title="${this.escAttr(cat.category)}">${this.escHtml(cat.category)}</div>
          <div class="category-bar-wrap">
            <div class="category-bar" style="width:${cat.pct}%;background:${barColor}"></div>
          </div>
          <div class="category-stats">
            <span class="pct" style="color:${barColor}">${cat.pct}%</span>
            <span class="detail">${cat.filled}/${cat.total}</span>
          </div>
        </div>`
    }).join('')

    const missingKeys = diagnostics.filter(d => d.type === 'missing' || d.type === 'empty')
    const topMissing = missingKeys.slice(0, 20).map(d => {
      const flagCss = d.locale ? getLocaleFlagCssClass(d.locale) : ''
      const dependencyBadge = this.renderKeyDependencyBadge(d.key)
      const dependencySources = this.renderKeyDependencySources(d.key)
      return `<div class="missing-item clickable" onclick="openKey('${this.escJs(d.key)}')">
        <div class="missing-main">
          <span class="missing-locale">${flagCss ? `<span class="flag-icon-sm"><span class="fi ${flagCss}"></span></span>` : ''} ${d.locale || ''}</span>
          <span class="missing-key">${this.escHtml(d.key)}</span>
          ${dependencyBadge}
        </div>
        ${dependencySources}
      </div>`
    }).join('')

    this.panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>i18n Progress Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/css/flag-icons.min.css">
  <style>
    :root {
      --bg-base: #1e1e1e;
      --bg-card: #252526;
      --bg-elevated: #2d2d2d;
      --bg-hover: #333;
      --border: #333;
      --border-focus: #555;
      --text-primary: #d4d4d4;
      --text-secondary: #888;
      --text-muted: #666;
      --color-success: #4CAF50;
      --color-warning: #FFC107;
      --color-orange: #FF9800;
      --color-danger: #f48771;
      --color-info: #2196F3;
      --color-accent: #9CDCFE;
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 12px;
      --space-lg: 16px;
      --space-xl: 20px;
      --space-2xl: 24px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg-base);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.5;
      padding: var(--space-2xl);
    }

    .dashboard { max-width: 1200px; margin: 0 auto; }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--space-2xl);
      gap: var(--space-lg);
    }
    .header-left { flex: 1; min-width: 0; }
    .header h1 { color: var(--color-success); font-size: 20px; font-weight: 600; margin-bottom: var(--space-xs); }
    .header .subtitle { color: var(--text-secondary); font-size: 12px; }
    .header .dependency-status { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
    .header-actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; align-items: center; }
    .btn-group { display: flex; gap: 2px; }

    .btn {
      padding: 5px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
    }
    .btn:hover { background: var(--bg-hover); border-color: var(--border-focus); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { border-color: var(--color-success); color: var(--color-success); }
    .btn-primary:hover { background: var(--color-success); color: #fff; }
    .btn-info { border-color: var(--color-info); color: var(--color-info); }
    .btn-info:hover { background: var(--color-info); color: #fff; }
    .btn-icon {
      padding: 3px 6px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-icon:hover { color: var(--color-info); border-color: var(--color-info); background: rgba(33,150,243,0.1); }

    /* ── Cards ── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-xl);
    }
    .card-title {
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 1.2px;
      margin-bottom: var(--space-lg);
      font-weight: 600;
    }

    /* ── Top Grid: Overview + Locale ── */
    .grid-top {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: var(--space-xl);
    }

    /* ── Donut ── */
    .donut-wrap { display: flex; flex-direction: column; align-items: center; }
    .donut-svg { width: 180px; height: 180px; }
    .legend { display: flex; gap: var(--space-lg); margin-top: var(--space-md); flex-wrap: wrap; justify-content: center; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); }
    .legend-dot { width: 8px; height: 8px; border-radius: 50%; }

    /* ── Summary Stats ── */
    .summary-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--space-sm);
      margin-top: var(--space-lg);
    }
    .summary-stat {
      text-align: center;
      padding: var(--space-sm) var(--space-xs);
      background: var(--bg-elevated);
      border-radius: var(--radius-sm);
    }
    .summary-stat .num { font-size: 20px; font-weight: 700; line-height: 1.3; }
    .summary-stat .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

    /* ── Locale Rows ── */
    .locale-row {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      margin-bottom: var(--space-sm);
    }
    .locale-row:last-child { margin-bottom: 0; }
    .locale-label {
      width: 130px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .flag-icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 15px;
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .flag-icon-wrap .fi {
      width: 22px;
      height: 15px;
      display: block;
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
    }
    .flag-icon-sm {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 11px;
      border-radius: 1px;
      overflow: hidden;
      vertical-align: middle;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .flag-icon-sm .fi {
      width: 16px;
      height: 11px;
      display: block;
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
    }
    .locale-name { font-size: 12px; color: var(--text-primary); }
    .locale-code { font-size: 10px; color: var(--text-muted); }
    .locale-bar-wrap { flex: 1; height: 6px; background: var(--bg-elevated); border-radius: 3px; overflow: hidden; }
    .locale-bar { height: 100%; border-radius: 3px; transition: width 0.5s ease; min-width: 2px; }
    .locale-stats { width: 72px; text-align: right; flex-shrink: 0; }
    .locale-stats .pct { font-size: 13px; font-weight: 700; }
    .locale-stats .detail { font-size: 10px; color: var(--text-muted); margin-left: 4px; }

    /* ── Bottom Grid: Category + Missing ── */
    .grid-bottom {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-xl);
      margin-top: var(--space-xl);
    }

    /* ── Category Rows ── */
    .category-row {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      margin-bottom: 6px;
      padding: 3px 6px;
      border-radius: var(--radius-sm);
    }
    .category-row.clickable { cursor: pointer; transition: background 0.15s; }
    .category-row.clickable:hover { background: var(--bg-elevated); }
    .category-label {
      width: 140px;
      font-size: 12px;
      color: var(--color-accent);
      font-family: monospace;
      flex-shrink: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .category-bar-wrap { flex: 1; height: 5px; background: var(--bg-elevated); border-radius: 3px; overflow: hidden; }
    .category-bar { height: 100%; border-radius: 3px; transition: width 0.5s ease; min-width: 2px; }
    .category-stats { width: 72px; text-align: right; flex-shrink: 0; }
    .category-stats .pct { font-size: 12px; font-weight: 700; }
    .category-stats .detail { font-size: 10px; color: var(--text-muted); margin-left: 4px; }

    /* ── Missing Items ── */
    .missing-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 5px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .missing-item:last-child { border-bottom: 0; }
    .missing-item.clickable { cursor: pointer; transition: background 0.15s; }
    .missing-item.clickable:hover { background: var(--bg-elevated); }
    .missing-main { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }
    .missing-locale { color: var(--text-muted); min-width: 36px; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
    .missing-key {
      color: var(--color-danger);
      font-family: monospace;
      font-size: 12px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Dependency Chips ── */
    .dep-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      padding: 1px 7px;
      font-size: 10px;
      line-height: 16px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .dep-chip.ok { color: var(--color-success); background: rgba(76,175,80,0.12); border: 1px solid rgba(76,175,80,0.25); }
    .dep-chip.warn { color: var(--color-warning); background: rgba(255,193,7,0.10); border: 1px solid rgba(255,193,7,0.22); }
    .dep-chip.danger { color: var(--color-danger); background: rgba(244,135,113,0.10); border: 1px solid rgba(244,135,113,0.22); }
    .dependency-sources { display: flex; align-items: center; gap: 4px; padding-left: 48px; min-width: 0; flex-wrap: wrap; }
    .ref-chip {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
      font-size: 10px;
      color: var(--color-accent);
      background: rgba(156,220,254,0.06);
      border: 1px solid rgba(156,220,254,0.15);
      border-radius: 10px;
      padding: 1px 7px;
    }
    .ref-more { font-size: 10px; color: var(--text-muted); }

    /* ── Code Only Callout ── */
    .dependency-callout { margin-top: var(--space-lg); padding-top: var(--space-lg); border-top: 1px solid var(--border); }
    .dependency-callout-title {
      color: var(--color-danger);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: var(--space-sm);
      font-weight: 600;
    }
    .code-only-row { display: flex; flex-direction: column; gap: 3px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .code-only-row:last-child { border-bottom: 0; }
    .code-only-main { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }
    .code-only-key {
      color: var(--color-danger);
      font-family: monospace;
      font-size: 12px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .code-only-row .dependency-sources { padding-left: 0; }

    /* ── Empty State ── */
    .empty-state { color: var(--color-success); font-size: 13px; padding: var(--space-md) 0; }

    /* ── Clone Dialog ── */
    ${getCloneDialogCss()}
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <div class="header-left">
        <h1>i18n Progress Dashboard</h1>
        <div class="subtitle">${allKeys.length} keys &times; ${locales.length} locales = ${totalCells} translations</div>
        <div class="dependency-status">${dependencySubtitle}</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="refresh()">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.418A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>
          Refresh
        </button>
        <div class="btn-group">
          <button class="btn btn-info" onclick="autoTranslate()" title="Auto translate all missing keys">Auto Translate</button>
          <button class="btn btn-info" onclick="formatAll()" title="Format all locale files">Format</button>
        </div>
        <div class="btn-group">
          <button class="btn" onclick="openAIPrompt('codex')" title="Send dashboard prompt to Codex">Codex</button>
          <button class="btn" onclick="openAIPrompt('copilot')" title="Send dashboard prompt to Copilot Chat">Copilot</button>
        </div>
        <button class="btn" onclick="scanDependencies()" title="Rescan code references">${dependencyButtonLabel}</button>
      </div>
    </div>

    <div class="grid-top">
      <div class="card">
        <div class="card-title">Overall Progress</div>
        <div class="donut-wrap">
          <div class="donut-svg">${donutSvg}</div>
          <div class="legend">
            <div class="legend-item"><div class="legend-dot" style="background:var(--color-success)"></div>Filled (${filledCells})</div>
            <div class="legend-item"><div class="legend-dot" style="background:var(--color-warning)"></div>Empty (${emptyCells})</div>
            <div class="legend-item"><div class="legend-dot" style="background:var(--color-danger)"></div>Missing (${missingCells})</div>
          </div>
        </div>
        <div class="summary-stats">
          <div class="summary-stat"><div class="num" style="color:var(--color-success)">${allKeys.length}</div><div class="label">Keys</div></div>
          <div class="summary-stat"><div class="num" style="color:var(--color-info)">${locales.length}</div><div class="label">Locales</div></div>
          <div class="summary-stat"><div class="num" style="color:${overallPct === 100 ? 'var(--color-success)' : 'var(--color-warning)'}">${overallPct}%</div><div class="label">Complete</div></div>
          ${dependencyStat}
        </div>
        ${codeOnlyReferences}
      </div>

      <div class="card">
        <div class="card-title">Locale Coverage</div>
        ${localeBars}
      </div>
    </div>

    <div class="grid-bottom">
      <div class="card">
        <div class="card-title">Category Progress</div>
        ${categoryBars}
      </div>
      <div class="card">
        <div class="card-title">Missing Translations${missingKeys.length > 20 ? ` (20 of ${missingKeys.length})` : missingKeys.length > 0 ? ` (${missingKeys.length})` : ''}</div>
        ${topMissing || '<div class="empty-state">All translations are complete!</div>'}
      </div>
    </div>
  </div>

  ${getCloneDialogHtml()}

  <script>
    const I18N = ${JSON.stringify({
      refreshing: t('dashboard.refreshed'),
      refreshFailed: t('dashboard.refresh_failed', '{0}'),
      autoTranslating: t('dashboard.auto_translate_started'),
      autoTranslateFailed: t('dashboard.auto_translate_failed', '{0}'),
      formatting: 'Formatting locale files...',
      formatComplete: 'Format complete',
      formatFailed: 'Format failed',
    })};
    const ALL_LOCALES = ${JSON.stringify(locales)};
    const SOURCE_LOCALE = ${JSON.stringify(sourceLocale)};
    const vscode = acquireVsCodeApi();

    function showToast(msg, type) {
      let toast = document.getElementById('toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:6px 16px;border-radius:6px;font-size:12px;z-index:9999;transition:opacity 0.3s;pointer-events:none;color:#fff;';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.background = type === 'error' ? '#d32f2f' : type === 'warn' ? '#f57c00' : '#388e3c';
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    function setBtnLoading(btn, loading) {
      if (!btn) return;
      if (loading) {
        btn.dataset.origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '0.5';
      } else {
        btn.innerHTML = btn.dataset.origHtml || btn.innerHTML;
        btn.disabled = false;
        btn.style.opacity = '';
      }
    }

    function refresh() {
      const btn = document.querySelector('.btn-primary');
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'refresh' });
      setTimeout(() => { setBtnLoading(btn, false); showToast(I18N.refreshing); }, 1500);
    }
    function autoTranslate() {
      const btn = document.querySelector('.btn-info');
      if (btn && btn.disabled) return;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'autoTranslate' });
      showToast(I18N.autoTranslating);
    }
    function formatAll() {
      const btns = document.querySelectorAll('.btn-info');
      const btn = btns[1];
      if (btn && btn.disabled) return;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'formatAll' });
      showToast(I18N.formatting);
    }
    function openAIPrompt(target) {
      vscode.postMessage({ type: 'openAIPrompt', target });
    }
    function scanDependencies() {
      const btn = document.querySelector('.header-actions .btn:last-child');
      if (btn && btn.disabled) return;
      setBtnLoading(btn, true);
      vscode.postMessage({ type: 'scanDependencies' });
      showToast('Scanning key dependencies...');
    }
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'translateDone') {
        const btn = document.querySelector('.btn-info');
        setBtnLoading(btn, false);
        showToast(msg.error ? 'Translate failed' : 'Translate complete', msg.error ? 'error' : undefined);
      }
      if (msg.type === 'formatDone') {
        const btns = document.querySelectorAll('.btn-info');
        const btn = btns[1];
        setBtnLoading(btn, false);
        const detail = msg.error
          ? I18N.formatFailed
          : I18N.formatComplete + ': ' + (msg.formatted || 0) + ' formatted, ' + (msg.unchanged || 0) + ' unchanged';
        showToast(detail, msg.error || msg.errors ? 'warn' : undefined);
      }
      if (msg.type === 'dependencyDone') {
        const btn = document.querySelector('.header-actions .btn:last-child');
        setBtnLoading(btn, false);
        showToast(msg.error ? 'Dependency scan failed' : 'Dependency scan complete', msg.error ? 'error' : undefined);
      }
      if (msg.type === 'cloneDone') {
        showToast(msg.error ? 'Clone failed' : 'Cloned ' + (msg.cloned || 0) + ' keys', msg.error ? 'error' : undefined);
      }
    });
    function openCategory(cat) { vscode.postMessage({ type: 'openCategory', category: cat }); }
    function openKey(key) { vscode.postMessage({ type: 'openKey', key: key }); }

    ${getCloneDialogJs(cloneLocaleData, locales, sourceLocale)}
  </script>
</body>
</html>`
  }

  private renderDependencySubtitle(): string {
    if (this.dependencyLoading) return 'Dependencies: scanning code references...'
    if (this.dependencyError) return `Dependencies: scan failed - ${this.escHtml(this.dependencyError)}`
    if (!this.dependencyData) return 'Dependencies: not scanned'

    const data = this.dependencyData
    return `Dependencies: ${data.referencedKeys.length}/${data.totalKeys} locale keys referenced, ${data.codeOnlyKeys.length} code refs missing locale`
  }

  private renderDependencyStat(totalKeys: number): string {
    if (this.dependencyLoading) {
      return '<div class="summary-stat"><div class="num" style="color:#FFC107">...</div><div class="label">Dependencies</div></div>'
    }

    if (!this.dependencyData) {
      return '<div class="summary-stat"><div class="num" style="color:#888">-</div><div class="label">Dependencies</div></div>'
    }

    const usedPct = totalKeys > 0 ? Math.round(this.dependencyData.referencedKeys.length / totalKeys * 100) : 100
    const color = this.dependencyData.unreferencedKeys.length === 0 ? '#4CAF50' : '#FFC107'
    return `<div class="summary-stat"><div class="num" style="color:${color}">${usedPct}%</div><div class="label">Referenced</div></div>`
  }

  private renderKeyDependencyBadge(key: string): string {
    if (!this.dependencyData) return ''
    const refCount = this.dependencyData.graph[key]?.length || 0
    const badgeClass = refCount > 0 ? 'ok' : 'danger'
    return `<span class="dep-chip ${badgeClass}">${refCount} refs</span>`
  }

  private renderCodeOnlyReferences(): string {
    if (!this.dependencyData || this.dependencyData.codeOnlyItems.length === 0) return ''

    const rows = this.dependencyData.codeOnlyItems
      .slice(0, 8)
      .map(item => `<div class="code-only-row">
        <div class="code-only-main">
          <span class="code-only-key" title="${this.escAttr(item.key)}">${this.escHtml(item.key)}</span>
          <span class="dep-chip danger">${item.count} refs</span>
        </div>
        ${this.renderReferenceChips(item.refs, 3)}
      </div>`)

    const rest = this.dependencyData.codeOnlyItems.length - rows.length
    const restRow = rest > 0 ? `<div class="ref-more">+${rest} more keys</div>` : ''

    return `<div class="dependency-callout">
      <div class="dependency-callout-title">Code references missing from locale files</div>
      ${rows.join('')}
      ${restRow}
    </div>`
  }

  private renderKeyDependencySources(key: string): string {
    if (!this.dependencyData) return ''
    const refs = this.dependencyData.graph[key] || []
    if (refs.length === 0) return ''

    return this.renderReferenceChips(refs, 3)
  }

  private renderReferenceChips(refs: KeyReference[], maxCount: number): string {
    const chips = refs.slice(0, maxCount).map(ref => {
      const label = `${this.relativePath(ref.filepath)}:${ref.line}`
      const title = `${this.relativePath(ref.filepath)}:${ref.line}:${ref.column}`
      return `<span class="ref-chip" title="${this.escAttr(title)}">${this.escHtml(label)}</span>`
    })

    const rest = refs.length - chips.length
    const restChip = rest > 0 ? `<span class="ref-more">+${rest} more</span>` : ''
    return `<div class="dependency-sources">${chips.join('')}${restChip}</div>`
  }

  private formatPromptReferences(refs: KeyReference[]): string {
    const samples = refs
      .slice(0, 3)
      .map(ref => `${this.relativePath(ref.filepath)}:${ref.line}`)

    if (refs.length > samples.length) {
      samples.push(`+${refs.length - samples.length} more`)
    }

    return samples.join(', ') || '(none)'
  }

  private relativePath(filepath: string): string {
    const normalizedRoot = this.store.projectConfig.rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalizedFile = filepath.replace(/\\/g, '/')
    if (normalizedRoot && normalizedFile.startsWith(`${normalizedRoot}/`)) {
      return normalizedFile.slice(normalizedRoot.length + 1)
    }
    return normalizedFile
  }

  private generateDonutSvg(filled: number, empty: number, missing: number, pct: number): string {
    const total = filled + empty + missing
    if (total === 0) {
      return `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="80" fill="none" stroke="#333" stroke-width="20"/><text x="100" y="108" text-anchor="middle" fill="#4CAF50" font-size="28" font-weight="bold">100%</text></svg>`
    }

    const circumference = 2 * Math.PI * 80
    const filledLen = (filled / total) * circumference
    const emptyLen = (empty / total) * circumference
    const missingLen = (missing / total) * circumference

    const filledOffset = 0
    const emptyOffset = filledLen
    const missingOffset = filledLen + emptyLen

    return `<svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="80" fill="none" stroke="#333" stroke-width="20"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#4CAF50" stroke-width="20"
        stroke-dasharray="${filledLen} ${circumference - filledLen}"
        stroke-dashoffset="${-filledOffset}"
        transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#FFC107" stroke-width="20"
        stroke-dasharray="${emptyLen} ${circumference - emptyLen}"
        stroke-dashoffset="${-emptyOffset}"
        transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#f48771" stroke-width="20"
        stroke-dasharray="${missingLen} ${circumference - missingLen}"
        stroke-dashoffset="${-missingOffset}"
        transform="rotate(-90 100 100)"/>
      <text x="100" y="108" text-anchor="middle" fill="#d4d4d4" font-size="28" font-weight="bold">${pct}%</text>
    </svg>`
  }

  private analyzeByCategory(allKeys: string[]): {
    category: string
    total: number
    filled: number
    pct: number
  }[] {
    const categories = new Map<string, { total: number; filled: number }>()

    for (const key of allKeys) {
      const parts = key.split('.')
      const category = parts.length >= 2 ? parts.slice(0, 2).join('.') : parts[0]

      if (!categories.has(category)) {
        categories.set(category, { total: 0, filled: 0 })
      }

      const cat = categories.get(category)!
      cat.total += this.store.locales.length

      for (const locale of this.store.locales) {
        const v = this.store.getTranslation(locale, key)
        if (v !== undefined && v !== '') {
          cat.filled++
        }
      }
    }

    return Array.from(categories.entries())
      .map(([category, data]) => ({
        category,
        total: data.total,
        filled: data.filled,
        pct: data.total > 0 ? Math.round(data.filled / data.total * 100) : 100,
      }))
      .sort((a, b) => a.pct - b.pct)
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private escJs(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')
  }

  private escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
