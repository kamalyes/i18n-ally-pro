import path from 'path'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      // core/ 与 parsers/ 的测试要能在 node 里加载这些模块，用替身顶掉编辑器 API
      vscode: path.resolve(root, 'src/test/vscode-stub.ts'),
      '~': path.resolve(root, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
