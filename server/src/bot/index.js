const Lark = require('@larksuiteoapi/node-sdk')
const echoHandler = require('./handlers/echo')
const { learnChat } = require('../utils/chatStore')

const processedMessages = new Set()
const MAX_CACHE_SIZE = 200

function addProcessed(id) {
  processedMessages.add(id)
  if (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.values().next().value
    processedMessages.delete(first)
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
      const { message_id, chat_id, chat_type } = data?.message || {}
      if (!message_id) return

      if (processedMessages.has(message_id)) return
      addProcessed(message_id)

      // 顺手学习 chat_id（首次出现的群/私聊登记一下，供管理面板展示）
      try { learnChat(chat_id, chat_type) } catch (e) {
        console.warn('[bot] learnChat failed:', e.message)
      }

      try {
        await echoHandler(client, data)
      } catch (err) {
        console.error('[bot] handler error:', err.message)
      }
    },

    'im.chat.member.bot.added_v1': async (data) => {
      const chatId = data?.chat_id || data?.event?.chat_id
      console.log('[bot] bot added to chat:', chatId)
      if (chatId) learnChat(chatId, 'group')
    },
  })

  wsClient.start({ eventDispatcher })
  console.log('[bot] WebSocket 长连接已启动')
}

module.exports = { startBot }
