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

  protected toGoogleLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.google
    return locale.replace('_', '-').split('-')[0]
  }

  protected toDeepLLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.deepl
    return locale.toUpperCase().split('-')[0]
  }

  protected toMicrosoftLocale(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.microsoft
    return locale.replace('_', '-')
  }

  protected getLocaleNameForAI(locale: string): string {
    const mapping = LOCALE_MAP[locale]
    if (mapping) return mapping.openai
    return locale
  }
}
