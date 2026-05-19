import https from 'https'
import http from 'http'
import { LOCALE_MAP } from './locale-map'

export interface TranslateRequest {
  text: string
  from: string
  to: string
}

export interface TranslatorConfig {
  apiKey: string
  apiEndpoint?: string
}

export abstract class BaseTranslator {
  abstract translate(req: TranslateRequest, config: TranslatorConfig): Promise<string>

  protected httpPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const lib = isHttps ? https : http
      const safeUrl = this.redactUrl(url)

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
      }

      console.log('[i18n-ally-pro][http request]', JSON.stringify({
        method: 'POST',
        url: safeUrl,
        headers: this.redactHeaders(options.headers),
        body: this.truncate(body),
      }))

      const req = lib.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          console.log('[i18n-ally-pro][http response]', JSON.stringify({
            url: safeUrl,
            statusCode: res.statusCode,
            body: this.truncate(data),
          }))

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data)
          }
          else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
          }
        })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url)
      for (const key of ['key', 'api_key', 'apikey', 'auth_key']) {
        if (parsed.searchParams.has(key)) {
          parsed.searchParams.set(key, '***')
        }
      }
      return parsed.toString()
    } catch {
      return url
    }
  }

  private redactHeaders(headers: Record<string, string | number>): Record<string, string | number> {
    const safe: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(headers)) {
      if (/authorization|subscription|api[-_]?key/i.test(key)) {
        safe[key] = '***'
      } else {
        safe[key] = value
      }
    }
    return safe
  }

  private truncate(value: string): string {
    return value.length > 2000 ? `${value.slice(0, 2000)}...` : value
  }

  protected toGoogleLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.google
    // Try case-insensitive match
    const lower = locale.toLowerCase()
    for (const key of Object.keys(LOCALE_MAP)) {
      if (key.toLowerCase() === lower) return LOCALE_MAP[key].google
    }
    // Try base language (e.g., "de-DE" -> "de")
    const base = locale.replace('_', '-').split('-')[0]
    const baseMapping = LOCALE_MAP[base]
    if (baseMapping) return baseMapping.google
    return base
  }

  protected toDeepLLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.deepl
    // Try case-insensitive match
    const lower = locale.toLowerCase()
    for (const key of Object.keys(LOCALE_MAP)) {
      if (key.toLowerCase() === lower) return LOCALE_MAP[key].deepl
    }
    // Try base language
    const base = locale.replace('_', '-').split('-')[0]
    const baseMapping = LOCALE_MAP[base]
    if (baseMapping) return baseMapping.deepl
    return locale.toUpperCase().split('-')[0]
  }

  protected toMicrosoftLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.microsoft
    // Try case-insensitive match
    const lower = locale.toLowerCase()
    for (const key of Object.keys(LOCALE_MAP)) {
      if (key.toLowerCase() === lower) return LOCALE_MAP[key].microsoft
    }
    // Try base language
    const base = locale.replace('_', '-').split('-')[0]
    const baseMapping = LOCALE_MAP[base]
    if (baseMapping) return baseMapping.microsoft
    return locale.replace('_', '-')
  }

  /**
   * Validate that a translation result is actually in the target language.
   * For non-Latin scripts (CJK, Bengali, Burmese, Thai, Arabic, etc.),
   * if the result contains only ASCII/Latin characters when the source is English,
   * the translation likely failed and returned the source text unchanged.
   */
  public validateTranslation(source: string, result: string, targetLocale: string): string {
    if (!result || result.trim() === '') {
      throw new Error('Translation returned empty result')
    }

    // If result is identical to source, translation failed
    if (result.trim() === source.trim()) {
      throw new Error(`Translation returned identical source text for locale "${targetLocale}" — the translation service may not support this language pair`)
    }

    // Check if target locale requires non-Latin script
    const baseLocale = targetLocale.replace('_', '-').split('-')[0].toLowerCase()
    const nonLatinLocales = new Set([
      'zh', 'ja', 'ko',       // CJK
      'ar', 'he', 'fa', 'ur', // RTL / Arabic script
      'hi', 'bn', 'pa', 'gu', 'ta', 'te', 'kn', 'ml', 'mr', 'ne', 'si', // Indic
      'my', 'km', 'lo', 'th', // Southeast Asian
      'ka', 'hy', 'am',       // Caucasian / Ethiopian
      'ru', 'uk', 'bg', 'sr', 'mk', 'mn', 'kk', // Cyrillic / Mongolian
      'el',                    // Greek
    ])

    if (nonLatinLocales.has(baseLocale)) {
      // For non-Latin target locales, check if result contains any non-ASCII characters
      const hasNonAscii = /[\u0080-\uffff]/.test(result)
      if (!hasNonAscii) {
        // Result is pure ASCII for a non-Latin locale — translation likely failed
        // But allow some common cases: numbers, URLs, brand names
        const strippedResult = result.replace(/[0-9\s\W_]/g, '')
        const strippedSource = source.replace(/[0-9\s\W_]/g, '')
        if (strippedResult && strippedResult === strippedSource) {
          throw new Error(`Translation for "${targetLocale}" returned Latin-only text identical to source — this locale requires non-Latin script`)
        }
      }
    }

    return result
  }

  protected getLocaleNameForAI(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.openai
    // Try case-insensitive match
    const lower = locale.toLowerCase()
    for (const key of Object.keys(LOCALE_MAP)) {
      if (key.toLowerCase() === lower) return LOCALE_MAP[key].openai
    }
    // Try base language
    const base = locale.replace('_', '-').split('-')[0]
    const baseMapping = LOCALE_MAP[base]
    if (baseMapping) return baseMapping.openai
    return locale
  }
}
