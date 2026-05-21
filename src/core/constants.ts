import { workspace } from 'vscode'

// 内置的 DeepL API 密钥（通过环境变量注入）
export const BUILTIN_DEEPL_API_KEY = process.env.BUILTIN_DEEPL_API_KEY || ''

// 并发配置
export const DEFAULT_CONCURRENCY = {
  FILE_PROCESSING: 5,
  TRANSLATION: 3,
  FILE_OPERATIONS: 10
}

export const DEFAULT_IGNORE_DIRS = [
  'node_modules', 'vendor', '.git', 'dist', 'build', '.vscode',
  'out', 'bin', '.cache', '.next', '.nuxt', 'coverage',
]

export const LOCALE_DIR_NAMES = [
  'locales', 'locale', 'i18n', 'lang', 'langs', 'languages',
  'translations', 'messages', 'intl', 'localization',
]

export const COMMON_LOCALES = [
  'en', 'en-US', 'zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant',
  'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'it', 'nl',
  'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'uk',
  'cs', 'sv', 'da', 'no', 'fi', 'el', 'he', 'bg', 'ro',
  'bm', 'bn', 'kh', 'lo', 'my', 'tc', 'ur',
]

/**
 * 互斥语言组：组内只需存在一种 locale（如 en 与 en-US 二选一，不可同时作为独立语言目录）。
 */
export const LOCALE_EXCLUSIVE_GROUPS: readonly string[][] = [
  ['en', 'en-US'],
]

export const SUPPORTED_LOCALES = [
  'en', 'en-US', 'zh', 'zh-tw', 'ja', 'ko',
  'de', 'fr', 'fr-fr', 'es', 'pt',
  'pt-br', 'ru', 'it', 'nl', 'nl-nl',
  'ar', 'hi', 'th', 'vi', 'id',
  'ms', 'tr', 'pl', 'uk', 'cs',
  'sv', 'sv-se', 'da', 'fi',
  'el', 'he', 'ro',
] as const

export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

export const LOCALE_NAMES: Record<string, string> = {
  'en': 'English',
  'en-US': 'English (US)',
  'zh': '简体中文',
  'zh-tw': '繁體中文',
  'ja': '日本語',
  'ko': '한국어',
  'de': 'Deutsch',
  'fr': 'Français',
  'fr-fr': 'Français (France)',
  'es': 'Español',
  'pt': 'Português',
  'pt-br': 'Português (Brasil)',
  'ru': 'Русский',
  'it': 'Italiano',
  'nl': 'Nederlands',
  'nl-nl': 'Nederlands (Nederland)',
  'ar': 'العربية',
  'hi': 'हिन्दी',
  'th': 'ไทย',
  'vi': 'Tiếng Việt',
  'id': 'Bahasa Indonesia',
  'ms': 'Bahasa Melayu',
  'tr': 'Türkçe',
  'pl': 'Polski',
  'uk': 'Українська',
  'cs': 'Čeština',
  'sv': 'Svenska',
  'sv-se': 'Svenska (Sverige)',
  'da': 'Dansk',
  'fi': 'Suomi',
  'el': 'Ελληνικά',
  'he': 'עברית',
  'ro': 'Română',
}

/** 规范化 locale id（统一分隔符，保留大小写用于精确匹配）。 */
export function normalizeLocaleId(locale: string): string {
  return locale.trim().replace(/_/g, '-')
}

export function localeIdEquals(a: string, b: string): boolean {
  return normalizeLocaleId(a).toLowerCase() === normalizeLocaleId(b).toLowerCase()
}

/** 返回 locale 所属的互斥组；不属于任何组则返回 null。 */
export function getLocaleExclusiveGroup(locale: string): string[] | null {
  const id = normalizeLocaleId(locale).toLowerCase()
  const base = id.split('-')[0]

  for (const group of LOCALE_EXCLUSIVE_GROUPS) {
    const normalized = group.map(g => normalizeLocaleId(g).toLowerCase())
    if (normalized.some(g => g === id || g === base || id.startsWith(`${g}-`))) {
      return [...group]
    }
  }

  return null
}

/** 互斥组槽位 id（同组共用，用于校验「是否已有英语」）。 */
export function getExclusiveGroupKey(locale: string): string {
  const group = getLocaleExclusiveGroup(locale)
  if (!group) return normalizeLocaleId(locale).toLowerCase()
  return normalizeLocaleId(group[0]).toLowerCase()
}

/** 两个 locale 是否属于同一互斥组。 */
export function localesShareExclusiveGroup(a: string, b: string): boolean {
  return getExclusiveGroupKey(a) === getExclusiveGroupKey(b)
    && getLocaleExclusiveGroup(a) !== null
}

/**
 * 过滤互斥候选：组内已有 locale 时，不再推荐同组其它变体（例如已有 en-US 则不再列出 en）。
 */
export function filterExclusiveLocaleCandidates(
  candidates: readonly string[],
  existingLocales: readonly string[],
): string[] {
  const occupiedGroupKeys = new Set(
    existingLocales.map(loc => getExclusiveGroupKey(loc)),
  )

  return candidates.filter(candidate => {
    const group = getLocaleExclusiveGroup(candidate)
    if (!group) return true
    const groupKey = getExclusiveGroupKey(candidate)
    if (!occupiedGroupKeys.has(groupKey)) return true
    return existingLocales.some(ex => localeIdEquals(ex, candidate))
  })
}

export function getIgnoreDirs(): string[] {
  const config = workspace.getConfiguration('i18nAllyPro')
  const userDirs: string[] = config.get<string[]>('ignoreDirs', [])
  if (userDirs.length === 0) {
    return DEFAULT_IGNORE_DIRS
  }
  const merged = new Set([...DEFAULT_IGNORE_DIRS, ...userDirs])
  return Array.from(merged)
}
