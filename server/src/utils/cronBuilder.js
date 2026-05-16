const cron = require('node-cron')
const { dayjs, TZ } = require('./timeUtil')

/**
 * 估算 cron 表达式的下次触发时间戳（ms）
 * 算法：从当前分钟往后扫，最多扫 366 天，找到第一个匹配所有字段的分钟
 * once 类型直接返回 runAt
 */
function computeNextTrigger(type, cronExpr, runAt) {
  if (type === 'once') {
    if (!runAt) return null
    return new Date(runAt).getTime()
  }
  if (!cronExpr) return null
  if (!cron.validate(cronExpr)) return null

  const parts = cronExpr.split(/\s+/)
  if (parts.length !== 5) return null
  const [minPart, hourPart, dayPart, monthPart, dowPart] = parts

  // 起点：下一个整分钟
  const start = dayjs().tz(TZ).add(1, 'minute').startOf('minute')
  const MAX = 60 * 24 * 366
  for (let i = 0; i < MAX; i++) {
    const t = start.add(i, 'minute')
    if (
      matchField(minPart, t.minute()) &&
      matchField(hourPart, t.hour()) &&
      matchField(dayPart, t.date()) &&
      matchField(monthPart, t.month() + 1) &&
      matchField(dowPart, t.day())
    ) {
      return t.valueOf()
    }
  }
  return null
}

function matchField(part, val) {
  if (part === '*') return true
  for (const seg of part.split(',')) {
    if (seg.includes('/')) {
      const [base, stepStr] = seg.split('/')
      const step = Number(stepStr)
      if (base === '*') {
        if (val % step === 0) return true
      } else if (base.includes('-')) {
        const [a, b] = base.split('-').map(Number)
        for (let v = a; v <= b; v += step) {
          if (v === val) return true
        }
      } else {
        const startN = Number(base)
        if (val >= startN && (val - startN) % step === 0) return true
      }
    } else if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(Number)
      if (val >= a && val <= b) return true
    } else if (Number(seg) === val) {
      return true
    }
  }
  return false
}

module.exports = { computeNextTrigger }
