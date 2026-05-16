const cron = require('node-cron')
const { Lunar, Solar } = require('lunar-javascript')
const { dayjs, TZ } = require('./timeUtil')

/**
 * 调度字符串格式：
 *   1. 标准 cron 5 字段："0 9 * * 1-5"            (daily/weekly/monthly/yearly/workday/cron)
 *   2. 农历："lunar:M-D HH:MM"，如 "lunar:9-27 09:00"  (lunar)
 *   3. 每月第N周X："nth:M-W-N HH:MM"，M 可以是 *
 *      W: 0=周日 ... 6=周六
 *      N: 1~5 表示第N个；-1 表示最后一个
 *      例："nth:5-0-2 09:00" = 每年 5 月第二个周日 09:00
 *      例："nth:*-5--1 17:00" = 每月最后一个周五 17:00
 */
function parseScheduleString(s) {
  if (!s || typeof s !== 'string') return { kind: 'invalid' }
  s = s.trim()

  if (s.startsWith('lunar:')) {
    const m = s.match(/^lunar:(\d+)-(\d+)\s+(\d{1,2}):(\d{1,2})$/)
    if (!m) return { kind: 'invalid', reason: 'lunar format' }
    return {
      kind: 'lunar',
      month: +m[1], day: +m[2],
      hour: +m[3], minute: +m[4],
    }
  }

  if (s.startsWith('nth:')) {
    const m = s.match(/^nth:(\*|\d+)-(\d+)-(-?\d+)\s+(\d{1,2}):(\d{1,2})$/)
    if (!m) return { kind: 'invalid', reason: 'nth format' }
    return {
      kind: 'nth',
      month: m[1] === '*' ? null : +m[1],
      weekday: +m[2],
      nth: +m[3],
      hour: +m[4], minute: +m[5],
    }
  }

  if (cron.validate(s)) {
    return { kind: 'cron', expr: s }
  }
  return { kind: 'invalid', reason: 'unknown' }
}

/** 判断今天是否匹配 lunar / nth 规则 */
function isTodayMatch(parsed, date = new Date()) {
  if (parsed.kind === 'lunar') {
    try {
      const lunar = Solar.fromDate(date).getLunar()
      // getMonth 闰月返回负数；这里只匹配正常月（暂不支持闰月触发）
      return lunar.getMonth() === parsed.month && lunar.getDay() === parsed.day
    } catch (e) {
      console.warn('[cronBuilder] lunar match err:', e.message)
      return false
    }
  }
  if (parsed.kind === 'nth') {
    if (parsed.month !== null && date.getMonth() + 1 !== parsed.month) return false
    if (date.getDay() !== parsed.weekday) return false
    const day = date.getDate()
    if (parsed.nth === -1) {
      // 是否当月最后一个该周X
      const next7 = new Date(date.getFullYear(), date.getMonth(), day + 7)
      return next7.getMonth() !== date.getMonth()
    }
    return Math.ceil(day / 7) === parsed.nth
  }
  return false
}

/** 在指定年月里找第 nth 个 weekday，返回日期数字；找不到返回 null */
function findNthWeekday(year, monthIdx, weekday, nth) {
  // monthIdx: 0-11
  if (nth === -1) {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate()
    for (let day = lastDay; day >= lastDay - 6; day--) {
      if (new Date(year, monthIdx, day).getDay() === weekday) return day
    }
    return null
  }
  let count = 0
  const lastDay = new Date(year, monthIdx + 1, 0).getDate()
  for (let day = 1; day <= lastDay; day++) {
    if (new Date(year, monthIdx, day).getDay() === weekday) {
      count++
      if (count === nth) return day
    }
  }
  return null
}

/** 计算下次触发的 ms 时间戳（用于 "下次触发" 字段展示） */
function computeNextTrigger(type, scheduleStr, runAt) {
  if (type === 'once') {
    if (!runAt) return null
    return new Date(runAt).getTime()
  }

  const parsed = parseScheduleString(scheduleStr)
  if (parsed.kind === 'invalid') return null

  if (parsed.kind === 'cron') {
    // 5 字段扫描法（按分钟，最多扫 366 天）
    return scanCronNext(parsed.expr)
  }

  if (parsed.kind === 'lunar') {
    const now = dayjs().tz(TZ)
    for (let yi = 0; yi < 5; yi++) {
      try {
        const solar = Lunar.fromYmd(now.year() + yi, parsed.month, parsed.day).getSolar()
        const d = dayjs.tz(
          `${solar.getYear()}-${pad(solar.getMonth())}-${pad(solar.getDay())} ${pad(parsed.hour)}:${pad(parsed.minute)}`,
          'YYYY-MM-DD HH:mm', TZ
        )
        if (d.valueOf() > Date.now()) return d.valueOf()
      } catch {
        // 农历日不存在该年（如闰月 30 日），继续下一年
      }
    }
    return null
  }

  if (parsed.kind === 'nth') {
    const now = dayjs().tz(TZ)
    const months = parsed.month !== null ? [parsed.month] : Array.from({ length: 12 }, (_, i) => i + 1)
    for (let yi = 0; yi < 2; yi++) {
      const year = now.year() + yi
      for (const m of months) {
        const day = findNthWeekday(year, m - 1, parsed.weekday, parsed.nth)
        if (!day) continue
        const d = dayjs.tz(
          `${year}-${pad(m)}-${pad(day)} ${pad(parsed.hour)}:${pad(parsed.minute)}`,
          'YYYY-MM-DD HH:mm', TZ
        )
        if (d.valueOf() > Date.now()) return d.valueOf()
      }
    }
    return null
  }

  return null
}

function scanCronNext(expr) {
  const parts = expr.split(/\s+/)
  if (parts.length !== 5) return null
  const [minP, hourP, dayP, monthP, dowP] = parts

  const start = dayjs().tz(TZ).add(1, 'minute').startOf('minute')
  const MAX = 60 * 24 * 366
  for (let i = 0; i < MAX; i++) {
    const t = start.add(i, 'minute')
    if (
      matchField(minP, t.minute()) &&
      matchField(hourP, t.hour()) &&
      matchField(dayP, t.date()) &&
      matchField(monthP, t.month() + 1) &&
      matchField(dowP, t.day())
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

function pad(n) { return String(n).padStart(2, '0') }

module.exports = {
  parseScheduleString, isTodayMatch, computeNextTrigger, findNthWeekday,
}
