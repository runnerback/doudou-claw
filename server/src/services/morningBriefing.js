/**
 * 早安总结：每天定点推送一张包含
 *   1. LLM 早安寄语（基于天气 + 今日任务数）
 *   2. 当前天气（wttr.in）
 *   3. 今日待触发的任务清单
 */
const { dayjs, nowLocal, TZ } = require('../utils/timeUtil')
const { parseScheduleString, isTodayMatch, computeNextTrigger } = require('../utils/cronBuilder')
const llmService = require('./llmService')
const feishuMsg = require('./feishuMsg')

// 从所有 reminders 里找今天会触发的（不含早安总结本身）
function getTodayTriggers(reminders, target) {
  const today = nowLocal()
  const startOfDay = today.startOf('day').valueOf()
  const endOfDay = today.endOf('day').valueOf()
  const list = []
  for (const r of reminders) {
    if (r.status !== '启用') continue
    if (r.target !== target) continue
    if (r.type === 'morning_briefing') continue

    let triggerMs = null

    if (r.type === 'once') {
      if (r.nextTriggerMs && r.nextTriggerMs >= startOfDay && r.nextTriggerMs <= endOfDay) {
        triggerMs = r.nextTriggerMs
      }
    } else if (r.type === 'lunar' || r.type === 'nth_weekday') {
      const parsed = parseScheduleString(r.cron)
      if ((parsed.kind === 'lunar' || parsed.kind === 'nth') && isTodayMatch(parsed)) {
        triggerMs = today.hour(parsed.hour).minute(parsed.minute).second(0).millisecond(0).valueOf()
      }
    } else if (r.cron) {
      // 标准 cron：用 next，落今日才算
      const next = computeNextTrigger(r.type, r.cron, null)
      if (next && next >= startOfDay && next <= endOfDay) {
        triggerMs = next
      }
    }

    if (triggerMs) list.push({ ...r, todayTriggerMs: triggerMs })
  }
  return list.sort((a, b) => a.todayTriggerMs - b.todayTriggerMs)
}

// 天气缓存（30 分钟 TTL），避免每次 chat 都 fetch
const _weatherCache = { ts: 0, city: '', data: null }
async function getWeatherCached(city) {
  city = city || 'Shanghai'
  if (_weatherCache.city === city && _weatherCache.data && Date.now() - _weatherCache.ts < 30 * 60 * 1000) {
    return _weatherCache.data
  }
  const data = await getWeather(city)
  if (data) {
    _weatherCache.data = data
    _weatherCache.city = city
    _weatherCache.ts = Date.now()
  }
  return data
}

async function getWeather(city) {
  if (!city) city = 'Shanghai'
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'QClaw/1.0', 'Accept-Language': 'zh-CN' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) throw new Error(`wttr ${res.status}`)
    const data = await res.json()
    const cur = data.current_condition?.[0] || {}
    const today = data.weather?.[0] || {}
    return {
      city,
      desc: cur?.lang_zh?.[0]?.value || cur?.weatherDesc?.[0]?.value || '',
      temp: cur?.temp_C,
      feels: cur?.FeelsLikeC,
      humidity: cur?.humidity,
      max: today?.maxtempC,
      min: today?.mintempC,
    }
  } catch (e) {
    console.warn('[morning] weather failed:', e.message)
    return null
  }
}

async function fire(reminder, allReminders) {
  const target = reminder.target
  const city = process.env.MORNING_WEATHER_CITY || 'Shanghai'

  // 并行：天气 + 今日任务（任务是本地内存，秒返）
  const [weather, tasks] = await Promise.all([
    getWeather(city),
    Promise.resolve(getTodayTriggers(allReminders, target)),
  ])

  // 农历日期辅助
  let lunarDate = ''
  try {
    const { Solar } = require('lunar-javascript')
    const l = Solar.fromDate(new Date()).getLunar()
    lunarDate = `农历${l.getMonthInChinese()}月${l.getDayInChinese()}`
  } catch {}

  // LLM 早安寄语
  let greeting = ''
  try {
    greeting = await llmService.morningGreeting({
      date: nowLocal().format('YYYY-MM-DD dddd'),
      lunarDate,
      taskCount: tasks.length,
      weather,
    })
  } catch (e) {
    console.warn('[morning] greeting failed:', e.message)
    greeting = '新的一天开始啦，加油 ✨'
  }

  const card = feishuMsg.buildMorningCard({
    greeting, weather, tasks, lunarDate,
  })
  await feishuMsg.sendCard(target, card)
  console.log(`[morning] sent to ${target}, tasks=${tasks.length}, weather=${weather ? weather.desc : 'n/a'}`)
}

module.exports = { fire, getTodayTriggers, getWeather, getWeatherCached }
