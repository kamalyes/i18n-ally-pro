import type { Webview } from 'vscode'

/** 生成 Webview 脚本 nonce（满足 VS Code CSP）。 */
export function getWebviewNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

/** 构建 Webview Content-Security-Policy，允许内联脚本（nonce）与 flag-icons CDN。 */
export function buildWebviewCsp(webview: Webview, nonce: string): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} https://cdn.jsdelivr.net 'unsafe-inline'`,
    `font-src https://cdn.jsdelivr.net`,
    `img-src ${webview.cspSource} https: data:`,
    `script-src 'nonce-${nonce}'`,
  ]
  return csp.join('; ')
}
