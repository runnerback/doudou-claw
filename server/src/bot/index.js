const Lark = require('@larksuiteoapi/node-sdk')
const echoHandler = require('./handlers/echo')
const reminderHandler = require('./handlers/reminder')
const reminderService = require('../services/reminderService')
const { learnChat, getChat, updateChat } = require('../utils/chatStore')

const processedMessages = new Set()
const MAX_CACHE_SIZE = 200

function addProcessed(id) {
  processedMessages.add(id)
  if (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.values().next().value
    processedMessages.delete(first)
  }
}

async function ensureChatName(client, chatId, chatType, peerOpenId) {
  const chat = getChat(chatId)
  if (!chat) {
    console.log(`[bot] ensureChatName: no chat record for ${chatId}, skip`)
    return
  }
  if (chat.name && chat.name !== chatId) return // 已解析

  console.log(`[bot] ensureChatName: resolving ${chatType}/${chatId} (peer=${peerOpenId || '(none)'})`)
  try {
    if (chatType === 'group' || chatType === 'topic') {
      const res = await client.im.v1.chat.get({ path: { chat_id: chatId } })
      const name = res?.data?.name
      if (name) {
        updateChat(chatId, { name })
        console.log(`[bot] resolved group name: ${name} (${chatId})`)
      }
    } else if (chatType === 'p2p' && peerOpenId) {
      const res = await client.contact.v3.user.get({
        path: { user_id: peerOpenId },
        params: { user_id_type: 'open_id' },
      })
      const name = res?.data?.user?.name
      if (name) {
        updateChat(chatId, { name: `[私聊] ${name}` })
        console.log(`[bot] resolved p2p user: ${name} (${chatId})`)
      }
    }
  } catch (err) {
    console.warn(`[bot] resolveChatName failed (${chatType}/${chatId}): ${err.message}`)
  }
}

function startBot() {
  if (process.env.ENABLE_BOT !== 'true') {
    console.log('[bot] ENABLE_BOT != true，跳过长连接（本地开发默认不启动）')
    return
  }

  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    console.error('[bot] FEISHU_APP_ID / FEISHU_APP_SECRET 未配置，跳过启动')
    return
  }

  const baseConfig = { appId, appSecret }
  const client = new Lark.Client(baseConfig)
  const wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  })

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const message = data?.message
      if (!message) return
      const { message_id, chat_id, chat_type, mentions, message_type } = message
      if (!message_id) return

      if (processedMessages.has(message_id)) return
      addProcessed(message_id)

      const senderOpenId = data?.sender?.sender_id?.open_id || ''
      console.log(`[bot] RECV ${chat_type} type=${message_type} chat_id=${chat_id} sender=${senderOpenId || '(empty)'} mentions=${JSON.stringify(mentions || [])}`)

      try { learnChat(chat_id, chat_type) } catch (e) {
        console.warn('[bot] learnChat failed:', e.message)
      }
      ensureChatName(client, chat_id, chat_type, senderOpenId).catch(err => {
        console.warn(`[bot] ensureChatName outer error: ${err.message}`)
      })

      // 路由：私聊 → 任务管理；群聊 → echo（保留）
      const handler = chat_type === 'p2p' ? reminderHandler : echoHandler
      try {
        await handler(client, data)
      } catch (err) {
        console.error('[bot] handler error:', err.message, err.stack?.split('\n')[1])
      }
    },

    'im.chat.member.bot.added_v1': async (data) => {
      const chatId = data?.chat_id || data?.event?.chat_id
      console.log('[bot] bot added to chat:', chatId)
      if (chatId) {
        learnChat(chatId, 'group')
        ensureChatName(client, chatId, 'group').catch(() => {})
      }
    },

    // ===== 卡片按钮回调 =====
    'card.action.trigger': async (data) => {
      const value = data?.action?.value || {}
      const action = value.action
      const recordId = value.record_id
      console.log(`[bot] card action: ${action} record=${recordId} extra=${JSON.stringify(value)}`)

      if (action === 'reminder_pause' && recordId) {
        try { await reminderService.pauseReminder(recordId) } catch (e) {
          console.warn('[bot] pause failed:', e.message)
        }
        return {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: '⏸ 已暂停' }, template: 'grey' },
          elements: [{ tag: 'div', text: { tag: 'lark_md', content: '提醒已暂停。可在多维表格中改回"启用"再次开启。' } }],
        }
      }

      if (action === 'reminder_delete' && recordId) {
        try { await reminderService.deleteReminder(recordId) } catch (e) {
          console.warn('[bot] delete failed:', e.message)
        }
        return {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: '🗑 已删除' }, template: 'grey' },
          elements: [{ tag: 'div', text: { tag: 'lark_md', content: '提醒已从任务清单中移除。' } }],
        }
      }

      // 任务完成（推送卡片上的"✅ 完成"按钮）
      if (action === 'task_done' && recordId) {
        const reminder = reminderService.findByRecordId(recordId)
        const title = reminder?.title || '任务'
        const autoId = reminder?.autoId || ''
        // once 任务到这一步通常已经 markEnded（onTrigger 内）；这里只更新卡片视觉
        return {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: `✅ 已完成 #${autoId}` }, template: 'green' },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: `**${title}** 已标记完成 🎉` } },
          ],
        }
      }

      // 稍后再提（10/30/60 分钟）
      if (action === 'snooze' && recordId) {
        const minutes = Number(value.minutes) || 10
        const reminder = reminderService.findByRecordId(recordId)
        if (!reminder) {
          return {
            config: { wide_screen_mode: true },
            header: { title: { tag: 'plain_text', content: '⚠️ 任务不存在' }, template: 'grey' },
            elements: [{ tag: 'div', text: { tag: 'lark_md', content: '可能已被删除，无法 snooze' } }],
          }
        }
        reminderService.snooze(reminder, minutes)
        return {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: `⏰ 已延后 ${minutes} 分钟` }, template: 'turquoise' },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: `**${reminder.title}** 已延后，${minutes} 分钟后我再提醒你。` } },
          ],
        }
      }

      return null
    },
  })

  wsClient.start({ eventDispatcher })
  console.log('[bot] WebSocket 长连接已启动')
}

module.exports = { startBot }
