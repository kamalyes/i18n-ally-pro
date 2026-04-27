import { BaseTranslator, TranslateRequest, TranslatorConfig } from './base'

export class OpenAITranslator extends BaseTranslator {
  async translate(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
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
}
