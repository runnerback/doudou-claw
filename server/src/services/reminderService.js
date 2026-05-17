const fs = require('fs')
const path = require('path')
const cron = require('node-cron')
const bitable = require('./bitableService')
const feishuMsg = require('./feishuMsg')
const { nowLocal, TZ } = require('../utils/timeUtil')
const { computeNextTrigger, parseScheduleString, isTodayMatch } = require('../utils/cronBuilder')

const DATA_FILE = path.join(__dirname, '../../data/reminders.json')

// 内存：recordId → { reminder, job?, timeoutHandle? }
const scheduled = new Map()

// sync 节流：避免短时间内多次写操作触发并发 sync
let syncInFlight = null
let syncTimer = null

// ============================================
// 本地 JSON 缓存（已不再是真源，仅 sync 后的快照）
// ============================================
function loadLocal() {
  if (!fs.existsSync(DATA_FILE)) return []
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return [] }
}

function saveLocal(list) {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2) + '\n')
}

function findByRecordId(recordId) {
  return loadLocal().find(r => r.recordId === recordId) || null
}

// ============================================
// 匹配（delete/update 用）
// ============================================
function matchTargets(targets, chatId) {
  const list = loadLocal().filter(r => r.target === chatId && r.status === '启用')
  const matched = []
  for (const t of targets || []) {
    if (t.id) {
      const idStr = String(t.id).trim()
      const hits = list.filter(r => {
        if (!r.autoId) return false
        if (r.autoId === idStr) return true
        const numOnly = idStr.replace(/^#?TASK-?\d*-?/i, '').replace(/^#/, '')
        if (numOnly && r.autoId.endsWith(`-${numOnly.padStart(3, '0')}`)) return true
        if (numOnly && r.autoId.endsWith(`-${numOnly}`)) return true
        return false
      })
      hits.forEach(h => { if (!matched.includes(h)) matched.push(h) })
    } else if (t.title_query) {
      const q = String(t.title_query).trim().toLowerCase()
      const hits = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.content || '').toLowerCase().includes(q)
      )
      hits.forEach(h => { if (!matched.includes(h)) matched.push(h) })
    }
  }
  return matched
}

// ============================================
// 创建（写 bitable → 触发 sync）
// ============================================
async function createBatch(tasks, ctx) {
  const created = []
  const failed = []
  for (const task of tasks) {
    try {
      const reminder = await _createOne(task, ctx)
      created.push(reminder)
    } catch (e) {
      console.error('[reminder] create failed:', e.message)
      failed.push({ task, error: e.message })
    }
  }
  // 写完立即同步一次（不阻塞返回，但及时刷内存调度）
  triggerSync('after createBatch').catch(() => {})
  return { created, failed }
}

async function _createOne(task, ctx) {
  const reminder = {
    title: task.title || '未命名任务',
    content: task.content || '',
    type: task.type || 'cron',
    cron: task.cron || '',
    human: task.human || '',
    runAt: task.run_at || null,
    nextTriggerMs: computeNextTrigger(task.type, task.cron, task.run_at),
    creator: ctx.senderOpenId,
    target: ctx.chatId,
    originalMessage: ctx.originalMessage,
    status: '启用',
    createdAt: nowLocal().toISOString(),
  }
  const record = await bitable.createRecord(reminder)
  reminder.recordId = record.record_id
  reminder.autoId = record.fields?.ID || ''
  // 立即调度，不等 sync（用户体验）
  schedule(reminder)
  return reminder
}

async function createFromParsed(parsed, ctx) {
  const task = parsed.tasks?.[0] || parsed.task
  if (!task) throw new Error('no task in parsed')
  return _createOne(task, ctx)
}

// ============================================
// 编辑 / 暂停 / 删除（写 bitable → 立即取消调度 → 触发 sync）
// ============================================
async function updateReminder(recordId, updates) {
  const reminder = findByRecordId(recordId)
  if (!reminder) throw new Error('reminder not found: ' + recordId)
  const merged = { ...reminder, ...updates }
  if (updates.type || updates.cron || updates.run_at !== undefined) {
    merged.nextTriggerMs = computeNextTrigger(merged.type, merged.cron, merged.runAt || updates.run_at)
  }
  await bitable.updateRecord(recordId, {
    title: merged.title,
    content: merged.content,
    type: merged.type,
    cron: merged.cron,
    human: merged.human,
    nextTriggerMs: merged.nextTriggerMs,
  })
  schedule(merged) // 立即重新调度
  triggerSync('after update').catch(() => {})
  return merged
}

async function pauseReminder(recordId) {
  cancel(recordId)
  try { await bitable.updateRecordRaw(recordId, { '状态': '暂停' }) } catch (e) {
    console.warn('[reminder] bitable pause failed:', e.message)
  }
  triggerSync('after pause').catch(() => {})
}

async function resumeReminder(recordId) {
  try { await bitable.updateRecordRaw(recordId, { '状态': '启用' }) } catch (e) {
    console.warn('[reminder] bitable resume failed:', e.message)
  }
  triggerSync('after resume').catch(() => {})
}

async function deleteReminder(recordId) {
  cancel(recordId)
  try { await bitable.deleteRecord(recordId) } catch (e) {
    console.warn('[reminder] bitable delete failed:', e.message)
  }
  triggerSync('after delete').catch(() => {})
}

async function markEnded(recordId) {
  cancel(recordId)
  try { await bitable.updateRecordRaw(recordId, { '状态': '已结束' }) } catch (e) {
    console.warn('[reminder] markEnded bitable failed:', e.message)
  }
  triggerSync('after markEnded').catch(() => {})
}

// ============================================
// Snooze
// ============================================
function snooze(reminder, minutes) {
  console.log(`[reminder] snooze #${reminder.autoId} for ${minutes} 分钟`)
  setTimeout(() => {
    onTrigger(reminder, { snoozed: true, minutes }).catch(e => console.error('[reminder] snooze fire err:', e.message))
  }, minutes * 60 * 1000)
}

// ============================================
// 调度
// ============================================
function schedule(reminder) {
  cancel(reminder.recordId)
  if (reminder.status !== '启用') return

  if (reminder.type === 'lunar' || reminder.type === 'nth_weekday') {
    scheduleSpecialToday(reminder)
    return
  }

  if (reminder.type === 'once') {
    const triggerMs = reminder.nextTriggerMs ||
      (reminder.runAt ? new Date(reminder.runAt).getTime() : null)
    if (!triggerMs) {
      console.warn(`[reminder] once 无触发时间: #${reminder.autoId}`)
      return
    }
    const delay = triggerMs - Date.now()
    if (delay <= 0) {
      console.log(`[reminder] once 已过期，标记结束: #${reminder.autoId}`)
      markEnded(reminder.recordId).catch(() => {})
      return
    }
    const handle = setTimeout(() => {
      onTrigger(reminder).catch(e => console.error('[reminder] onTrigger err:', e.message))
    }, delay)
    scheduled.set(reminder.recordId, { reminder, handle })
    console.log(`[reminder] scheduled ONCE #${reminder.autoId} "${reminder.title}" in ${Math.round(delay / 1000)}s`)
    return
  }

  if (!reminder.cron || !cron.validate(reminder.cron)) {
    console.warn(`[reminder] 无效 cron #${reminder.autoId}: "${reminder.cron}"`)
    return
  }
  const job = cron.schedule(reminder.cron, () => {
    onTrigger(reminder).catch(e => console.error('[reminder] onTrigger err:', e.message))
  }, { timezone: TZ })
  scheduled.set(reminder.recordId, { reminder, job })
  console.log(`[reminder] scheduled #${reminder.autoId} "${reminder.title}" cron=${reminder.cron}`)
}

function scheduleSpecialToday(reminder) {
  const parsed = parseScheduleString(reminder.cron)
  if (parsed.kind !== 'lunar' && parsed.kind !== 'nth') {
    console.warn(`[reminder] special #${reminder.autoId} cron 不合法: ${reminder.cron}`)
    return
  }
  if (!isTodayMatch(parsed)) {
    // 静默：今日不命中，由 master daily job 明天再评估
    return
  }
  const today = nowLocal()
  const trigger = today.hour(parsed.hour).minute(parsed.minute).second(0).millisecond(0)
  const delay = trigger.valueOf() - Date.now()
  if (delay <= 0) return
  const startOfToday = today.startOf('day').valueOf()
  if (reminder.lastTriggerMs && reminder.lastTriggerMs >= startOfToday) return
  const handle = setTimeout(() => {
    onTrigger(reminder).catch(e => console.error('[reminder] special trigger err:', e.message))
  }, delay)
  scheduled.set(reminder.recordId, { reminder, handle })
  console.log(`[reminder] scheduled SPECIAL #${reminder.autoId} "${reminder.title}" today at ${trigger.format('HH:mm')} (in ${Math.round(delay / 1000)}s)`)
}

let masterCronJob = null
function startMasterDailyCheck() {
  if (masterCronJob) return
  const runOnce = () => {
    console.log('[reminder] master daily check fired')
    for (const r of loadLocal()) {
      if (r.status !== '启用') continue
      if (r.type !== 'lunar' && r.type !== 'nth_weekday') continue
      scheduleSpecialToday(r)
    }
  }
  runOnce()
  masterCronJob = cron.schedule('1 0 * * *', runOnce, { timezone: TZ })
  console.log('[reminder] master daily check scheduled @ 00:01')
}

function cancel(recordId) {
  const entry = scheduled.get(recordId)
  if (!entry) return
  if (entry.job) entry.job.stop()
  if (entry.handle) clearTimeout(entry.handle)
  scheduled.delete(recordId)
}

async function onTrigger(reminder, opts = {}) {
  console.log(`[reminder] FIRE #${reminder.autoId} "${reminder.title}" type=${reminder.type} → ${reminder.target}${opts.snoozed ? ' (snoozed)' : ''}`)
  try {
    // 早安总结：特殊推送
    if (reminder.type === 'morning_briefing') {
      const morningBriefing = require('./morningBriefing')
      await morningBriefing.fire(reminder, loadLocal())
      const nowMs = Date.now()
      const next = computeNextTrigger(reminder.type, reminder.cron, null)
      await bitable.updateRecordRaw(reminder.recordId, {
        '最近触发': nowMs,
        '下次触发': next || undefined,
      }).catch(e => console.warn('[morning] bitable update failed:', e.message))
      return
    }

    // 普通任务：标准触发卡片
    await feishuMsg.sendCard(reminder.target, feishuMsg.buildTriggerCard({
      recordId: reminder.recordId, autoId: reminder.autoId,
      title: reminder.title, content: reminder.content, human: reminder.human,
      isOnce: reminder.type === 'once',
      snoozed: opts.snoozed, snoozeMinutes: opts.minutes,
    }))
    if (opts.snoozed) return

    const nowMs = Date.now()
    if (reminder.type === 'once') {
      await markEnded(reminder.recordId)
    } else {
      const next = computeNextTrigger(reminder.type, reminder.cron, null)
      await bitable.updateRecordRaw(reminder.recordId, {
        '最近触发': nowMs,
        '下次触发': next || undefined,
      })
    }
  } catch (err) {
    console.error(`[reminder] trigger failed #${reminder.autoId}:`, err.message)
  }
}

// ============================================
// ⭐ 核心：从 bitable 同步到内存（真源在飞书表）
// ============================================
async function syncFromBitable(reason = 'periodic') {
  // 节流：如果已有 sync 在跑，等它完成（避免并发）
  if (syncInFlight) {
    return syncInFlight
  }
  syncInFlight = (async () => {
    const t0 = Date.now()
    try {
      const records = await bitable.listAllRecords()
      const remoteMap = new Map()
      for (const r of records) {
        remoteMap.set(r.record_id, bitable.recordToReminder(r))
      }

      // 1. 本地内存有但远端没有 → 用户在表里删了 → 取消调度
      for (const recordId of Array.from(scheduled.keys())) {
        if (!remoteMap.has(recordId)) {
          console.log(`[sync] 远端已删除 → 取消 #${recordId}`)
          cancel(recordId)
        }
      }

      // 2. 比对每个远端记录
      const newLocal = []
      let scheduledCount = 0, canceledCount = 0, unchangedCount = 0
      for (const [recordId, reminder] of remoteMap) {
        // 周期任务重算 nextTriggerMs（仅展示用）
        if (reminder.type !== 'once' && reminder.cron) {
          const next = computeNextTrigger(reminder.type, reminder.cron, null)
          if (next) reminder.nextTriggerMs = next
        }
        newLocal.push(reminder)

        const existing = scheduled.get(recordId)

        if (reminder.status === '启用') {
          if (!existing) {
            schedule(reminder)
            scheduledCount++
          } else if (hasScheduleChanged(existing.reminder, reminder)) {
            console.log(`[sync] 字段变更 → 重调度 #${reminder.autoId}`)
            schedule(reminder)
            scheduledCount++
          } else {
            unchangedCount++
          }
        } else {
          // 暂停 / 已结束 → 取消
          if (existing) {
            cancel(recordId)
            canceledCount++
          }
        }
      }
      saveLocal(newLocal)

      const dur = Date.now() - t0
      console.log(`[sync] ${reason} done in ${dur}ms: remote=${newLocal.length} scheduled=${scheduled.size} (+${scheduledCount} -${canceledCount} =${unchangedCount})`)
    } catch (err) {
      console.error(`[sync] ${reason} failed:`, err.message)
    } finally {
      syncInFlight = null
    }
  })()
  return syncInFlight
}

// 触发一次 sync，但有防抖（短时间内多次写操作合并为一次）
function triggerSync(reason) {
  if (syncTimer) clearTimeout(syncTimer)
  return new Promise(resolve => {
    syncTimer = setTimeout(() => {
      syncTimer = null
      syncFromBitable(reason).then(resolve).catch(() => resolve())
    }, 500) // 500ms 防抖，合并连续操作
  })
}

// 决定是否需要重新 schedule
function hasScheduleChanged(oldR, newR) {
  return oldR.cron !== newR.cron ||
         oldR.type !== newR.type ||
         oldR.status !== newR.status ||
         oldR.nextTriggerMs !== newR.nextTriggerMs ||
         oldR.target !== newR.target
}

// 周期 sync（60s 一次）
let periodicTimer = null
function startPeriodicSync(intervalMs = 60_000) {
  if (periodicTimer) return
  periodicTimer = setInterval(() => {
    syncFromBitable('periodic').catch(() => {})
  }, intervalMs)
  console.log(`[reminder] periodic sync started, interval=${intervalMs / 1000}s`)
}

// ============================================
// 启动入口
// ============================================
async function loadAndScheduleAll() {
  if (process.env.ENABLE_BOT !== 'true') {
    console.log('[reminder] ENABLE_BOT != true, scheduler skipped')
    return
  }
  await syncFromBitable('startup')
  startMasterDailyCheck()
  startPeriodicSync(60_000)
}

module.exports = {
  // 创建
  createBatch, createFromParsed,
  // 查找 / 匹配
  findByRecordId, matchTargets, loadLocal,
  // 编辑 / 删除
  updateReminder, pauseReminder, resumeReminder, deleteReminder, markEnded,
  // 调度
  schedule, cancel, snooze, onTrigger,
  // 同步
  syncFromBitable, triggerSync, startPeriodicSync,
  // 启动
  loadAndScheduleAll,
}
