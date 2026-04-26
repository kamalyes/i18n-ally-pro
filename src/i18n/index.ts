import { env, workspace } from 'vscode'
import fs from 'fs'
import path from 'path'

interface LocaleData {
  localeFlags?: Record<string, string>
  localeNames?: Record<string, string>
  [key: string]: string | Record<string, string> | undefined
}

class I18n {
  private messages: Record<string, string> = {}
  private fallbackMessages: Record<string, string> = {}
  private localeFlags: Record<string, string> = {}
  private fallbackLocaleFlags: Record<string, string> = {}
  private localeNames: Record<string, string> = {}
  private fallbackLocaleNames: Record<string, string> = {}
  private extensionPath = ''
  private currentLanguage = ''

  private static LOCALE_TO_COUNTRY: Record<string, string> = {
    'ar': 'sa', 'bg': 'bg', 'bm': 'my', 'bn': 'bd', 'cs': 'cz',
    'da': 'dk', 'de': 'de', 'el': 'gr', 'en': 'us', 'es': 'es',
    'fi': 'fi', 'fr': 'fr', 'he': 'il', 'hi': 'in', 'hu': 'hu',
    'id': 'id', 'it': 'it', 'ja': 'jp', 'kh': 'kh', 'ko': 'kr',
    'lo': 'la', 'ms': 'my', 'my': 'mm', 'nb-NO': 'no', 'nl': 'nl',
    'nl-NL': 'nl', 'no': 'no', 'pl': 'pl', 'pt': 'pt', 'pt-BR': 'br',
    'ro': 'ro', 'ru': 'ru', 'sv': 'se', 'sv-SE': 'se', 'tc': 'tw',
    'th': 'th', 'tr': 'tr', 'uk': 'ua', 'ur': 'pk', 'vi': 'vn',
    'zh': 'cn', 'zh-CN': 'cn', 'zh-Hans': 'cn', 'zh-Hant': 'tw', 'zh-TW': 'tw',
  }

  init(extensionPath: string) {
    this.extensionPath = extensionPath
    this.reload()
  }

  reload() {
    if (!this.extensionPath) return

    const config = workspace.getConfiguration('i18nAllyPro')
    const displayLanguage = config.get<string>('displayLanguage', '').trim()
    const systemLanguage = (env.language || 'en').toLowerCase()
    const language = displayLanguage || systemLanguage

    const fallbackData = this.loadLocale(this.extensionPath, 'en')
    this.fallbackMessages = fallbackData.messages
    this.fallbackLocaleFlags = fallbackData.localeFlags
    this.fallbackLocaleNames = fallbackData.localeNames

    const data = this.loadLocale(this.extensionPath, language)
    this.messages = data.messages
    this.localeFlags = data.localeFlags
    this.localeNames = data.localeNames
    this.currentLanguage = language
  }

  getCurrentLanguage(): string {
    return this.currentLanguage
  }

  private loadLocale(extensionPath: string, locale: string): {
    messages: Record<string, string>
    localeFlags: Record<string, string>
    localeNames: Record<string, string>
  } {
    const raw = this.loadRaw(extensionPath, locale)
    const messages: Record<string, string> = {}
    let localeFlags: Record<string, string> = {}
    let localeNames: Record<string, string> = {}

    for (const [key, value] of Object.entries(raw)) {
      if (key === 'localeFlags' && typeof value === 'object' && value !== null) {
        localeFlags = value as Record<string, string>
      } else if (key === 'localeNames' && typeof value === 'object' && value !== null) {
        localeNames = value as Record<string, string>
      } else if (typeof value === 'string') {
        messages[key] = value
      }
    }

    return { messages, localeFlags, localeNames }
  }

  private loadRaw(extensionPath: string, locale: string): LocaleData {
    const localeDir = path.join(extensionPath, 'locales')

    let filename = `${locale}.json`
    let filepath = path.join(localeDir, filename)

    if (!fs.existsSync(filepath)) {
      const prefix = locale.split('-')[0]
      const candidates = fs.existsSync(localeDir)
        ? fs.readdirSync(localeDir).filter(f => {
            const base = f.replace('.json', '').toLowerCase()
            return base === prefix || base.startsWith(prefix + '-')
          })
        : []

      if (candidates.length > 0) {
        filename = candidates[0]
        filepath = path.join(localeDir, filename)
      } else {
        filepath = path.join(localeDir, 'en.json')
      }
    }

    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    } catch {
      return {}
    }
  }

  private format(str: string, args: any[]): string {
    return str.replace(/{(\d+)}/g, (_match: string, number: string) => {
      const idx = parseInt(number)
      return typeof args[idx] !== 'undefined' ? String(args[idx]) : `{${number}}`
    })
  }

  t(key: string, ...args: any[]): string {
    let text = this.messages[key] ?? this.fallbackMessages[key] ?? key
    if (args && args.length)
      text = this.format(text, args)
    return text
  }

  getLocaleFlag(locale: string): string {
    return this.localeFlags[locale] || this.fallbackLocaleFlags[locale] || '🌐'
  }

  getLocaleName(locale: string): string {
    return this.localeNames[locale] || this.fallbackLocaleNames[locale] || locale
  }

  getLocaleCountryCode(locale: string): string {
    if (I18n.LOCALE_TO_COUNTRY[locale]) return I18n.LOCALE_TO_COUNTRY[locale]
    const prefix = locale.split('-')[0].toLowerCase()
    return I18n.LOCALE_TO_COUNTRY[prefix] || prefix
  }

  getLocaleFlagCssClass(locale: string): string {
    const code = this.getLocaleCountryCode(locale)
    return `fi fi-${code}`
  }
}

const i18n = new I18n()

export function initI18n(extensionPath: string) {
  i18n.init(extensionPath)
}

export function reloadI18n() {
  i18n.reload()
}

export function getCurrentLanguage(): string {
  return i18n.getCurrentLanguage()
}

export function t(key: string, ...args: any[]): string {
  return i18n.t(key, ...args)
}

export function getLocaleFlag(locale: string): string {
  return i18n.getLocaleFlag(locale)
}

export function getLocaleName(locale: string): string {
  return i18n.getLocaleName(locale)
}

export function getLocaleCountryCode(locale: string): string {
  return i18n.getLocaleCountryCode(locale)
}

export function getLocaleFlagCssClass(locale: string): string {
  return i18n.getLocaleFlagCssClass(locale)
}

export default i18n
