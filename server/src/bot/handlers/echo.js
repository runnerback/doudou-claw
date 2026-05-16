/**
 * MVP echo handler
 *   群聊：@bot <文本>  → 回 "[QClaw echo] <文本>"
 *   私聊：<文本>       → 同上
 *   @bot help          → 显示帮助
 */

function isBotMention(m) {
  // 飞书 mentions 数组里 bot 的判别字段是 mentioned_type === 'bot'
  // （id.user_id 为 null、key 为 @_user_N、不一定是 @_all）
  return m?.mentioned_type === 'bot' || m?.key === '@_all'
}

function extractText(message) {
  if (message?.message_type !== 'text') return ''
  try {
    return JSON.parse(message.content).text || ''
  } catch {
    return ''
  }
}

const HELP_TEXT = [
  '🤖 QClaw 助手 (MVP)',
  '',
  '当前能力：',
  '• @bot <文本>   →  echo 回复（验证消息互动）',
  '• @bot help     →  显示本帮助',
  '',
  '后续接入：任务获取 / 任务推送 / LLM 智能回复',
].join('\n')

async function handle(client, data) {
  const { message } = data
  const { message_id, chat_type, mentions } = message

  // 群聊必须 @bot 才响应（私聊直接响应）
  if (chat_type !== 'p2p') {
    const isMentioned = Array.isArray(mentions) && mentions.some(isBotMention)
    if (!isMentioned) {
      console.log(`[bot] group msg not mentioned to bot, mentions=${JSON.stringify(mentions || [])}`)
      return
    }
  }

  const text = extractText(message).replace(/@_user_\d+/g, '').trim()

  if (text === 'help' || text === '/help') {
    await client.im.v1.message.reply({
      path: { message_id },
      data: { content: JSON.stringify({ text: HELP_TEXT }), msg_type: 'text' },
    })
    return
  }

  const reply = text
    ? `[QClaw echo] ${text}`
    : '[QClaw] 收到（非文本消息，MVP 阶段仅 echo 文本）'

  await client.im.v1.message.reply({
    path: { message_id },
    data: { content: JSON.stringify({ text: reply }), msg_type: 'text' },
  })

  console.log(`[bot] echo → ${chat_type}: ${text.slice(0, 80)}`)
}

module.exports = handle
