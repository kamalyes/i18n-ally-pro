import {
  TreeDataProvider, TreeItem, TreeItemCollapsibleState, Command, EventEmitter, Event,
  Uri, ThemeIcon, ThemeColor, TreeDragAndDropController, DataTransfer, DataTransferItem, window,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag, t } from '../i18n'

type I18nNode = RootNode | GroupNode | KeyNode | PlaceholderNode

class RootNode {
  constructor(public label: string, public locale: string, public isSource: boolean) {}
}

class GroupNode {
  constructor(public label: string, public locale: string, public keypath: string) {}
}

class KeyNode {
  constructor(public keypath: string, public displayKey: string, public value: string, public locale: string, public filepath: string, public isMissing: boolean) {}
}

class PlaceholderNode {
  constructor(public label: string) {}
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
      item.iconPath = ThemeIcon.Folder
      try {
        const keys = this.store.getKeysForLocale(element.locale)
        const filled = keys.filter(k => {
          const v = this.store.getTranslation(element.locale, k)
          return v !== undefined && v !== ''
        }).length
        const pct = keys.length > 0 ? Math.round((filled / keys.length) * 100) : 100
        const hasMissing = filled < keys.length
        item.description = hasMissing ? `${pct}% (${filled}/${keys.length})` : `✅ ${pct}%`
        if (element.isSource) {
          item.iconPath = new ThemeIcon('folder', new ThemeColor('gitDecoration.modifiedResourceForeground'))
        }
      } catch {
        item.description = ''
      }
      item.contextValue = 'localeRoot'
      return item
    }

    if (element instanceof GroupNode) {
      const item = new TreeItem(element.label, TreeItemCollapsibleState.Collapsed)
      item.iconPath = ThemeIcon.Folder
      item.tooltip = element.keypath
      item.contextValue = 'group'
      try {
        const allKeys = this.store.getAllKeys().filter(k => k.startsWith(element.keypath + '.') || k === element.keypath)
        const locales = this.store.locales
        const totalSlots = allKeys.length * locales.length
        const filledSlots = allKeys.reduce((acc, k) => {
          return acc + locales.filter(l => {
            const v = this.store.getTranslation(l, k)
            return v !== undefined && v !== ''
          }).length
        }, 0)
        const pct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 100
        const hasMissing = filledSlots < totalSlots
        item.description = hasMissing ? `${pct}% (${filledSlots}/${totalSlots})` : `✅ ${pct}%`
        if (hasMissing) {
          item.iconPath = new ThemeIcon('folder', new ThemeColor('list.warningForeground'))
        }
      } catch {
        item.description = ''
      }
      return item
    }

    if (element instanceof KeyNode) {
      const item = new TreeItem(element.displayKey, TreeItemCollapsibleState.None)
      if (element.isMissing) {
        item.description = `(${t('editor.missing')})`
        item.iconPath = new ThemeIcon('warning')
        item.tooltip = `⚠ ${t('editor.missing')}: ${element.keypath} [${element.locale}]`
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
        new RootNode(locale.toUpperCase(), locale, locale === sourceLocale)
      )
    }

    if (element instanceof RootNode) {
      let keys = this.store.getKeysForLocale(element.locale)
      if (this.searchFilter) {
        keys = keys.filter(k => {
          if (k.toLowerCase().includes(this.searchFilter)) return true
          const v = this.store.getTranslation(element.locale, k)
          if (v && v.toLowerCase().includes(this.searchFilter)) return true
          return false
        })
      }
      return this.buildNodes(keys, element.locale)
    }

    if (element instanceof GroupNode) {
      let keys = this.store.getKeysForLocale(element.locale)
        .filter(k => k.startsWith(element.keypath + '.') || k === element.keypath)
      if (this.searchFilter) {
        keys = keys.filter(k => {
          if (k.toLowerCase().includes(this.searchFilter)) return true
          const v = this.store.getTranslation(element.locale, k)
          if (v && v.toLowerCase().includes(this.searchFilter)) return true
          return false
        })
      }
      return this.buildNodes(keys, element.locale, element.keypath)
    }

    return []
  }

  private buildNodes(keys: string[], locale: string, prefix = ''): I18nNode[] {
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
        nodes.push(new GroupNode(group, locale, groupPath))
      }
    }

    for (const key of directKeys.sort()) {
      const value = this.store.getTranslation(locale, key)
      const displayKey = prefix ? key.slice(prefix.length + 1) : key
      const file = this.store.findFileForKey(key, locale)
      const isMissing = value === undefined || value === ''
      nodes.push(new KeyNode(key, displayKey, value || '', locale, file?.filepath || '', isMissing))
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
        const groupKeys = this.store.getAllKeys().filter(k => k.startsWith(node.keypath + '.') || k === node.keypath)
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
}
