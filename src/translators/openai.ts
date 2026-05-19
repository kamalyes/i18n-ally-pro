import { BaseTranslator, TranslateRequest, TranslatorConfig } from './base'

export class OpenAITranslator extends BaseTranslator {
  async translate(req: TranslateRequest, config: TranslatorConfig): Promise<string> {
    const endpoint = config.apiEndpoint || 'https://api.openai.com/v1'
    const url = `${endpoint}/chat/completions`

    const fromName = this.getLocaleNameForAI(req.from)
    const toName = this.getLocaleNameForAI(req.to)
    const toCode = req.to

    const body = JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: [
            `You are a professional translator for software UI strings.`,
            `Translate the following text from ${fromName} to ${toName}.`,
            ``,
            `CRITICAL RULES:`,
            `1. You MUST output ONLY the translated text in ${toName} (${toCode}). No explanations, no notes, no original text.`,
            `2. NEVER translate into any language other than ${toName}. If unsure, still output in ${toName}.`,
            `3. Preserve ALL placeholders exactly as they appear: {name}, {count}, %s, %d, %1$s, %(key)s, %{key}, \${var}, {{variable}}, @:link`,
            `4. Preserve ALL HTML tags exactly: <b>, <a href>, <br/>, etc.`,
            `5. Preserve ICU message format: {count, plural, one{...} other{...}}, {gender, select, ...}`,
            `6. Keep the translation concise and natural for native ${toName} speakers.`,
            `7. Match the tone and formality of the source text.`,
            `8. If the source text is a single word or short phrase, translate it as a UI label (not a full sentence).`,
          ].join('\n'),
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
    const translated = json?.choices?.[0]?.message?.content?.trim() || ''
    return this.validateTranslation(req.text, translated, req.to)
  }
}
