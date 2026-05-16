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

// ===== 卡片构建 =====

function buildThinkingCard() {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🤖 QClaw 任务助手' },
      template: 'blue',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '⏳ **正在解析你的任务...**\n\n稍等几秒，我喊 DeepSeek 算算' } },
    ],
  }
}

function buildSuccessCard({ recordId, autoId, title, human, content, type }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 已创建提醒 #${autoId || '?'}` },
      template: 'green',
    },
    elements: [
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
    ],
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
      { tag: 'div', text: { tag: 'lark_md', content: '**可以这样说：**\n• 每天 9 点提醒我喝水\n• 工作日 8 点半提醒打卡\n• 每月 11 号 14:00 提醒交房租\n• 每年 3 月 15 日提醒张三生日' } },
    ],
  }
}

function buildTriggerCard({ autoId, title, content, human }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🔔 任务提醒 #${autoId || '?'}` },
      template: 'orange',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**📌 ${title}**` } },
      { tag: 'div', text: { tag: 'lark_md', content: content || '_(无详细内容)_' } },
      { tag: 'div', text: { tag: 'lark_md', content: `_⏰ ${human}_` } },
    ],
  }
}

function buildChatCard(content) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '💬 QClaw' },
      template: 'wathet',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content } },
    ],
  }
}

// ===== 发送 / 更新 =====

async function sendCard(chatId, card) {
  const res = await getClient().im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
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
  buildThinkingCard, buildSuccessCard, buildFailureCard, buildTriggerCard, buildChatCard,
  sendCard, replyCard, updateCard, getClient,
}
