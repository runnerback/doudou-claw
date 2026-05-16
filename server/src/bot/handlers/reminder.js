const llmService = require('../../services/llmService')
const reminderService = require('../../services/reminderService')
const feishuMsg = require('../../services/feishuMsg')

function extractText(message) {
  if (message?.message_type !== 'text') return ''
  try { return JSON.parse(message.content).text || '' } catch { return '' }
}

async function handle(client, data) {
  const message = data?.message
  const sender = data?.sender
  if (!message) return

  const { message_id, chat_id, chat_type } = message
  if (chat_type !== 'p2p') return // 仅处理私聊

  const text = extractText(message).trim()
  if (!text) {
    await client.im.v1.message.reply({
      path: { message_id },
      data: { content: JSON.stringify({ text: '我只能处理文本消息哦' }), msg_type: 'text' },
    })
    return
  }

  const senderOpenId = sender?.sender_id?.open_id || ''

  // 1. 立即回 "解析中" 卡片，记下 message_id 用于后续更新
  let thinkingMessageId = null
  try {
    const reply = await feishuMsg.replyCard(message_id, feishuMsg.buildThinkingCard())
    thinkingMessageId = reply?.message_id
  } catch (e) {
    console.warn('[reminder handler] send thinking card failed:', e.message)
  }

  const updateOrSend = async (card) => {
    if (thinkingMessageId) {
      try { await feishuMsg.updateCard(thinkingMessageId, card); return } catch (e) {
        console.warn('[reminder handler] updateCard fallback:', e.message)
      }
    }
    try { await feishuMsg.replyCard(message_id, card) } catch (e) {
      console.error('[reminder handler] replyCard failed:', e.message)
    }
  }

  try {
    // 2. LLM 解析
    const parsed = await llmService.parseReminder(text)
    console.log('[reminder handler] parsed:', JSON.stringify(parsed))

    // 3. 按意图分发
    if (parsed.intent === 'create' && parsed.task) {
      const reminder = await reminderService.createFromParsed(parsed, {
        senderOpenId, chatId: chat_id, originalMessage: text,
      })
      await updateOrSend(feishuMsg.buildSuccessCard({
        recordId: reminder.recordId,
        autoId: reminder.autoId,
        title: reminder.title,
        human: reminder.human,
        content: reminder.content,
        type: parsed.task.type,
      }))
      return
    }

    if (parsed.intent === 'list') {
      const reminders = reminderService.loadLocal().filter(r => r.target === chat_id && r.status === '启用')
      const body = reminders.length
        ? reminders.map(r => `• [#${r.autoId || '?'}] ${r.title} — ${r.human || r.cron}`).join('\n')
        : '_目前没有任何提醒任务_'
      await updateOrSend(feishuMsg.buildChatCard('**📋 你的任务清单**\n\n' + body))
      return
    }

    if (parsed.intent === 'delete') {
      await updateOrSend(feishuMsg.buildChatCard('删除暂未实现自然语言指令，请点击提醒卡片上的 🗑 按钮，或在多维表格里改"状态"为"已结束"。'))
      return
    }

    if (parsed.intent === 'chat') {
      await updateOrSend(feishuMsg.buildChatCard(parsed.error || '我主要负责管理你的提醒任务。\n\n试着说：「每天 9 点提醒我喝水」'))
      return
    }

    await updateOrSend(feishuMsg.buildFailureCard(parsed.error || '没法解析这条消息'))
  } catch (err) {
    console.error('[reminder handler] error:', err)
    await updateOrSend(feishuMsg.buildFailureCard(`处理失败：${err.message}`))
  }
}

module.exports = handle
