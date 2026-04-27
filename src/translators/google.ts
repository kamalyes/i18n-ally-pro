import { BaseTranslator, TranslateRequest, TranslatorConfig } from './base'

export class GoogleTranslator extends BaseTranslator {
  async translate(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
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
}
