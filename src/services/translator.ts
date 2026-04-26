import { workspace, window, ProgressLocation } from 'vscode'
import https from 'https'
import http from 'http'
import { TranslationStore } from '../core/store'

export type TranslatorEngine = 'google' | 'deepl' | 'openai' | 'microsoft'

export interface TranslatorConfig {
  engine: TranslatorEngine
  apiKey: string
  apiEndpoint?: string
  sourceLanguage: string
}

interface TranslateRequest {
  text: string
  from: string
  to: string
}

const LOCALE_MAP: Record<string, { google: string; deepl: string; microsoft: string; openai: string }> = {
  'ar': { google: 'ar', deepl: 'AR', microsoft: 'ar', openai: 'Arabic' },
  'bm': { google: 'ms', deepl: 'MS', microsoft: 'ms', openai: 'Malay' },
  'bn': { google: 'bn', deepl: 'BN', microsoft: 'bn', openai: 'Bengali' },
  'de': { google: 'de', deepl: 'DE', microsoft: 'de', openai: 'German' },
  'en': { google: 'en', deepl: 'EN', microsoft: 'en', openai: 'English' },
  'es': { google: 'es', deepl: 'ES', microsoft: 'es', openai: 'Spanish' },
  'fr': { google: 'fr', deepl: 'FR', microsoft: 'fr', openai: 'French' },
  'fr-fr': { google: 'fr', deepl: 'FR', microsoft: 'fr', openai: 'French (France)' },
  'hi': { google: 'hi', deepl: 'HI', microsoft: 'hi', openai: 'Hindi' },
  'id': { google: 'id', deepl: 'ID', microsoft: 'id', openai: 'Indonesian' },
  'it': { google: 'it', deepl: 'IT', microsoft: 'it', openai: 'Italian' },
  'ja': { google: 'ja', deepl: 'JA', microsoft: 'ja', openai: 'Japanese' },
  'kh': { google: 'km', deepl: 'KM', microsoft: 'km', openai: 'Khmer' },
  'ko': { google: 'ko', deepl: 'KO', microsoft: 'ko', openai: 'Korean' },
  'lo': { google: 'lo', deepl: 'LO', microsoft: 'lo', openai: 'Lao' },
  'ms': { google: 'ms', deepl: 'MS', microsoft: 'ms', openai: 'Malay' },
  'my': { google: 'my', deepl: 'MY', microsoft: 'my', openai: 'Burmese' },
  'nl': { google: 'nl', deepl: 'NL', microsoft: 'nl', openai: 'Dutch' },
  'pt': { google: 'pt', deepl: 'PT', microsoft: 'pt', openai: 'Portuguese' },
  'pt-br': { google: 'pt', deepl: 'PT-BR', microsoft: 'pt-br', openai: 'Portuguese (Brazil)' },
  'ru': { google: 'ru', deepl: 'RU', microsoft: 'ru', openai: 'Russian' },
  'sv': { google: 'sv', deepl: 'SV', microsoft: 'sv', openai: 'Swedish' },
  'tc': { google: 'zh-TW', deepl: 'ZH', microsoft: 'zh-Hant', openai: 'Traditional Chinese' },
  'th': { google: 'th', deepl: 'TH', microsoft: 'th', openai: 'Thai' },
  'tr': { google: 'tr', deepl: 'TR', microsoft: 'tr', openai: 'Turkish' },
  'ur': { google: 'ur', deepl: 'UR', microsoft: 'ur', openai: 'Urdu' },
  'vi': { google: 'vi', deepl: 'VI', microsoft: 'vi', openai: 'Vietnamese' },
  'zh': { google: 'zh-CN', deepl: 'ZH', microsoft: 'zh-Hans', openai: 'Simplified Chinese' },
  'zh-CN': { google: 'zh-CN', deepl: 'ZH', microsoft: 'zh-Hans', openai: 'Simplified Chinese' },
  'zh-tw': { google: 'zh-TW', deepl: 'ZH', microsoft: 'zh-Hant', openai: 'Traditional Chinese (Taiwan)' },
}

const translationCache = new Map<string, string>()

export class TranslatorService {
  private store: TranslationStore

  constructor(store: TranslationStore) {
    this.store = store
  }

  getConfig(): TranslatorConfig {
    const cfg = workspace.getConfiguration('i18nAllyPro')
    return {
      engine: cfg.get<TranslatorEngine>('translatorEngine', 'google'),
      apiKey: cfg.get<string>('translatorApiKey', ''),
      apiEndpoint: cfg.get<string>('translatorApiEndpoint', ''),
      sourceLanguage: this.store.projectConfig.sourceLanguage,
    }
  }

  async translateText(text: string, from: string, to: string): Promise<string> {
    const config = this.getConfig()

    if (!config.apiKey) {
      throw new Error('Translation API key not configured. Set i18nAllyPro.translatorApiKey in settings.')
    }

    const cacheKey = `${config.engine}:${from}:${to}:${text}`
    const cached = translationCache.get(cacheKey)
    if (cached) return cached

    const request: TranslateRequest = { text, from, to }

    let result: string
    switch (config.engine) {
      case 'google':
        result = await this.translateGoogle(request, config)
        break
      case 'deepl':
        result = await this.translateDeepL(request, config)
        break
      case 'openai':
        result = await this.translateOpenAI(request, config)
        break
      case 'microsoft':
        result = await this.translateMicrosoft(request, config)
        break
      default:
        throw new Error(`Unknown translator engine: ${config.engine}`)
    }

    if (result) {
      translationCache.set(cacheKey, result)
    }

    return result
  }

  async autoTranslateEmptyKeys(): Promise<{ translated: number; skipped: number; errors: number }> {
    const config = this.getConfig()

    if (!config.apiKey) {
      window.showWarningMessage('请先配置翻译 API Key (i18nAllyPro.translatorApiKey)')
      return { translated: 0, skipped: 0, errors: 0 }
    }

    const sourceLocale = config.sourceLanguage
    const sourceKeys = this.store.getKeysForLocale(sourceLocale)
    const targetLocales = this.store.locales.filter(l => l !== sourceLocale)

    let translated = 0
    let skipped = 0
    let errors = 0

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'i18n Pro: Auto-translating',
        cancellable: true,
      },
      async (progress, token) => {
        const total = sourceKeys.length * targetLocales.length
        let current = 0

        for (const key of sourceKeys) {
          if (token.isCancellationRequested) break

          const sourceValue = this.store.getTranslation(sourceLocale, key)
          if (!sourceValue) {
            skipped += targetLocales.length
            current += targetLocales.length
            continue
          }

          for (const locale of targetLocales) {
            if (token.isCancellationRequested) break

            current++
            progress.report({
              message: `[${current}/${total}] ${key} → ${locale}`,
              increment: (100 / total),
            })

            const existingValue = this.store.getTranslation(locale, key)
            if (existingValue !== undefined && existingValue !== '') {
              skipped++
              continue
            }

            try {
              const translatedText = await this.translateText(sourceValue, sourceLocale, locale)
              if (translatedText) {
                await this.store.setTranslation(locale, key, translatedText)
                translated++
              }
              else {
                skipped++
              }
            }
            catch (err: any) {
              console.error(`Translation failed for ${key} → ${locale}:`, err)
              errors++
            }

            await this.delay(200)
          }
        }
      },
    )

    return { translated, skipped, errors }
  }

  async translateSingleKey(key: string, locale: string): Promise<string | null> {
    const config = this.getConfig()
    const sourceValue = this.store.getTranslation(config.sourceLanguage, key)
    if (!sourceValue) return null

    try {
      return await this.translateText(sourceValue, config.sourceLanguage, locale)
    }
    catch (err: any) {
      window.showErrorMessage(`Translation failed: ${err.message}`)
      return null
    }
  }

  clearCache() {
    translationCache.clear()
  }

  private async translateGoogle(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://translation.googleapis.com'
    const url = `${endpoint}/language/translate/v2?key=${config.apiKey}`

    const body = JSON.stringify({
      q: req.text,
      source: this.toGoogleLocale(req.from),
      target: this.toGoogleLocale(req.to),
      format: 'text',
    })

    const result = await this.httpPost(url, body, { 'Content-Type': 'application/json' })
    const json = JSON.parse(result)

    return json?.data?.translations?.[0]?.translatedText || ''
  }

  private async translateDeepL(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
    const isFree = config.apiKey.endsWith(':fx')
    const endpoint = config.apiEndpoint || (isFree ? 'https://api-free.deepl.com/v2' : 'https://api.deepl.com/v2')
    const url = `${endpoint}/translate`

    const body = JSON.stringify({
      text: [req.text],
      source_lang: this.toDeepLLocale(req.from),
      target_lang: this.toDeepLLocale(req.to),
    })

    const result = await this.httpPost(url, body, {
      'Content-Type': 'application/json',
      'Authorization': `DeepL-Auth-Key ${config.apiKey}`,
    })

    const json = JSON.parse(result)
    return json?.translations?.[0]?.text || ''
  }

  private async translateOpenAI(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.openai.com/v1'
    const url = `${endpoint}/chat/completions`

    const fromName = this.getLocaleNameForAI(req.from)
    const toName = this.getLocaleNameForAI(req.to)

    const body = JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator for software UI strings. Translate the following text from ${fromName} to ${toName}. Only return the translated text, nothing else. Preserve any placeholders like {name}, {count}, %s, %d, {{variable}}. Keep the translation concise and natural for native speakers.`,
        },
        {
          role: 'user',
          content: req.text,
        },
      ],
      temperature: 0.1,
    })

    const result = await this.httpPost(url, body, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    })

    const json = JSON.parse(result)
    return json?.choices?.[0]?.message?.content?.trim() || ''
  }

  private async translateMicrosoft(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.cognitive.microsofttranslator.com'
    const url = `${endpoint}/translate?api-version=3.0&from=${this.toMicrosoftLocale(req.from)}&to=${this.toMicrosoftLocale(req.to)}`

    const body = JSON.stringify([{ text: req.text }])

    const result = await this.httpPost(url, body, {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': config.apiKey,
    })

    const json = JSON.parse(result)
    return json?.[0]?.translations?.[0]?.text || ''
  }

  private toGoogleLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.google
    return locale.replace('_', '-').split('-')[0]
  }

  private toDeepLLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.deepl
    return locale.toUpperCase().split('-')[0]
  }

  private toMicrosoftLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.microsoft
    return locale.replace('_', '-')
  }

  private getLocaleNameForAI(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.openai
    return locale
  }

  private httpPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const lib = isHttps ? https : http

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

      const req = lib.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
