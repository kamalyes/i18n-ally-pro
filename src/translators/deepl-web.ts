import { BaseTranslator, TranslateRequest, TranslatorConfig } from './base'

export class DeepLWebTranslatorAdapter {
  private webTranslator: any | null = null
  private validator: BaseTranslator

  constructor() {
    this.validator = new class extends BaseTranslator {
      async translate() { return '' }
    }()
  }

  async translate(req: TranslateRequest, _config: TranslatorConfig): Promise<string> {
    const translator = await this.getWebTranslator()
    const result = await translator.translate(req.text, req.to, req.from)
    const translated = result.text
    return this.validator.validateTranslation(req.text, translated, req.to)
  }

  private async getWebTranslator(): Promise<any> {
    if (!this.webTranslator) {
      try {
        const { DeepLWebTranslator } = await import('../utils/translate')
        this.webTranslator = new DeepLWebTranslator()
      } catch (err: any) {
        throw new Error('DeepL Web translation requires the playwright package. Install it with: npx playwright install')
      }
    }
    return this.webTranslator
  }

  async dispose(): Promise<void> {
    if (this.webTranslator) {
      try {
        await this.webTranslator.cleanup()
      } catch { /* ignore */ }
      this.webTranslator = null
    }
  }
}
