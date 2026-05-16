const Lark = require('@larksuiteoapi/node-sdk')

const APP_TOKEN = process.env.REMINDER_BITABLE_APP_TOKEN
const TABLE_ID = process.env.REMINDER_BITABLE_TABLE_ID

let _client = null
function getClient() {
  if (_client) return _client
  _client = new Lark.Client({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  })
  return _client
}

const TYPE_LABEL = {
  once: '单次',
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
  workday: '工作日',
  cron: '自定义cron',
}
const LABEL_TYPE = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [v, k]))

function typeLabel(type) { return TYPE_LABEL[type] || '自定义cron' }
function labelToType(label) { return LABEL_TYPE[label] || 'cron' }

function buildFields(reminder) {
  const f = {}
  if (reminder.title !== undefined) f['标题'] = reminder.title
  if (reminder.content !== undefined) f['内容'] = reminder.content
  if (reminder.type !== undefined) f['提醒类型'] = typeLabel(reminder.type)
  if (reminder.cron !== undefined) f['Cron表达式'] = reminder.cron
  if (reminder.human !== undefined) f['触发说明'] = reminder.human
  if (reminder.nextTriggerMs) f['下次触发'] = reminder.nextTriggerMs
  if (reminder.status !== undefined) f['状态'] = reminder.status
  // 创建者：人员字段 (type 11)，传 [{ id: open_id }]，飞书自动渲染为 @姓名 + 头像
  if (reminder.creator) f['创建者'] = [{ id: reminder.creator }]
  if (reminder.target !== undefined) f['推送目标'] = reminder.target
  if (reminder.lastTriggerMs) f['最近触发'] = reminder.lastTriggerMs
  if (reminder.originalMessage !== undefined) f['原始消息'] = reminder.originalMessage
  if (reminder.note !== undefined) f['备注'] = reminder.note
  return f
}

async function createRecord(reminder) {
  const res = await getClient().bitable.v1.appTableRecord.create({
    path: { app_token: APP_TOKEN, table_id: TABLE_ID },
    data: { fields: buildFields(reminder) },
  })
  return res?.data?.record
}

async function updateRecord(recordId, partial) {
  await getClient().bitable.v1.appTableRecord.update({
    path: { app_token: APP_TOKEN, table_id: TABLE_ID, record_id: recordId },
    data: { fields: buildFields(partial) },
  })
}

async function updateRecordRaw(recordId, fields) {
  // 直接传 bitable 中文字段名，跳过 buildFields 映射
  await getClient().bitable.v1.appTableRecord.update({
    path: { app_token: APP_TOKEN, table_id: TABLE_ID, record_id: recordId },
    data: { fields },
  })
}

async function deleteRecord(recordId) {
  await getClient().bitable.v1.appTableRecord.delete({
    path: { app_token: APP_TOKEN, table_id: TABLE_ID, record_id: recordId },
  })
}

async function listEnabledRecords() {
  const all = []
  let pageToken = undefined
  do {
    const params = { page_size: 100 }
    if (pageToken) params.page_token = pageToken
    const res = await getClient().bitable.v1.appTableRecord.search({
      path: { app_token: APP_TOKEN, table_id: TABLE_ID },
      params,
      data: {
        filter: {
          conjunction: 'and',
          conditions: [{ field_name: '状态', operator: 'is', value: ['启用'] }],
        },
      },
    })
    all.push(...(res?.data?.items || []))
    pageToken = res?.data?.page_token
  } while (pageToken)
  return all
}

function extractText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(i => (typeof i === 'string' ? i : i?.text || '')).join('')
  if (v.text) return v.text
  if (v.value && Array.isArray(v.value)) return v.value.map(x => x?.text || x).join('')
  return String(v)
}

function extractUserId(v) {
  if (!v) return ''
  if (Array.isArray(v) && v.length > 0) return v[0].id || ''
  return ''
}

function extractUserName(v) {
  if (!v) return ''
  if (Array.isArray(v) && v.length > 0) return v[0].name || ''
  return ''
}

function recordToReminder(record) {
  const f = record.fields || {}
  return {
    recordId: record.record_id,
    autoId: extractText(f['ID']),
    title: extractText(f['标题']),
    content: extractText(f['内容']),
    type: labelToType(extractText(f['提醒类型'])),
    cron: extractText(f['Cron表达式']),
    human: extractText(f['触发说明']),
    nextTriggerMs: typeof f['下次触发'] === 'number' ? f['下次触发'] : null,
    status: extractText(f['状态']),
    creator: extractUserId(f['创建者']),
    creatorName: extractUserName(f['创建者']),
    target: extractText(f['推送目标']),
    lastTriggerMs: typeof f['最近触发'] === 'number' ? f['最近触发'] : null,
    originalMessage: extractText(f['原始消息']),
    note: extractText(f['备注']),
  }
}

module.exports = {
  createRecord, updateRecord, updateRecordRaw, deleteRecord,
  listEnabledRecords, recordToReminder, typeLabel, labelToType,
}
