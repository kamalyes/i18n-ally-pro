import { TranslateRequest, TranslatorConfig } from './base'

export class DeepLWebTranslatorAdapter {
  private webTranslator: any | null = null

  async translate(req: TranslateRequest, _config: TranslatorConfig): Promise<string> {
    const translator = await this.getWebTranslator()
    const result = await translator.translate(req.text, req.to)
    return result.text
  }

  private async getWebTranslator(): Promise<any> {
    if (!this.webTranslator) {
      try {
        const { DeepLWebTranslator } = await import('../utils/translate')
        this.webTranslator = new DeepLWebTranslator()
      } catch (err: any) {
        throw new Error('DeepL Web translation requires the playwright package. Install it with: npm install playwright')
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
