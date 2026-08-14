import { test, expect, describe } from 'bun:test'
import { computeNextRunAt, formatSchedule } from './schedule'
import type { CronSchedule } from './types'

describe('computeNextRunAt', () => {
  const now = Date.now()

  test('at schedule - future returns timestamp', () => {
    const future = new Date(now + 60_000).toISOString()
    const schedule: CronSchedule = { kind: 'at', at: future }
    const result = computeNextRunAt(schedule, now)
    expect(result).toBeDefined()
    expect(result!).toBeGreaterThan(now)
  })

  test('at schedule - past returns undefined', () => {
    const past = new Date(now - 60_000).toISOString()
    const schedule: CronSchedule = { kind: 'at', at: past }
    const result = computeNextRunAt(schedule, now)
    expect(result).toBeUndefined()
  })

  test('every schedule returns now + interval', () => {
    const schedule: CronSchedule = { kind: 'every', everyMs: 3600_000 }
    const result = computeNextRunAt(schedule, now)
    expect(result).toBe(now + 3600_000)
  })

  test('cron schedule returns valid next time', () => {
    const schedule: CronSchedule = { kind: 'cron', expr: '* * * * *' }
    const result = computeNextRunAt(schedule, now)
    expect(result).toBeDefined()
    expect(result!).toBeGreaterThan(now)
    expect(result! - now).toBeLessThanOrEqual(60_000)
  })

  test('cron schedule with invalid expr returns undefined', () => {
    const schedule: CronSchedule = { kind: 'cron', expr: 'invalid' }
    const result = computeNextRunAt(schedule, now)
    expect(result).toBeUndefined()
  })
})

describe('formatSchedule', () => {
  test('at schedule', () => {
    const result = formatSchedule({ kind: 'at', at: '2026-01-01T00:00:00Z' })
    expect(result).toContain('once at')
  })

  test('every seconds', () => {
    const result = formatSchedule({ kind: 'every', everyMs: 30_000 })
    expect(result).toBe('every 30s')
  })

  test('every minutes', () => {
    const result = formatSchedule({ kind: 'every', everyMs: 300_000 })
    expect(result).toBe('every 5m')
  })

  test('every hours', () => {
    const result = formatSchedule({ kind: 'every', everyMs: 7_200_000 })
    expect(result).toBe('every 2h')
  })

  test('cron schedule', () => {
    const result = formatSchedule({ kind: 'cron', expr: '0 * * * *' })
    expect(result).toBe('cron: 0 * * * *')
  })

  test('cron schedule with timezone', () => {
    const result = formatSchedule({ kind: 'cron', expr: '0 9 * * *', tz: 'America/New_York' })
    expect(result).toBe('cron: 0 9 * * * (America/New_York)')
  })
})
