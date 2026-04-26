import { Uri } from 'vscode'

export type FrameworkId = 'go-rpc-gateway' | 'vue-i18n' | 'react-i18next' | 'general'
export type KeyStyle = 'flat' | 'nested'
export type ParserId = 'json' | 'yaml' | 'po' | 'properties'

export interface ProjectConfig {
  rootPath: string
  localesPaths: string[]
  framework: FrameworkId
  keystyle: KeyStyle
  parsers: ParserId[]
  sourceLanguage: string
  displayLanguage: string
  namespace: boolean
}

export interface TranslationFile {
  filepath: string
  locale: string
  parser: ParserId
  namespace?: string
}

export interface TranslationEntry {
  key: string
  value: string
  locale: string
  filepath: string
  line?: number
  column?: number
}

export interface TranslationMap {
  [locale: string]: {
    [key: string]: string
  }
}

export interface KeyOccurrence {
  key: string
  filepath: string
  line: number
  column: number
  length: number
}

export interface DiagnosticInfo {
  type: 'missing' | 'unused' | 'empty'
  key: string
  locale?: string
  filepath?: string
  line?: number
}

export interface TreeNode {
  keypath: string
  children: Map<string, TreeNode>
  values: { [locale: string]: string }
  isLeaf: boolean
}

export interface ScannerMatch {
  key: string
  start: number
  end: number
  line: number
  column: number
}

export interface Scanner {
  languageIds: string[]
  scan(text: string, filepath: string): ScannerMatch[]
}

export interface Parser {
  id: ParserId
  extensions: string[]
  parse(text: string): Record<string, any>
  dump(data: Record<string, any>, sort?: boolean): string
  navigateToKey(text: string, keypath: string, keystyle: KeyStyle): { line: number; column: number } | null
}

export interface ExtractContext {
  document: Uri
  selection: { start: number; end: number }
  text: string
  suggestedKey: string
}
