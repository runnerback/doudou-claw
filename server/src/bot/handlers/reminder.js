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
  if (chat_type !== 'p2p') return

  const text = extractText(message).trim()
  if (!text) {
    await client.im.v1.message.reply({
      path: { message_id },
      data: { content: JSON.stringify({ text: '我只能处理文本消息哦' }), msg_type: 'text' },
    })
    return
  }

  const senderOpenId = sender?.sender_id?.open_id || ''

  // 1. 立即回"解析中"卡片，记下 message_id
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
        console.warn('[reminder handler] updateCard fallback to reply:', e.message)
      }
    }
    try { await feishuMsg.replyCard(message_id, card) } catch (e) {
      console.error('[reminder handler] replyCard failed:', e.message)
    }
  }

  try {
    const parsed = await llmService.parse(text)
    console.log('[reminder handler] parsed:', JSON.stringify(parsed))

    // ===== create（支持批量） =====
    if (parsed.intent === 'create' && parsed.tasks?.length > 0) {
      const { created, failed } = await reminderService.createBatch(parsed.tasks, {
        senderOpenId, chatId: chat_id, originalMessage: text,
      })
      if (created.length === 1 && failed.length === 0) {
        const r = created[0]
        await updateOrSend(feishuMsg.buildSuccessCard({
          recordId: r.recordId, autoId: r.autoId, title: r.title,
          human: r.human, content: r.content, type: r.type,
        }))
      } else {
        await updateOrSend(feishuMsg.buildBatchSuccessCard({ created, failed }))
      }
      return
    }

    // ===== list =====
    if (parsed.intent === 'list') {
      const reminders = reminderService.loadLocal().filter(r => r.target === chat_id && r.status === '启用')
      const body = reminders.length
        ? reminders.map(r => `• \`#${r.autoId || '?'}\` ${r.title} — ${r.human || r.cron}`).join('\n')
        : '_目前没有任何启用中的提醒任务_'
      await updateOrSend(feishuMsg.buildChatCard('**📋 你的任务清单**\n\n' + body))
      return
    }

    // ===== delete / pause =====
    if (parsed.intent === 'delete' || parsed.intent === 'pause') {
      const matches = reminderService.matchTargets(parsed.targets, chat_id)
      if (matches.length === 0) {
        await updateOrSend(feishuMsg.buildChatCard(`没找到匹配的任务。试着用 \`#编号\` 或更精确的关键词。`))
        return
      }
      // 单匹配 + 单 target → 直接执行
      if (matches.length === 1 && parsed.targets.length === 1) {
        const r = matches[0]
        if (parsed.intent === 'delete') {
          await reminderService.deleteReminder(r.recordId)
          await updateOrSend(feishuMsg.buildChatCard(`🗑 已删除 **${r.title}** (#${r.autoId})`))
        } else {
          await reminderService.pauseReminder(r.recordId)
          await updateOrSend(feishuMsg.buildChatCard(`⏸ 已暂停 **${r.title}** (#${r.autoId})`))
        }
        return
      }
      // 多 target 一次性批量执行
      if (parsed.targets.length > 1) {
        const results = []
        for (const m of matches) {
          try {
            if (parsed.intent === 'delete') {
              await reminderService.deleteReminder(m.recordId)
              results.push(`🗑 已删 \`#${m.autoId}\` ${m.title}`)
            } else {
              await reminderService.pauseReminder(m.recordId)
              results.push(`⏸ 已暂停 \`#${m.autoId}\` ${m.title}`)
            }
          } catch (e) {
            results.push(`❌ \`#${m.autoId}\` ${m.title} — ${e.message}`)
          }
        }
        await updateOrSend(feishuMsg.buildChatCard(`**批量操作完成（${results.length} 个）**\n\n${results.join('\n')}`))
        return
      }
      // 单 target 多匹配 → 让用户选
      await updateOrSend(feishuMsg.buildMatchSelectCard({ action: parsed.intent, matches }))
      return
    }

    // ===== update =====
    if (parsed.intent === 'update') {
      const matches = reminderService.matchTargets(parsed.targets, chat_id)
      if (matches.length === 0) {
        await updateOrSend(feishuMsg.buildChatCard('没找到要修改的任务。'))
        return
      }
      if (matches.length > 1) {
        await updateOrSend(feishuMsg.buildChatCard(`匹配到 ${matches.length} 个任务，请用 \`#编号\` 精确指定要改哪个：\n\n${matches.map(r => `• \`#${r.autoId}\` ${r.title}`).join('\n')}`))
        return
      }
      const r = matches[0]
      const updates = parsed.updates || {}
      const updated = await reminderService.updateReminder(r.recordId, updates)
      await updateOrSend(feishuMsg.buildChatCard(
        `✏️ 已更新 **${updated.title}** (\`#${updated.autoId}\`)\n\n` +
        `**⏰ 新时机：** ${updated.human}\n` +
        `**🏷 类型：** ${updated.type}`
      ))
      return
    }

    // ===== chat（非任务消息 → 调 LLM 真实回答） =====
    if (parsed.intent === 'chat') {
      let reply
      try {
        reply = await llmService.chatReply(text)
      } catch (e) {
        console.warn('[reminder handler] chatReply failed:', e.message)
        reply = parsed.reply || `回答时出错：${e.message}`
      }
      if (!reply || !reply.trim()) {
        reply = parsed.reply || '（暂时回答不上来）'
      }
      await updateOrSend(feishuMsg.buildChatCard(reply))
      return
    }

    await updateOrSend(feishuMsg.buildFailureCard(parsed.error || '没法解析这条消息'))
  } catch (err) {
    console.error('[reminder handler] error:', err.stack || err)
    await updateOrSend(feishuMsg.buildFailureCard(`处理失败：${err.message}`))
  }
}

module.exports = handle
