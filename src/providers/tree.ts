import {
  TreeDataProvider, TreeItem, TreeItemCollapsibleState, Command, EventEmitter, Event,
  ThemeIcon, ThemeColor, TreeDragAndDropController, DataTransfer, DataTransferItem, window,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, t } from '../i18n'

type KeyStatus = 'translated' | 'empty' | 'missing'
type I18nNode = RootNode | StatusNode | GroupNode | KeyNode | PlaceholderNode

class RootNode {
  constructor(public label: string, public locale: string, public isSource: boolean) {}
}

class StatusNode {
  constructor(public status: KeyStatus, public locale: string, public count: number) {}
}

class GroupNode {
  constructor(public label: string, public locale: string, public keypath: string, public status?: KeyStatus) {}
}

class KeyNode {
  constructor(
    public keypath: string,
    public displayKey: string,
    public value: string,
    public locale: string,
    public filepath: string,
    public status: KeyStatus,
  ) {}
}

class PlaceholderNode {
  constructor(public label: string) {}
}

interface LocaleCoverageStats {
  total: number
  filled: number
  empty: number
  missing: number
  pct: string
  hasMissing: boolean
}

export class I18nTreeProvider implements TreeDataProvider<I18nNode> {
  private _onDidChangeTreeData = new EventEmitter<I18nNode | undefined>()
  readonly onDidChangeTreeData: Event<I18nNode | undefined> = this._onDidChangeTreeData.event

  private store: TranslationStore
  private listenerAttached = false
  private searchFilter: string = ''

  constructor(store: TranslationStore) {
    this.store = store
    this.attachStoreListener()
  }

  setSearchFilter(filter: string) {
    this.searchFilter = filter.toLowerCase()
    this.refresh()
  }

  clearSearchFilter() {
    this.searchFilter = ''
    this.refresh()
  }

  private attachStoreListener() {
    if (this.listenerAttached) return
    try {
      this.store.on('didChange', () => this.refresh())
      this.listenerAttached = true
    } catch {
      this.listenerAttached = false
    }
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: I18nNode): TreeItem {
    if (element instanceof PlaceholderNode) {
      const item = new TreeItem(element.label, TreeItemCollapsibleState.None)
      item.iconPath = new ThemeIcon('info')
      return item
    }

    if (element instanceof RootNode) {
      const flag = getLocaleFlag(element.locale)
      const item = new TreeItem(`${flag} ${element.label}`, element.isSource ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)

      try {
        const stats = this.getLocaleCoverageStats(element.locale)
        const sourceMark = element.isSource ? ` ${t('editor.source').toLowerCase()}` : ''
        item.description = `${this.getProgressBar(stats.filled, stats.total)} ${stats.pct}% (${stats.filled}/${stats.total})${sourceMark}`
        item.tooltip = `${element.locale}: ${stats.filled}/${stats.total} translated, ${stats.empty} empty, ${stats.missing} missing`

        if (element.isSource) {
          item.iconPath = new ThemeIcon('globe', new ThemeColor('gitDecoration.modifiedResourceForeground'))
        } else if (stats.hasMissing) {
          item.iconPath = new ThemeIcon('globe', new ThemeColor('problemsWarningIcon.foreground'))
        } else {
          item.iconPath = new ThemeIcon('globe', new ThemeColor('testing.iconPassed'))
        }
      } catch {
        item.description = ''
      }

      item.contextValue = 'localeRoot'
      return item
    }

    if (element instanceof StatusNode) {
      const item = new TreeItem(
        `${this.getStatusLabel(element.status)} (${element.count})`,
        element.count > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
      )
      item.iconPath = this.getStatusIcon(element.status)
      item.tooltip = `${element.locale}: ${this.getStatusLabel(element.status)} (${element.count})`
      item.contextValue = `status-${element.status}`
      return item
    }

    if (element instanceof GroupNode) {
      const item = new TreeItem(element.label, TreeItemCollapsibleState.Collapsed)
      item.iconPath = ThemeIcon.Folder
      item.tooltip = element.keypath
      item.contextValue = 'group'

      try {
        if (element.status) {
          const count = this.getFilteredKeys(element.locale, element.status, element.keypath).length
          item.description = String(count)
          item.iconPath = this.getStatusIcon(element.status)
        } else {
          const stats = this.getLocaleCoverageStats(element.locale, element.keypath)
          item.description = `${stats.pct}% (${stats.filled}/${stats.total})`
          if (stats.hasMissing) {
            item.iconPath = new ThemeIcon('folder', new ThemeColor('list.warningForeground'))
          }
        }
      } catch {
        item.description = ''
      }

      return item
    }

    if (element instanceof KeyNode) {
      const item = new TreeItem(element.displayKey, TreeItemCollapsibleState.None)

      if (element.status === 'missing') {
        item.description = `(${t('editor.missing')})`
        item.iconPath = this.getStatusIcon('missing')
        item.tooltip = `${t('editor.missing')}: ${element.keypath} [${element.locale}]`
      } else if (element.status === 'empty') {
        item.description = `(${t('editor.empty')})`
        item.iconPath = this.getStatusIcon('empty')
        item.tooltip = `${t('editor.empty')}: ${element.keypath} [${element.locale}]`
      } else {
        item.description = element.value.length > 40 ? element.value.slice(0, 40) + '...' : element.value
        item.iconPath = new ThemeIcon('symbol-string')
        item.tooltip = `${element.locale}: ${element.value}\nKey: ${element.keypath}`
      }

      item.command = {
        command: 'i18nAllyPro.openKeyAndFile',
        title: t('command.openEditor'),
        arguments: [element.keypath, element.locale],
      } as Command
      item.contextValue = 'key'
      return item
    }

    return new TreeItem('')
  }

  getChildren(element?: I18nNode): I18nNode[] {
    this.attachStoreListener()

    let locales: string[] = []
    try {
      locales = this.store.locales
    } catch {
      return [new PlaceholderNode(t('tree.placeholder_not_init'))]
    }

    if (locales.length === 0 && !element) {
      return [new PlaceholderNode(t('tree.placeholder_no_translations'))]
    }

    if (!element) {
      const sourceLocale = this.store.projectConfig.sourceLanguage
      return locales.map(locale =>
        new RootNode(locale, locale, locale === sourceLocale)
      )
    }

    if (element instanceof RootNode) {
      return [
        new StatusNode('translated', element.locale, this.getFilteredKeys(element.locale, 'translated').length),
        new StatusNode('empty', element.locale, this.getFilteredKeys(element.locale, 'empty').length),
        new StatusNode('missing', element.locale, this.getFilteredKeys(element.locale, 'missing').length),
      ]
    }

    if (element instanceof StatusNode) {
      const keys = this.getFilteredKeys(element.locale, element.status)
      return this.buildNodes(keys, element.locale, '', element.status)
    }

    if (element instanceof GroupNode) {
      const keys = this.getFilteredKeys(element.locale, element.status, element.keypath)
      return this.buildNodes(keys, element.locale, element.keypath, element.status)
    }

    return []
  }

  private getLocaleCoverageStats(locale: string, prefix = ''): LocaleCoverageStats {
    const keys = this.store.getAllKeys()
      .filter(k => !prefix || k === prefix || k.startsWith(prefix + '.'))

    let filled = 0
    let empty = 0
    let missing = 0

    for (const key of keys) {
      const status = this.getKeyStatus(locale, key)
      if (status === 'translated') filled++
      else if (status === 'empty') empty++
      else missing++
    }

    return {
      total: keys.length,
      filled,
      empty,
      missing,
      pct: this.toCoveragePct(filled, keys.length),
      hasMissing: filled < keys.length,
    }
  }

  private toCoveragePct(filled: number, total: number): string {
    if (total === 0 || filled >= total) return '100'
    const pct = Math.round((filled / total) * 1000) / 10
    return Number.isInteger(pct) ? String(pct) : pct.toFixed(1)
  }

  private getProgressBar(filled: number, total: number): string {
    const segments = 10
    if (total === 0) return ':'.repeat(segments)
    const active = Math.max(0, Math.min(segments, Math.round((filled / total) * segments)))
    return '|'.repeat(active) + ':'.repeat(segments - active)
  }

  private getStatusLabel(status: KeyStatus): string {
    if (status === 'translated') return t('editor.translated')
    if (status === 'empty') return t('editor.empty')
    return t('editor.missing')
  }

  private getStatusIcon(status: KeyStatus): ThemeIcon {
    if (status === 'translated') return new ThemeIcon('pass-filled', new ThemeColor('testing.iconPassed'))
    if (status === 'empty') return new ThemeIcon('warning', new ThemeColor('problemsWarningIcon.foreground'))
    return new ThemeIcon('error', new ThemeColor('problemsErrorIcon.foreground'))
  }

  private getKeyStatus(locale: string, key: string): KeyStatus {
    const value = this.store.getTranslation(locale, key)
    if (value === undefined) return 'missing'
    if (value.trim() === '') return 'empty'
    return 'translated'
  }

  private getFilteredKeys(locale: string, status?: KeyStatus, prefix = ''): string[] {
    const keys = this.store.getAllKeys()
      .filter(k => !prefix || k === prefix || k.startsWith(prefix + '.'))

    const searched = this.searchFilter
      ? keys.filter(k => {
          if (k.toLowerCase().includes(this.searchFilter)) return true
          const v = this.store.getTranslation(locale, k)
          if (v && v.toLowerCase().includes(this.searchFilter)) return true
          return false
        })
      : keys

    return status ? this.filterKeysByStatus(searched, locale, status) : searched
  }

  private filterKeysByStatus(keys: string[], locale: string, status: KeyStatus): string[] {
    return keys.filter(k => this.getKeyStatus(locale, k) === status)
  }

  private buildNodes(keys: string[], locale: string, prefix = '', status?: KeyStatus): I18nNode[] {
    const groups = new Map<string, string[]>()
    const directKeys: string[] = []

    for (const key of keys) {
      const relativeKey = prefix ? key.slice(prefix.length + 1) : key
      const dotIndex = relativeKey.indexOf('.')
      if (dotIndex > 0) {
        const group = relativeKey.slice(0, dotIndex)
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group)!.push(key)
      } else {
        directKeys.push(key)
      }
    }

    const nodes: I18nNode[] = []

    const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [group] of sortedGroups) {
      const groupPath = prefix ? `${prefix}.${group}` : group
      const hasDirectValue = directKeys.includes(groupPath)
      if (!hasDirectValue) {
        nodes.push(new GroupNode(group, locale, groupPath, status))
      }
    }

    for (const key of directKeys.sort()) {
      const value = this.store.getTranslation(locale, key)
      const displayKey = prefix ? key.slice(prefix.length + 1) : key
      const file = this.store.findFileForKey(key, locale)
      nodes.push(new KeyNode(key, displayKey, value || '', locale, file?.filepath || '', this.getKeyStatus(locale, key)))
    }

    return nodes
  }
}

export class I18nDragAndDropController implements TreeDragAndDropController<I18nNode> {
  readonly dragMimeTypes = ['application/vnd.code.i18n.key']
  readonly dropMimeTypes = ['application/vnd.code.i18n.key']

  private store: TranslationStore
  private onRefresh: () => void

  constructor(store: TranslationStore, onRefresh: () => void) {
    this.store = store
    this.onRefresh = onRefresh
  }

  handleDrag(source: readonly I18nNode[], dataTransfer: DataTransfer, token: import('vscode').CancellationToken): void | Thenable<void> {
    const keys: string[] = []
    for (const node of source) {
      if (node instanceof KeyNode) {
        keys.push(node.keypath)
      } else if (node instanceof GroupNode) {
        const groupKeys = this.store.getAllKeys()
          .filter(k => k.startsWith(node.keypath + '.') || k === node.keypath)
          .filter(k => !node.status || this.getKeyStatus(node.locale, k) === node.status)
        keys.push(...groupKeys)
      }
    }
    if (keys.length > 0) {
      dataTransfer.set('application/vnd.code.i18n.key', new DataTransferItem(JSON.stringify(keys)))
    }
  }

  async handleDrop(target: I18nNode | undefined, dataTransfer: DataTransfer, token: import('vscode').CancellationToken): Promise<void> {
    const item = dataTransfer.get('application/vnd.code.i18n.key')
    if (!item) return

    let keys: string[] = []
    try {
      keys = JSON.parse(item.value)
    } catch {
      return
    }
    if (keys.length === 0) return

    let targetPrefix = ''
    if (target instanceof GroupNode) {
      targetPrefix = target.keypath
    } else if (target instanceof RootNode) {
      targetPrefix = ''
    } else {
      return
    }

    const renames: { oldKey: string; newKey: string }[] = []
    for (const oldKey of keys) {
      const parts = oldKey.split('.')
      const lastPart = parts[parts.length - 1]
      const newKey = targetPrefix ? `${targetPrefix}.${lastPart}` : lastPart
      if (oldKey !== newKey) {
        renames.push({ oldKey, newKey })
      }
    }

    if (renames.length === 0) return

    const confirm = await window.showWarningMessage(
      t('editor.drag_confirm', String(renames.length)),
      { modal: true },
      t('editor.move'),
    )
    if (confirm !== t('editor.move')) return

    for (const { oldKey, newKey } of renames) {
      if (this.store.getTranslation(this.store.projectConfig.sourceLanguage, newKey) !== undefined) {
        const overwrite = await window.showWarningMessage(
          t('editor.drag_key_exists', newKey),
          t('editor.overwrite'),
          t('editor.skip'),
        )
        if (overwrite !== t('editor.overwrite')) continue
      }

      for (const locale of this.store.locales) {
        const value = this.store.getTranslation(locale, oldKey)
        if (value !== undefined) {
          await this.store.setTranslation(locale, newKey, value)
          await this.store.deleteTranslation(locale, oldKey)
        }
      }
    }

    this.onRefresh()
    window.showInformationMessage(t('editor.drag_done', String(renames.length)))
  }

  private getKeyStatus(locale: string, key: string): KeyStatus {
    const value = this.store.getTranslation(locale, key)
    if (value === undefined) return 'missing'
    if (value.trim() === '') return 'empty'
    return 'translated'
  }
}
