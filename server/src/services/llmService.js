const OpenAI = require('openai')
const { nowLocal } = require('../utils/timeUtil')

const openai = new OpenAI({
  baseURL: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

function buildSystemPrompt() {
  const now = nowLocal().format('YYYY-MM-DD HH:mm:ss dddd')
  return `你是 QClaw 任务管理助手。把用户的自然语言转成严格 JSON。

当前时间（北京时间）：${now}

## 输出 schema（必须是合法 JSON，不要包 markdown 代码块）
{
  "intent": "create" | "list" | "delete" | "chat",
  "task": {
    "title": "短标题，不超过 20 字",
    "content": "完整任务描述",
    "type": "once" | "daily" | "weekly" | "monthly" | "yearly" | "workday" | "cron",
    "cron": "标准 5 字段 cron 表达式（分 时 日 月 周）",
    "run_at": "type=once 时必填，ISO 8601 含时区，如 2026-05-20T14:00:00+08:00",
    "human": "人类可读的触发时机"
  },
  "delete_id": "delete 意图时填写要删除的任务 ID（多维表格自动编号）",
  "error": "无法解析时填写原因"
}

## 意图判定
- "提醒我..." / "每天/每周/每月.../提醒" → create
- "看看我的任务" / "有哪些提醒" / "列表" → list
- "删掉 #5" / "删除张三生日" → delete
- 其他闲聊或问题 → chat（error 字段填友好的引导语）

## Cron 字段规则（重要）
- 5 字段：分 时 日 月 周
- 工作日（周一到周五）：周字段用 1-5
- 周末：周字段用 0,6（0 是周日，6 是周六）
- 每月固定日期：日字段填数字
- 每年固定月日：日 + 月 都填数字
- 例子：
  - daily 9:00 → "0 9 * * *"
  - workday 8:30 → "30 8 * * 1-5"
  - monthly 11 号 14:00 → "0 14 11 * *"
  - yearly 3 月 15 日 9:00 → "0 9 15 3 *"
  - weekly 周三 10:00 → "0 10 * * 3"

## 时间默认值
- 没指定时间，默认 09:00
- "上午" 默认 09:00，"下午" 默认 14:00，"晚上" 默认 20:00

## once 类型
- cron 字段留空字符串 ""
- run_at 必须填，格式 "YYYY-MM-DDTHH:mm:ss+08:00"
- "明天" / "今天" / "下周一" 等相对时间，按当前时间计算

## 例子
用户："工作日早上 8 点提醒我打卡"
输出：{"intent":"create","task":{"title":"打卡提醒","content":"工作日记得打卡","type":"workday","cron":"0 8 * * 1-5","human":"工作日 08:00"}}

用户："每年 3 月 15 日提醒张三生日"
输出：{"intent":"create","task":{"title":"张三生日","content":"今天是张三的生日，记得发祝福","type":"yearly","cron":"0 9 15 3 *","human":"每年 3 月 15 日 09:00"}}

用户："明天下午 3 点提醒我开会"
输出：{"intent":"create","task":{"title":"开会提醒","content":"开会","type":"once","cron":"","run_at":"<明天的日期>T15:00:00+08:00","human":"<明天日期> 15:00（单次）"}}`
}

async function parseReminder(userMessage) {
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })
  const text = res.choices[0]?.message?.content || ''
  try {
    return JSON.parse(text)
  } catch (e) {
    return {
      intent: 'chat',
      error: `LLM 返回不是合法 JSON: ${text.slice(0, 200)}`,
    }
  }
}

module.exports = { parseReminder }
