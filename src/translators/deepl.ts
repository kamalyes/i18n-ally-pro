import { BaseTranslator, TranslateRequest, TranslatorConfig } from './base'

export class DeepLTranslator extends BaseTranslator {
  async translate(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
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
}
