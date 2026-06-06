import { describe, expect, it } from 'vitest'
import { Concurrency } from './concurrency'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('Concurrency.run', () => {
  // 回归：原来用 results.push 收集，返回的是「完成顺序」而不是入参顺序。
  // 先提交的慢任务会排在后提交的快任务之后，依赖下标对齐的调用方会静默错位。
  it('按入参顺序返回结果，与完成顺序无关', async () => {
    const tasks = [
      async () => { await delay(30); return 'a' },
      async () => { await delay(1); return 'b' },
      async () => { await delay(15); return 'c' },
    ]

    expect(await Concurrency.run(tasks, 3)).toEqual(['a', 'b', 'c'])
  })

  it('每个任务只执行一次', async () => {
    let calls = 0
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      calls++
      await delay(1)
      return i
    })

    expect(await Concurrency.run(tasks, 4)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(calls).toBe(20)
  })

  it('剔除失败的任务但保持其余顺序', async () => {
    const tasks = [
      async () => 'a',
      async () => { throw new Error('boom') },
      async () => 'c',
    ]

    expect(await Concurrency.run(tasks, 2)).toEqual(['a', 'c'])
  })

  it('并发数不超过上限', async () => {
    let running = 0
    let peak = 0
    const tasks = Array.from({ length: 12 }, () => async () => {
      running++
      peak = Math.max(peak, running)
      await delay(5)
      running--
      return true
    })

    await Concurrency.run(tasks, 3)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('上报进度直到全部完成', async () => {
    const seen: number[] = []
    const tasks = Array.from({ length: 5 }, (_, i) => async () => i)

    await Concurrency.run(tasks, 2, completed => seen.push(completed))
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('取消后不再启动新任务', async () => {
    let started = 0
    const token = { isCancellationRequested: false }
    const tasks = Array.from({ length: 50 }, () => async () => {
      started++
      if (started >= 3) token.isCancellationRequested = true
      await delay(1)
      return true
    })

    await Concurrency.run(tasks, 1, undefined, token)
    expect(started).toBeLessThan(50)
  })

  it('空任务数组直接返回空结果', async () => {
    expect(await Concurrency.run([], 5)).toEqual([])
  })
})

describe('Concurrency.batchTranslate', () => {
  it('译文与原文按下标对齐', async () => {
    const texts = ['slow', 'fast', 'mid']
    const delays: Record<string, number> = { slow: 30, fast: 1, mid: 15 }

    const results = await Concurrency.batchTranslate(texts, async text => {
      await delay(delays[text])
      return `${text}-translated`
    }, 3)

    expect(results).toEqual(['slow-translated', 'fast-translated', 'mid-translated'])
  })

  it('单条失败不会让后续译文错位', async () => {
    const results = await Concurrency.batchTranslate(['a', 'b', 'c'], async text => {
      if (text === 'b') throw new Error('boom')
      return `${text}!`
    }, 2)

    expect(results).toEqual(['a!', '', 'c!'])
  })
})
