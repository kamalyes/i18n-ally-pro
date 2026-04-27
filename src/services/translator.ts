import { window, workspace, ProgressLocation } from 'vscode'
import { TranslationStore } from '../core/store'
import { BUILTIN_DEEPL_API_KEY, DEFAULT_CONCURRENCY } from '../core/constants'
import { Concurrency } from '../utils/concurrency'
import { BaseTranslator, TranslateRequest, TranslatorConfig } from '../translators/base'
import { GoogleTranslator } from '../translators/google'
import { DeepLTranslator } from '../translators/deepl'
import { OpenAITranslator } from '../translators/openai'
import { MicrosoftTranslator } from '../translators/microsoft'
import { DeepLWebTranslatorAdapter } from '../translators/deepl-web'
import { t } from '../i18n'

export type TranslatorEngine = 'google' | 'deepl' | 'openai' | 'microsoft' | 'deepl-web'

export interface TranslatorServiceConfig {
  engine: TranslatorEngine
  apiKey: string
  apiEndpoint?: string
  sourceLanguage: string
}

const translationCache = new Map<string, string>()

export class TranslatorService {
  private store: TranslationStore
  private translators: Map<string, BaseTranslator> = new Map()
  private deeplWebAdapter: DeepLWebTranslatorAdapter

  constructor(store: TranslationStore) {
    this.store = store
    this.deeplWebAdapter = new DeepLWebTranslatorAdapter()
    this.translators.set('google', new GoogleTranslator())
    this.translators.set('deepl', new DeepLTranslator())
    this.translators.set('openai', new OpenAITranslator())
    this.translators.set('microsoft', new MicrosoftTranslator())
  }

  getConfig(): TranslatorServiceConfig {
    const cfg = workspace.getConfiguration('i18nAllyPro')
    const userApiKey = cfg.get<string>('translatorApiKey', '')
    
    // 优先使用用户配置的API密钥，如果没有则使用内置密钥
    const effectiveApiKey = userApiKey || BUILTIN_DEEPL_API_KEY
    
    return {
      engine: cfg.get<TranslatorEngine>('translatorEngine', 'google'),
      apiKey: effectiveApiKey,
      apiEndpoint: cfg.get<string>('translatorApiEndpoint', ''),
      sourceLanguage: this.store.projectConfig.sourceLanguage,
    }
  }

  isUsingFallback(): boolean {
    const config = this.getConfig()
    // 如果有内置API密钥，则不使用fallback
    return !config.apiKey || config.engine === 'deepl-web'
  }

  getEffectiveEngine(): string {
    const config = this.getConfig()
    if (!config.apiKey || config.engine === 'deepl-web') {
      return 'deepl-web (fallback)'
    }
    return config.engine
  }

  async translateText(text: string, from: string, to: string): Promise<string> {
    const config = this.getConfig()

    const effectiveEngine = (!config.apiKey || config.engine === 'deepl-web')
      ? 'deepl-web'
      : config.engine

    const cacheKey = `${effectiveEngine}:${from}:${to}:${text}`
    const cached = translationCache.get(cacheKey)
    if (cached) return cached

    let result: string

    if (effectiveEngine === 'deepl-web') {
      result = await this.deeplWebAdapter.translate(
        { text, from, to },
        { apiKey: '', apiEndpoint: config.apiEndpoint },
      )
    } else {
      const translator = this.translators.get(effectiveEngine)
      if (!translator) {
        throw new Error(`Unknown translator engine: ${effectiveEngine}`)
      }

      const translatorConfig: TranslatorConfig = {
        apiKey: config.apiKey,
        apiEndpoint: config.apiEndpoint,
      }

      result = await translator.translate({ text, from, to }, translatorConfig)
    }

    if (result) {
      translationCache.set(cacheKey, result)
    }

    return result
  }

  async autoTranslateEmptyKeys(): Promise<{ translated: number; skipped: number; errors: number }> {
    const config = this.getConfig()
    const usingFallback = !config.apiKey || config.engine === 'deepl-web'

    if (usingFallback) {
      const proceed = await window.showInformationMessage(
        t('translator.no_api_key'),
        { modal: false },
        t('translator.continue'),
        t('translator.cancel')
      )
      if (proceed !== t('translator.continue')) {
        return { translated: 0, skipped: 0, errors: 0 }
      }
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
        title: `i18n Pro: Auto-translating (${usingFallback ? 'DeepL Web' : config.engine})`,
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
              // 询问用户是否覆盖已有值
              const shouldOverwrite = await window.showInformationMessage(
                t('translator.overwrite_prompt', key, locale, existingValue),
                { modal: true },
                t('translator.overwrite'),
                t('translator.skip'),
                t('translator.skip_all')
              )
              
              if (shouldOverwrite === t('translator.skip')) {
                skipped++
                continue
              }
              if (shouldOverwrite === t('translator.skip_all')) {
                skipped += targetLocales.length - targetLocales.indexOf(locale)
                break
              }
              // 如果用户选择"覆盖"，继续执行翻译
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

            await this.delay(usingFallback ? 500 : 200)
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

  async dispose() {
    await this.deeplWebAdapter.dispose()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
