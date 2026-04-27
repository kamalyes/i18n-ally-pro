import { BaseTranslator, TranslateRequest, TranslatorConfig } from './base'

export class MicrosoftTranslator extends BaseTranslator {
  async translate(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
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
}
