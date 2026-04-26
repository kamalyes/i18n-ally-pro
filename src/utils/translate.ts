import { execSync } from 'child_process'
import fs from 'fs'

type Browser = any
type Page = any

async function getPlaywright() {
  try {
    return await import('playwright')
  } catch {
    throw new Error('playwright package is not installed. Run: npm install playwright')
  }
}

const SUPPORTED_LANGUAGES = [
  'AR', 'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'EN-GB', 'EN-US',
  'ES', 'ET', 'FI', 'FR', 'HE', 'HU', 'ID', 'IT', 'JA', 'KO',
  'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'PT-BR', 'PT-PT', 'RO',
  'RU', 'SK', 'SL', 'SV', 'TH', 'TR', 'UK', 'VI', 'ZH',
  'ZH-HANS', 'ZH-HANT',
]

const LOCALE_TO_DEEPL: Record<string, string> = {
  'ar': 'AR', 'bg': 'BG', 'cs': 'CS', 'da': 'DA', 'de': 'DE',
  'el': 'EL', 'en': 'EN', 'en-gb': 'EN-GB', 'en-us': 'EN-US',
  'es': 'ES', 'et': 'ET', 'fi': 'FI', 'fr': 'FR', 'he': 'HE',
  'hu': 'HU', 'id': 'ID', 'it': 'IT', 'ja': 'JA', 'ko': 'KO',
  'lt': 'LT', 'lv': 'LV', 'nb': 'NB', 'nl': 'NL', 'pl': 'PL',
  'pt': 'PT', 'pt-br': 'PT-BR', 'pt-pt': 'PT-PT', 'ro': 'RO',
  'ru': 'RU', 'sk': 'SK', 'sl': 'SL', 'sv': 'SV', 'th': 'TH',
  'tr': 'TR', 'uk': 'UK', 'vi': 'VI', 'zh': 'ZH',
  'zh-cn': 'ZH-HANS', 'zh-hans': 'ZH-HANS',
  'zh-tw': 'ZH-HANT', 'zh-hant': 'ZH-HANT',
}

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--lang=en',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=VizDisplayCompositor',
  '--disable-web-security',
  '--disable-features=TranslateUI',
  '--disable-extensions',
]

export interface DeepLWebResult {
  text: string
  sourceLang: string
  targetLang: string
}

export class DeepLWebTranslator {
  private browser: Browser | null = null
  private page: Page | null = null
  private lastTargetLang: string | null = null
  private initializing: Promise<Browser> | null = null

  static getSupportedLanguages(): string[] {
    return [...SUPPORTED_LANGUAGES]
  }

  static toDeepLLocale(locale: string): string {
    const lower = locale.toLowerCase()
    if (LOCALE_TO_DEEPL[lower]) return LOCALE_TO_DEEPL[lower]
    return locale.toUpperCase().split('-')[0]
  }

  static isLanguageSupported(locale: string): boolean {
    const deeplCode = DeepLWebTranslator.toDeepLLocale(locale)
    return SUPPORTED_LANGUAGES.includes(deeplCode)
  }

  async translate(text: string, targetLang: string): Promise<DeepLWebResult> {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('text must be a non-empty string')
    }
    if (text.length > 5000) {
      throw new Error('text length cannot exceed 5000 characters')
    }

    const deeplTargetLang = DeepLWebTranslator.toDeepLLocale(targetLang)
    const browser = await this.getBrowser()
    let page: Page

    try {
      page = await this.getOrCreatePage(browser, deeplTargetLang)

      await page.waitForSelector('[data-testid="translator-source-input"]', { timeout: 8000 })

      const inputSelector = '[data-testid="translator-source-input"]'
      await page.click(inputSelector)
      await page.type(inputSelector, text, { delay: 2 })

      await page.evaluate(() => {
        (window as any).__deepl_last_text = ''
        ;(window as any).__deepl_stable_count = 0
      })

      const handle = await page.waitForFunction(
        ({ inputText }: { inputText: string }) => {
          const STABLE_ITERATIONS = 2
          const selector = '[data-testid="translator-target-input"]'
          const element = document.querySelector(selector) as HTMLElement | null
          const currentText = element ? element.innerText.trim() : ''

          const isTranslating =
            document.querySelector('[data-testid="translator-loading"]') ||
            document.querySelector('.lmt__textarea_loading') ||
            element?.classList?.contains('loading')

          if (isTranslating) {
            (window as any).__deepl_stable_count = 0
            ;(window as any).__deepl_last_text = currentText
            return false
          }

          const isMeaningful =
            currentText &&
            currentText.length > 0 &&
            currentText !== '翻译结果' &&
            currentText !== inputText &&
            (inputText.length <= 2 || currentText.length > 1)

          const isLikelyComplete =
            isMeaningful &&
            currentText.length >= Math.min(inputText.length * 0.5, 10) &&
            !currentText.endsWith('...')

          if (isMeaningful && currentText === (window as any).__deepl_last_text) {
            ;(window as any).__deepl_stable_count++
            if (isLikelyComplete && (window as any).__deepl_stable_count >= 1) {
              (window as any).__deepl_stable_count = STABLE_ITERATIONS
            }
          } else {
            ;(window as any).__deepl_stable_count = 0
          }

          ;(window as any).__deepl_last_text = currentText || ''

          if ((window as any).__deepl_stable_count >= STABLE_ITERATIONS) {
            return currentText
          }

          return false
        },
        { inputText: text },
        { timeout: 20000, polling: 50 }
      )

      const translatedText = await handle.jsonValue() as string

      if (!translatedText || typeof translatedText !== 'string' || translatedText.trim().length === 0) {
        throw new Error('translation result is empty')
      }

      let detectedSourceLang = 'AUTO'
      try {
        const sourceLangElement = await page.$('[data-testid="translator-source-lang"]')
        if (sourceLangElement) {
          detectedSourceLang = ((await sourceLangElement.textContent()) || 'AUTO').toUpperCase()
        }
      } catch { /* ignore */ }

      return {
        text: translatedText,
        sourceLang: detectedSourceLang,
        targetLang: deeplTargetLang,
      }
    } catch (err: any) {
      if (this.page && !this.page.isClosed()) {
        try {
          await this.page.close()
        } catch { /* ignore */ }
      }
      this.page = null
      this.lastTargetLang = null
      throw new Error(`DeepL web translation failed: ${err.message || 'unknown error'}`)
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch { /* ignore */ }
      this.browser = null
      this.page = null
      this.lastTargetLang = null
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser

    if (this.initializing) return this.initializing

    this.initializing = this.initBrowser()
    try {
      return await this.initializing
    } catch (err) {
      this.initializing = null
      throw err
    }
  }

  private async initBrowser(): Promise<Browser> {
    const chromePath = this.findChromePath()
    const { chromium } = await getPlaywright()

    if (chromePath) {
      this.browser = await chromium.launch({
        headless: true,
        executablePath: chromePath,
        args: BROWSER_ARGS,
      })
      return this.browser
    }

    try {
      this.browser = await this.launchPlaywrightChromium()
      return this.browser
    } catch (err: any) {
      throw new Error(
        'No Chrome/Chromium browser found. Please install Google Chrome or run: npx playwright install chromium'
      )
    }
  }

  private async getOrCreatePage(browser: Browser, deeplTargetLang: string): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.lastTargetLang === deeplTargetLang) {
      const clearButton = await this.page.$('[data-testid="translator-source-clear-button"]')
      if (clearButton) {
        await clearButton.click()
        try {
          await this.page.waitForFunction(
            () => {
              const target = document.querySelector('[data-testid="translator-target-input"]') as HTMLElement
              return target && target.innerText.trim() === ''
            },
            { timeout: 2000 }
          )
        } catch { /* ignore timeout */ }
      }
      return this.page
    }

    if (this.page && !this.page.isClosed()) {
      await this.page.close()
    }

    const page = await browser.newPage()
    this.page = page
    this.lastTargetLang = deeplTargetLang

    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    })

    const url = `https://www.deepl.com/translator#auto/${deeplTargetLang}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForSelector('[data-testid="translator-source-input"]', { timeout: 8000 })

    return page
  }

  private findChromePath(): string | null {
    const platform = process.platform
    let possiblePaths: string[] = []

    switch (platform) {
      case 'win32':
        possiblePaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
          process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
          process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
          process.env.USERPROFILE + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files\\Chromium\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
          process.env.LOCALAPPDATA + '\\Chromium\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
        break
      case 'darwin':
        possiblePaths = [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
          process.env.HOME + '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          process.env.HOME + '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
        break
      case 'linux':
        possiblePaths = [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome-beta',
          '/opt/google/chrome/chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
          '/usr/bin/brave-browser',
          '/usr/bin/microsoft-edge',
          '/usr/bin/microsoft-edge-stable',
        ]
        break
      default:
        possiblePaths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser']
    }

    for (const chromePath of possiblePaths) {
      if (chromePath && fs.existsSync(chromePath)) {
        return chromePath
      }
    }

    try {
      let result = ''
      switch (platform) {
        case 'win32':
          try { result = execSync('where chrome', { encoding: 'utf8' }).trim() }
          catch {
            try { result = execSync('where chromium', { encoding: 'utf8' }).trim() }
            catch { /* ignore */ }
          }
          break
        case 'darwin':
          try { result = execSync('which google-chrome', { encoding: 'utf8' }).trim() }
          catch {
            try {
              result = execSync("mdfind \"kMDItemCFBundleIdentifier == 'com.google.Chrome'\" | head -1", { encoding: 'utf8' }).trim()
              if (result) result = result + '/Contents/MacOS/Google Chrome'
            } catch { /* ignore */ }
          }
          break
        case 'linux':
          try { result = execSync('which google-chrome', { encoding: 'utf8' }).trim() }
          catch {
            try { result = execSync('which chromium-browser', { encoding: 'utf8' }).trim() }
            catch { /* ignore */ }
          }
          break
      }
      if (result && fs.existsSync(result)) return result
    } catch { /* ignore */ }

    return null
  }

  private async launchPlaywrightChromium(): Promise<Browser> {
    const { chromium } = await getPlaywright()
    try {
      const browser = await chromium.launch({
        headless: true,
        args: BROWSER_ARGS,
      })
      return browser
    } catch (error: any) {
      if (error.message?.includes("Executable doesn't exist")) {
        try {
          execSync('npx playwright install chromium', {
            stdio: 'pipe',
            timeout: 300000,
          })
          const browser = await chromium.launch({
            headless: true,
            args: BROWSER_ARGS,
          })
          return browser
        } catch {
          throw new Error('Failed to install Playwright Chromium. Run manually: npx playwright install chromium')
        }
      }
      throw error
    }
  }
}
