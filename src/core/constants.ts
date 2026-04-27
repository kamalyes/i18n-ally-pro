import { workspace } from 'vscode'

export const DEFAULT_IGNORE_DIRS = [
  'node_modules', 'vendor', '.git', 'dist', 'build', '.vscode',
  'out', 'bin', '.cache', '.next', '.nuxt', 'coverage',
]

export const LOCALE_DIR_NAMES = [
  'locales', 'locale', 'i18n', 'lang', 'langs', 'languages',
  'translations', 'messages', 'intl', 'localization',
]

export const COMMON_LOCALES = [
  'en', 'zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant',
  'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'it', 'nl',
  'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'uk',
  'cs', 'sv', 'da', 'no', 'fi', 'el', 'he', 'bg', 'ro',
  'bm', 'bn', 'kh', 'lo', 'my', 'tc', 'ur',
]

export const SUPPORTED_LOCALES = [
  'en', 'zh', 'zh-tw', 'ja', 'ko',
  'de', 'fr', 'es', 'pt', 'ru',
  'it', 'nl', 'ar', 'hi', 'th',
  'vi', 'id', 'ms', 'tr', 'pl',
  'uk', 'cs', 'sv', 'da', 'fi',
  'el', 'he', 'ro',
] as const

export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

export const LOCALE_NAMES: Record<string, string> = {
  'en': 'English',
  'zh': '简体中文',
  'zh-tw': '繁體中文',
  'ja': '日本語',
  'ko': '한국어',
  'de': 'Deutsch',
  'fr': 'Français',
  'es': 'Español',
  'pt': 'Português',
  'ru': 'Русский',
  'it': 'Italiano',
  'nl': 'Nederlands',
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
  'da': 'Dansk',
  'fi': 'Suomi',
  'el': 'Ελληνικά',
  'he': 'עברית',
  'ro': 'Română',
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
