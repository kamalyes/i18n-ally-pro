import {
  TreeDataProvider, TreeItem, TreeItemCollapsibleState, Command, EventEmitter, Event,
  Uri, ThemeIcon,
} from 'vscode'
import { TranslationStore } from '../core/store'
import { getLocaleFlag } from '../i18n'
import { t } from '../i18n'

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

  constructor(store: TranslationStore) {
    this.store = store
    this.attachStoreListener()
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
        item.description = `${filled}/${keys.length} keys`
      } catch {
        item.description = ''
      }
      item.contextValue = 'localeRoot'
      return item
    }

    if (element instanceof GroupNode) {
      const flag = getLocaleFlag(element.locale)
      const item = new TreeItem(`${flag} ${element.label}`, TreeItemCollapsibleState.Collapsed)
      item.iconPath = ThemeIcon.Folder
      item.tooltip = element.keypath
      item.contextValue = 'group'
      return item
    }

    if (element instanceof KeyNode) {
      const flag = getLocaleFlag(element.locale)
      const item = new TreeItem(`${flag} ${element.displayKey}`, TreeItemCollapsibleState.None)
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
      const keys = this.store.getKeysForLocale(element.locale)
      return this.buildNodes(keys, element.locale)
    }

    if (element instanceof GroupNode) {
      const keys = this.store.getKeysForLocale(element.locale)
        .filter(k => k.startsWith(element.keypath + '.') || k === element.keypath)
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
