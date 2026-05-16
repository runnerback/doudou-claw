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

function updateLocalStatus(recordId, status) {
  const list = loadLocal()
  const idx = list.findIndex(r => r.recordId === recordId)
  if (idx >= 0) {
    list[idx].status = status
    saveLocal(list)
  }
}

// ============================================
// 创建（从 LLM 解析结果）
// ============================================
async function createFromParsed(parsed, ctx) {
  const task = parsed.task || {}
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

  // 1. 写飞书多维表格 → 拿到 recordId + autoId
  const record = await bitable.createRecord(reminder)
  reminder.recordId = record.record_id
  reminder.autoId = record.fields?.ID || ''

  // 2. 写本地 JSON
  upsertLocal(reminder)

  // 3. 注册调度
  schedule(reminder)

  return reminder
}

// ============================================
// 调度核心
// ============================================
function schedule(reminder) {
  cancel(reminder.recordId) // 清理旧 entry

  if (reminder.status !== '启用') return

  // 单次任务用 setTimeout
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
    return
  }

  // 周期任务用 node-cron
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

async function onTrigger(reminder) {
  console.log(`[reminder] FIRE #${reminder.autoId} "${reminder.title}" → ${reminder.target}`)
  try {
    await feishuMsg.sendCard(reminder.target, feishuMsg.buildTriggerCard({
      autoId: reminder.autoId,
      title: reminder.title,
      content: reminder.content,
      human: reminder.human,
    }))

    const nowMs = Date.now()
    if (reminder.type === 'once') {
      await markEnded(reminder.recordId)
    } else {
      const nextMs = computeNextTrigger(reminder.type, reminder.cron)
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

async function markEnded(recordId) {
  cancel(recordId)
  try {
    await bitable.updateRecordRaw(recordId, { '状态': '已结束' })
  } catch (e) {
    console.warn('[reminder] markEnded bitable failed:', e.message)
  }
  updateLocalStatus(recordId, '已结束')
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
      // 重算 nextTriggerMs（防止本地缓存过期）
      reminder.nextTriggerMs = computeNextTrigger(reminder.type, reminder.cron, reminder.runAt)
      local.push(reminder)
      schedule(reminder)
    }
    saveLocal(local)
    console.log(`[reminder] active jobs: ${scheduled.size}`)
  } catch (err) {
    console.error('[reminder] load failed:', err.message)
  }
}

async function deleteReminder(recordId) {
  cancel(recordId)
  try { await bitable.deleteRecord(recordId) } catch (e) {
    console.warn('[reminder] bitable delete failed:', e.message)
  }
  removeLocalById(recordId)
}

async function pauseReminder(recordId) {
  cancel(recordId)
  try { await bitable.updateRecordRaw(recordId, { '状态': '暂停' }) } catch (e) {
    console.warn('[reminder] bitable pause failed:', e.message)
  }
  updateLocalStatus(recordId, '暂停')
}

module.exports = {
  createFromParsed, schedule, cancel, onTrigger,
  loadAndScheduleAll, loadLocal,
  deleteReminder, pauseReminder, markEnded,
}
