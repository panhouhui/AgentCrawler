import { test, expect, describe } from 'bun:test'
import { retryAsync } from './retry'

describe('retryAsync', () => {
  test('succeeds on first attempt', async () => {
    const result = await retryAsync(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  test('retries on failure and eventually succeeds', async () => {
    let calls = 0
    const result = await retryAsync(
      async () => {
        calls++
        if (calls < 3) throw new Error('fail')
        return 'ok'
      },
      { minDelayMs: 1, maxDelayMs: 10, attempts: 5 }
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  test('throws after max attempts exhausted', async () => {
    let calls = 0
    await expect(
      retryAsync(
        async () => {
          calls++
          throw new Error('always fails')
        },
        { attempts: 3, minDelayMs: 1, maxDelayMs: 10 }
      )
    ).rejects.toThrow('always fails')
    expect(calls).toBe(3)
  })

  test('shouldRetry=false stops immediately', async () => {
    let calls = 0
    await expect(
      retryAsync(
        async () => {
          calls++
          throw new Error('non-retryable')
        },
        { attempts: 5, minDelayMs: 1, maxDelayMs: 10, shouldRetry: () => false }
      )
    ).rejects.toThrow('non-retryable')
    expect(calls).toBe(1)
  })

  test('calls onRetry callback with attempt info', async () => {
    const retryInfos: Array<{ attempt: number }> = []
    let calls = 0
    await retryAsync(
      async () => {
        calls++
        if (calls < 3) throw new Error('fail')
        return 'done'
      },
      {
        attempts: 5,
        minDelayMs: 1,
        maxDelayMs: 10,
        onRetry: (info) => retryInfos.push({ attempt: info.attempt }),
      }
    )
    expect(retryInfos).toHaveLength(2)
    expect(retryInfos[0]!.attempt).toBe(1)
    expect(retryInfos[1]!.attempt).toBe(2)
  })

  test('aborts on signal', async () => {
    const controller = new AbortController()
    const promise = retryAsync(
      async () => { throw new Error('fail') },
      { attempts: 10, minDelayMs: 100, maxDelayMs: 1000, signal: controller.signal }
    )
    setTimeout(() => controller.abort(), 50)
    await expect(promise).rejects.toThrow('aborted')
  })
})
