const Lark = require('@larksuiteoapi/node-sdk')

let _client = null
function getClient() {
  if (_client) return _client
  _client = new Lark.Client({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  })
  return _client
}

// 多维表格链接 footer
function bitableFooter() {
  const url = process.env.BITABLE_VIEW_URL
  if (!url) return null
  return {
    tag: 'note',
    elements: [
      { tag: 'lark_md', content: `📊 [在多维表格中查看 / 编辑](${url})` },
    ],
  }
}

// ===== 卡片构建 =====

function buildThinkingCard() {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🤖 QClaw 任务助手' },
      template: 'blue',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '⏳ **正在解析你的任务...**\n\n稍等几秒' } },
    ],
  }
}

function buildSuccessCard({ recordId, autoId, title, human, content, type }) {
  const elements = [
    { tag: 'div', fields: [
      { is_short: false, text: { tag: 'lark_md', content: `**📌 标题**\n${title}` } },
      { is_short: false, text: { tag: 'lark_md', content: `**⏰ 时机**\n${human}` } },
      { is_short: false, text: { tag: 'lark_md', content: `**📝 内容**\n${content || '_(无)_'}` } },
      { is_short: true, text: { tag: 'lark_md', content: `**🏷 类型**\n${type || '-'}` } },
    ]},
    { tag: 'hr' },
    { tag: 'action', actions: [
      { tag: 'button', text: { tag: 'plain_text', content: '⏸ 暂停' },
        type: 'default', value: { action: 'reminder_pause', record_id: recordId } },
      { tag: 'button', text: { tag: 'plain_text', content: '🗑 删除' },
        type: 'danger', value: { action: 'reminder_delete', record_id: recordId } },
    ]},
  ]
  const footer = bitableFooter()
  if (footer) elements.push(footer)
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 已创建提醒 #${autoId || '?'}` },
      template: 'green',
    },
    elements,
  }
}

// 批量创建成功卡片（多任务一次创建）
function buildBatchSuccessCard({ created, failed }) {
  const lines = created.map(r => `• \`#${r.autoId || '?'}\` ${r.title} — ${r.human}`).join('\n')
  const failLines = (failed || []).length
    ? '\n\n**⚠️ 失败：**\n' + failed.map(f => `• ${f.task?.title || '(unknown)'} — ${f.error}`).join('\n')
    : ''
  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: lines + failLines } },
  ]
  const footer = bitableFooter()
  if (footer) elements.push(footer)
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 已创建 ${created.length} 个提醒` },
      template: 'green',
    },
    elements,
  }
}

function buildFailureCard(errorMessage) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '😅 没听懂' },
      template: 'orange',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: errorMessage || '我没法把这句话变成任务。' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: '**可以这样说：**\n• 每天 9 点提醒我喝水\n• 工作日 8 点半提醒打卡；每月 11 号交房租（**支持多条**）\n• 删掉喝水提醒\n• 把打卡改成 9 点\n• 看看我有哪些任务' } },
    ],
  }
}

// 推送触发卡片（带 完成 / 稍后 按钮）
function buildTriggerCard({ recordId, autoId, title, content, human, isOnce, snoozed, snoozeMinutes }) {
  const header = snoozed
    ? `🔔 提醒（${snoozeMinutes}min后）#${autoId || '?'}`
    : `🔔 任务提醒 #${autoId || '?'}`
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: header },
      template: 'orange',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**📌 ${title}**` } },
      { tag: 'div', text: { tag: 'lark_md', content: content || '_(无详细内容)_' } },
      { tag: 'div', text: { tag: 'lark_md', content: `_⏰ ${human}_` } },
      { tag: 'hr' },
      { tag: 'action', actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '✅ 完成' },
          type: 'primary', value: { action: 'task_done', record_id: recordId, is_once: !!isOnce } },
        { tag: 'button', text: { tag: 'plain_text', content: '⏰ 10 分钟后' },
          type: 'default', value: { action: 'snooze', record_id: recordId, minutes: 10 } },
        { tag: 'button', text: { tag: 'plain_text', content: '⏰ 30 分钟后' },
          type: 'default', value: { action: 'snooze', record_id: recordId, minutes: 30 } },
        { tag: 'button', text: { tag: 'plain_text', content: '⏰ 1 小时后' },
          type: 'default', value: { action: 'snooze', record_id: recordId, minutes: 60 } },
      ]},
    ],
  }
}

// 多匹配选择卡片
function buildMatchSelectCard({ action, matches }) {
  // action = 'delete' | 'pause'
  const actionText = action === 'delete' ? '删除' : '暂停'
  const lines = matches.map(r => `• \`#${r.autoId}\` ${r.title} — ${r.human}`).join('\n')
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `❓ 匹配到 ${matches.length} 个任务，请选择要${actionText}的` },
      template: 'wathet',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: lines } },
      { tag: 'hr' },
      { tag: 'action', actions: matches.slice(0, 10).map(r => ({
        tag: 'button',
        text: { tag: 'plain_text', content: `${actionText} ${r.title}` },
        type: action === 'delete' ? 'danger' : 'default',
        value: { action: action === 'delete' ? 'reminder_delete' : 'reminder_pause', record_id: r.recordId },
      })) },
    ],
  }
}

function buildChatCard(content, { withFooter = false } = {}) {
  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content } },
  ]
  if (withFooter) {
    const footer = bitableFooter()
    if (footer) elements.push(footer)
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '💬 QClaw' },
      template: 'wathet',
    },
    elements,
  }
}

function buildDoneCard({ title, autoId }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 已完成 #${autoId || '?'}` },
      template: 'green',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${title}** 已标记完成` } },
    ],
  }
}

function buildMorningCard({ greeting, weather, tasks, lunarDate }) {
  const { dayjs, TZ } = require('../utils/timeUtil')
  const today = dayjs().tz(TZ)
  const dateStr = today.format('M 月 D 日 dddd')
  const elements = []

  // 寄语
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: greeting || '☀️ 元气满满的一天开始啦' } })

  // 天气
  if (weather) {
    let line = `🌤 **${weather.city}**　${weather.desc}　${weather.temp}°C`
    if (weather.feels) line += `（体感 ${weather.feels}°C）`
    if (weather.max && weather.min) {
      line += `\n📊 今日 ${weather.min}°C ~ ${weather.max}°C${weather.humidity ? `　湿度 ${weather.humidity}%` : ''}`
    }
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: line } })
  }

  // 任务
  elements.push({ tag: 'hr' })
  if (!tasks || tasks.length === 0) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '📋 **今日无提醒任务** — 享受自由的一天 ✨' } })
  } else {
    const lines = tasks.map(t => {
      const time = dayjs(t.todayTriggerMs).tz(TZ).format('HH:mm')
      const note = t.content ? ' — ' + t.content.slice(0, 30) : ''
      return `• \`${time}\`　**${t.title}**${note}`
    }).join('\n')
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `📋 **今日待办（${tasks.length}）**\n\n${lines}` } })
  }

  const subtitle = lunarDate ? `${dateStr}　·　${lunarDate}` : dateStr
  elements.unshift({ tag: 'div', text: { tag: 'lark_md', content: `_${subtitle}_` } })

  const footer = bitableFooter()
  if (footer) elements.push(footer)

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '☀️ 早安' },
      template: 'yellow',
    },
    elements,
  }
}

function buildSnoozeAckCard({ title, autoId, minutes }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `⏰ 已延后 ${minutes} 分钟` },
      template: 'turquoise',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${title}** 已延后，${minutes} 分钟后我再提醒你。` } },
    ],
  }
}

// ===== 发送 / 更新 =====

async function sendCard(target, card) {
  // 自动识别 target 是 chat_id (oc_) 还是 open_id (ou_)，分别用对应的 receive_id_type
  const receiveType = typeof target === 'string' && target.startsWith('ou_') ? 'open_id' : 'chat_id'
  const res = await getClient().im.v1.message.create({
    params: { receive_id_type: receiveType },
    data: {
      receive_id: target,
      content: JSON.stringify(card),
      msg_type: 'interactive',
    },
  })
  return res?.data
}

async function replyCard(messageId, card) {
  const res = await getClient().im.v1.message.reply({
    path: { message_id: messageId },
    data: {
      content: JSON.stringify(card),
      msg_type: 'interactive',
    },
  })
  return res?.data
}

async function updateCard(messageId, card) {
  await getClient().im.v1.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  })
}

module.exports = {
  buildThinkingCard, buildSuccessCard, buildBatchSuccessCard,
  buildFailureCard, buildTriggerCard, buildMatchSelectCard,
  buildChatCard, buildDoneCard, buildSnoozeAckCard, buildMorningCard,
  sendCard, replyCard, updateCard, getClient,
}
