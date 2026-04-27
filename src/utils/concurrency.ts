/**
 * 并发控制工具类
 */
export class Concurrency {
  /**
   * 并发执行异步任务（支持取消）
   * @param tasks 异步任务数组
   * @param concurrency 并发数量，默认5
   * @param onProgress 进度回调
   * @param cancellationToken 取消令牌
   */
  static async run<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number = 5,
    onProgress?: (completed: number, total: number) => void,
    cancellationToken?: { isCancellationRequested: boolean }
  ): Promise<T[]> {
    const results: T[] = []
    const errors: any[] = []
    let completed = 0
    const total = tasks.length

    // 创建任务队列
    const queue = [...tasks]

    // 执行器函数
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        // 检查取消
        if (cancellationToken?.isCancellationRequested) {
          break
        }
        
        const task = queue.shift()!
        try {
          const result = await task()
          results.push(result)
        } catch (error) {
          errors.push(error)
        } finally {
          completed++
          onProgress?.(completed, total)
        }
      }
    }

    // 创建并发工作器
    const workers = Array(Math.min(concurrency, total))
      .fill(null)
      .map(() => worker())

    // 等待所有工作器完成
    await Promise.all(workers)

    if (errors.length > 0) {
      console.warn(`并发执行完成，有 ${errors.length} 个错误`)
    }

    return results
  }

  /**
   * 批量翻译文本（支持取消）
   * @param texts 要翻译的文本数组
   * @param translateFn 翻译函数
   * @param concurrency 并发数量，默认3（避免API限制）
   * @param cancellationToken 取消令牌
   */
  static async batchTranslate(
    texts: string[],
    translateFn: (text: string, index: number) => Promise<string>,
    concurrency: number = 3,
    cancellationToken?: { isCancellationRequested: boolean }
  ): Promise<string[]> {
    const tasks = texts.map((text, index) => async () => {
      try {
        return await translateFn(text, index)
      } catch (error) {
        console.warn(`翻译失败: ${text}`, error)
        return '' // 翻译失败返回空字符串
      }
    })

    return this.run(tasks, concurrency, undefined, cancellationToken)
  }

  /**
   * 批量处理文件操作（支持取消）
   * @param files 文件路径数组
   * @param processFn 处理函数
   * @param concurrency 并发数量，默认10
   * @param cancellationToken 取消令牌
   */
  static async batchProcessFiles<T>(
    files: string[],
    processFn: (file: string, index: number) => Promise<T>,
    concurrency: number = 10,
    cancellationToken?: { isCancellationRequested: boolean }
  ): Promise<T[]> {
    const tasks = files.map((file, index) => async () => {
      try {
        return await processFn(file, index)
      } catch (error) {
        console.warn(`文件处理失败: ${file}`, error)
        throw error // 文件操作失败抛出错误
      }
    })

    return this.run(tasks, concurrency, undefined, cancellationToken)
  }

  /**
   * 创建可暂停的翻译任务
   */
  static createPausableTask<T>(
    task: () => Promise<T>,
    pauseSignal: { paused: boolean }
  ): () => Promise<T> {
    return async () => {
      // 等待暂停状态解除
      while (pauseSignal.paused) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return await task()
    }
  }
}