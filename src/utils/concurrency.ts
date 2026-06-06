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
    const total = tasks.length
    const results = new Array<T>(total)
    // 结果按下标回填：原来用 results.push，返回顺序是「完成顺序」而不是入参顺序，
    // 依赖下标对齐的调用方（如 batchTranslate 把译文对回原文）会静默错位
    const settled = new Array<boolean>(total).fill(false)
    const errors: any[] = []
    let completed = 0
    let nextIndex = 0

    // 执行器函数
    const worker = async (): Promise<void> => {
      while (true) {
        // 检查取消
        if (cancellationToken?.isCancellationRequested) {
          break
        }

        const index = nextIndex++
        if (index >= total) break

        try {
          results[index] = await tasks[index]()
          settled[index] = true
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

    // 失败/未执行的位置剔除，保留入参顺序
    return results.filter((_, index) => settled[index])
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