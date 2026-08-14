import type { CronSchedule } from './types'
import { Cron } from 'croner'

export function computeNextRunAt(
  schedule: CronSchedule,
  nowMs: number
): number | undefined {
  if (schedule.kind === 'at') {
    const ts = new Date(schedule.at).getTime()
    return ts > nowMs ? ts : undefined
  }

  if (schedule.kind === 'every') {
    return nowMs + schedule.everyMs
  }

  if (schedule.kind === 'cron') {
    try {
      const job = new Cron(schedule.expr, {
        timezone: schedule.tz,
      })
      const next = job.nextRun(new Date(nowMs))
      return next ? next.getTime() : undefined
    } catch {
      return undefined
    }
  }

  return undefined
}

export function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'at') {
    return `once at ${schedule.at}`
  }

  if (schedule.kind === 'every') {
    const seconds = Math.floor(schedule.everyMs / 1000)
    if (seconds < 60) return `every ${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `every ${minutes}m`
    const hours = Math.floor(minutes / 60)
    return `every ${hours}h`
  }

  if (schedule.kind === 'cron') {
    return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`
  }

  return 'unknown'
}
