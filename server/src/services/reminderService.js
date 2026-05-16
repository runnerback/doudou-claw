const fs = require('fs')
const path = require('path')
const cron = require('node-cron')
const bitable = require('./bitableService')
const feishuMsg = require('./feishuMsg')
const { nowLocal, TZ } = require('../utils/timeUtil')
const { computeNextTrigger } = require('../utils/cronBuilder')

const DATA_FILE = path.join(__dirname, '../../data/reminders.json')

// 内存：recordId → { reminder, job?, timeoutHandle? }
const scheduled = new Map()

// ============================================
// 本地 JSON 持久化
// ============================================
function loadLocal() {
  if (!fs.existsSync(DATA_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveLocal(list) {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2) + '\n')
}

function upsertLocal(reminder) {
  const list = loadLocal()
  const idx = list.findIndex(r => r.recordId === reminder.recordId)
  if (idx >= 0) list[idx] = reminder
  else list.push(reminder)
  saveLocal(list)
}

function removeLocalById(recordId) {
  const list = loadLocal().filter(r => r.recordId !== recordId)
  saveLocal(list)
}

function updateLocalFields(recordId, partial) {
  const list = loadLocal()
  const idx = list.findIndex(r => r.recordId === recordId)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...partial }
    saveLocal(list)
  }
}

// ============================================
// 查找 / 匹配
// ============================================
function findByRecordId(recordId) {
  return loadLocal().find(r => r.recordId === recordId) || null
}

function matchTargets(targets, chatId) {
  // 用 LLM 解析的 targets（含 id 或 title_query）找到候选 reminders
  const list = loadLocal().filter(r => r.target === chatId && r.status === '启用')
  const matched = []
  for (const t of targets || []) {
    if (t.id) {
      // 按 autoId 前缀/精确匹配，或者用户引用的 #数字
      const idStr = String(t.id).trim()
      const hits = list.filter(r => {
        if (!r.autoId) return false
        if (r.autoId === idStr) return true
        // 用户可能只输入 "5" 或 "#5"
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
// 创建（支持批量）
// ============================================
async function createBatch(tasks, ctx) {
  // ctx = { senderOpenId, chatId, originalMessage }
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

  upsertLocal(reminder)
  schedule(reminder)
  return reminder
}

// 老接口（兼容）
async function createFromParsed(parsed, ctx) {
  const task = parsed.tasks?.[0] || parsed.task
  if (!task) throw new Error('no task in parsed')
  return _createOne(task, ctx)
}

// ============================================
// 编辑 / 暂停 / 删除
// ============================================
async function updateReminder(recordId, updates) {
  const reminder = findByRecordId(recordId)
  if (!reminder) throw new Error('reminder not found: ' + recordId)

  // 合并字段（cron/type/human/title/content）
  const merged = { ...reminder, ...updates }
  if (updates.type || updates.cron || updates.run_at !== undefined) {
    merged.nextTriggerMs = computeNextTrigger(merged.type, merged.cron, merged.runAt || updates.run_at)
  }

  // 写多维表格
  await bitable.updateRecord(recordId, {
    title: merged.title,
    content: merged.content,
    type: merged.type,
    cron: merged.cron,
    human: merged.human,
    nextTriggerMs: merged.nextTriggerMs,
  })

  // 本地 JSON
  upsertLocal(merged)

  // 重新调度
  schedule(merged)
  return merged
}

async function pauseReminder(recordId) {
  cancel(recordId)
  try { await bitable.updateRecordRaw(recordId, { '状态': '暂停' }) } catch (e) {
    console.warn('[reminder] bitable pause failed:', e.message)
  }
  updateLocalFields(recordId, { status: '暂停' })
}

async function resumeReminder(recordId) {
  try { await bitable.updateRecordRaw(recordId, { '状态': '启用' }) } catch (e) {
    console.warn('[reminder] bitable resume failed:', e.message)
  }
  updateLocalFields(recordId, { status: '启用' })
  const reminder = findByRecordId(recordId)
  if (reminder) schedule(reminder)
}

async function deleteReminder(recordId) {
  cancel(recordId)
  try { await bitable.deleteRecord(recordId) } catch (e) {
    console.warn('[reminder] bitable delete failed:', e.message)
  }
  removeLocalById(recordId)
}

async function markEnded(recordId) {
  cancel(recordId)
  try { await bitable.updateRecordRaw(recordId, { '状态': '已结束' }) } catch (e) {
    console.warn('[reminder] markEnded bitable failed:', e.message)
  }
  updateLocalFields(recordId, { status: '已结束' })
}

// ============================================
// Snooze（稍后再提，仅本次推送，不改任务本身）
// ============================================
function snooze(reminder, minutes) {
  const delay = minutes * 60 * 1000
  console.log(`[reminder] snooze #${reminder.autoId} for ${minutes} 分钟`)
  setTimeout(() => {
    onTrigger(reminder, { snoozed: true, minutes }).catch(e => console.error('[reminder] snooze fire err:', e.message))
  }, delay)
}

// ============================================
// 调度
// ============================================
function schedule(reminder) {
  cancel(reminder.recordId)

  if (reminder.status !== '启用') return

  if (reminder.type === 'once') {
    const triggerMs = reminder.nextTriggerMs ||
      (reminder.runAt ? new Date(reminder.runAt).getTime() : null)
    if (!triggerMs) {
      console.warn(`[reminder] once 任务无触发时间: #${reminder.autoId}`)
      return
    }
    const delay = triggerMs - Date.now()
    if (delay <= 0) {
      console.log(`[reminder] once 任务已过期，标记结束: #${reminder.autoId}`)
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

function cancel(recordId) {
  const entry = scheduled.get(recordId)
  if (!entry) return
  if (entry.job) entry.job.stop()
  if (entry.handle) clearTimeout(entry.handle)
  scheduled.delete(recordId)
}

async function onTrigger(reminder, opts = {}) {
  console.log(`[reminder] FIRE #${reminder.autoId} "${reminder.title}" → ${reminder.target} ${opts.snoozed ? '(snoozed)' : ''}`)
  try {
    await feishuMsg.sendCard(reminder.target, feishuMsg.buildTriggerCard({
      recordId: reminder.recordId,
      autoId: reminder.autoId,
      title: reminder.title,
      content: reminder.content,
      human: reminder.human,
      isOnce: reminder.type === 'once',
      snoozed: opts.snoozed,
      snoozeMinutes: opts.minutes,
    }))

    if (opts.snoozed) return // snooze 推送不改原任务状态

    const nowMs = Date.now()
    if (reminder.type === 'once') {
      await markEnded(reminder.recordId)
    } else {
      const nextMs = computeNextTrigger(reminder.type, reminder.cron, null)
      await bitable.updateRecordRaw(reminder.recordId, {
        '最近触发': nowMs,
        '下次触发': nextMs || undefined,
      })
      reminder.lastTriggerMs = nowMs
      reminder.nextTriggerMs = nextMs
      upsertLocal(reminder)
    }
  } catch (err) {
    console.error(`[reminder] trigger failed #${reminder.autoId}:`, err.message)
  }
}

// ============================================
// 启动加载
// ============================================
async function loadAndScheduleAll() {
  if (process.env.ENABLE_BOT !== 'true') {
    console.log('[reminder] ENABLE_BOT != true, scheduler skipped')
    return
  }
  console.log('[reminder] loading enabled reminders from bitable...')
  try {
    const records = await bitable.listEnabledRecords()
    console.log(`[reminder] got ${records.length} enabled records`)
    const local = []
    for (const r of records) {
      const reminder = bitable.recordToReminder(r)
      // once：保留 bitable 的 nextTriggerMs；周期任务：重算
      if (reminder.type !== 'once') {
        const next = computeNextTrigger(reminder.type, reminder.cron, null)
        if (next) reminder.nextTriggerMs = next
      }
      local.push(reminder)
      schedule(reminder)
    }
    saveLocal(local)
    console.log(`[reminder] active jobs: ${scheduled.size}`)
  } catch (err) {
    console.error('[reminder] load failed:', err.message)
  }
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
  // 启动
  loadAndScheduleAll,
}
