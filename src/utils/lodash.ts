export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

export function flatten<T>(arr: (T | T[])[]): T[] {
  const result: T[] = []
  for (const item of arr) {
    if (Array.isArray(item))
      result.push(...item)
    else
      result.push(item)
  }
  return result
}

export function get(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

export function groupBy<T>(arr: T[], fn: ((item: T) => string) | string): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of arr) {
    const key = typeof fn === 'string' ? (item as any)[fn] : fn(item)
    if (!result[key]) result[key] = []
    result[key].push(item)
  }
  return result
}

export function sortBy<T>(arr: T[], ...iteratees: (((item: T) => any) | string)[]): T[] {
  return [...arr].sort((a, b) => {
    for (const it of iteratees) {
      const fn = typeof it === 'string' ? (item: T) => get(item, it) : it
      const va = fn(a)
      const vb = fn(b)
      if (va < vb) return -1
      if (va > vb) return 1
    }
    return 0
  })
}
