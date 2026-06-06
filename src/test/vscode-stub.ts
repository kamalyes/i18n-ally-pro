/**
 * 测试用的最小 vscode 替身。
 *
 * core/ 与 parsers/ 的逻辑本身不依赖编辑器，但 constants / detector 会 import 'vscode'
 * 读用户配置。vitest.config.ts 把 'vscode' 指到这里，于是这些模块可以在 node 里直接跑。
 * 只补到被测代码实际用到的部分，用不到的成员故意不实现，省得掩盖真实依赖。
 */

export const workspace = {
  /** 一律返回调用方给的默认值，相当于「用户没改过任何配置」 */
  getConfiguration(_section?: string) {
    return {
      get<T>(_key: string, defaultValue?: T): T | undefined {
        return defaultValue
      },
    }
  },
  workspaceFolders: undefined as unknown,
}

export class Uri {
  private constructor(public readonly fsPath: string) {}
  static file(fsPath: string): Uri {
    return new Uri(fsPath)
  }
  toString(): string {
    return this.fsPath
  }
}

export const env = {
  language: 'en',
}
