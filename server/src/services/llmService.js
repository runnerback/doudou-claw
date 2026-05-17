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

## 输出 schema（必须合法 JSON，不要包 markdown 代码块）
{
  "intent": "create" | "list" | "delete" | "update" | "pause" | "chat",
  "tasks": [Task, ...],          // create 时填
  "targets": [Target, ...],      // delete/update/pause 时填
  "updates": Partial<Task>,      // update 时填
  "reply": "...",                // chat 时填
  "error": "..."                 // 解析失败时填
}

Task: {
  "title": "短标题，不超过 20 字",
  "content": "完整任务描述",
  "type": "once" | "daily" | "weekly" | "monthly" | "yearly" | "workday" | "cron" | "lunar" | "nth_weekday",
  "cron": "调度字符串，格式取决于 type（见下）",
  "run_at": "type=once 必填，ISO 8601 含时区，如 2026-05-20T14:00:00+08:00",
  "human": "人类可读触发时机"
}

Target: { "id": "TASK-...-NNN", "title_query": "关键词" }

## 调度字符串格式（cron 字段）

### A. 标准 cron（type=daily/weekly/monthly/yearly/workday/cron）
5 字段："分 时 日 月 周"
- daily 9:00 → "0 9 * * *"
- workday 8:30 → "30 8 * * 1-5"
- weekly 周三 10:00 → "0 10 * * 3"
- monthly 11 号 14:00 → "0 14 11 * *"
- yearly 公历 3 月 15 日 9:00 → "0 9 15 3 *"

### B. 农历（type=lunar）⭐
格式："lunar:M-D HH:MM"，M=农历月 1-12，D=农历日 1-30
- 农历 9 月 27 日 9:00 → "lunar:9-27 09:00"
- 农历正月三十 9:00 → "lunar:1-30 09:00"
- 农历七月十一 9:00 → "lunar:7-11 09:00"
- 农历十月初九 9:00 → "lunar:10-9 09:00"
- 农历十一月廿四 9:00 → "lunar:11-24 09:00"
（注意：农历月份要写阿拉伯数字，不要用"正月/腊月/初/廿/三十"等汉字）

### D. 早安总结（type=morning_briefing）⭐
固定推送类型，每天给用户发当日待办 + 天气 + LLM 早安寄语
cron 用标准格式，默认 "30 8 * * *"（每天 08:30）
触发关键词：
- "每天早上 8:30 给我早安总结"
- "8 点半推个早安提醒"
- "每天汇总今天的任务"
- "每天早安鼓励一下"
→ {"intent":"create","tasks":[{"title":"每日早安总结","content":"今日待办+天气+寄语","type":"morning_briefing","cron":"30 8 * * *","human":"每日 08:30 早安总结"}]}

### C. 每月/每年的第N个周X（type=nth_weekday）⭐
格式："nth:M-W-N HH:MM"，M=月（1-12 或 * 表示任何月），W=周（0=周日，1=周一 … 6=周六），N=第N个（1-5）或 -1（最后一个）
- 每年 5 月第二个周日 9:00 → "nth:5-0-2 09:00"
- 每月最后一个周五 17:00 → "nth:*-5--1 17:00"
- 每年 11 月第四个周四 12:00 → "nth:11-4-4 12:00"

## 意图判定
- "提醒/每天/每周/.../点/...时" + 任务 → create
- "删除/删掉/取消" + 任务 → delete
- "修改/改成/调整" + 任务 → update
- "暂停/停止/关掉" + 任务 → pause
- "列表/有哪些/看看任务" → list
- 其他 → chat（reply 填友好回答）

## 时间默认值
- 没指定时间 → 09:00
- "上午"→ 09:00，"下午"→ 14:00，"晚上"→ 20:00

## ⭐ 批量识别
一段话多任务 → tasks 数组多项。例：
用户："每天 9 点喝水；工作日 8:30 打卡；农历 9 月 27 日妈妈生日"
→ {
  "intent":"create",
  "tasks":[
    {"title":"喝水提醒","type":"daily","cron":"0 9 * * *","human":"每天 09:00"},
    {"title":"打卡提醒","type":"workday","cron":"30 8 * * 1-5","human":"工作日 08:30"},
    {"title":"妈妈生日","content":"农历 9 月 27 日","type":"lunar","cron":"lunar:9-27 09:00","human":"每年农历 9 月 27 日 09:00"}
  ]
}

## ⭐ 农历识别规则
- 出现"农历"二字或"正月/腊月/冬月/廿/初/十几"等农历词 → type="lunar"
- 月份用阿拉伯数字：正月=1，二月=2 ... 腊月=12
- 日子用阿拉伯数字：初一=1，初九=9，十五=15，廿四=24，三十=30

## ⭐ 第N个周X 识别规则
- "第N个周X" / "第N周X" / "最后一个周X" → type="nth_weekday"
- 周：周日=0，周一=1 ... 周六=6
- "最后一个" → N=-1

## 严格要求
- 必须输出合法 JSON
- intent 必填
- create 时 tasks 至少一条
- 不要遗漏 type/cron/human 字段
- 数组字段未用到也保留空数组
- 不要把农历日期错误地写成 type="yearly" + 公历 cron`
}

async function parse(userMessage) {
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
    const parsed = JSON.parse(text)
    if (parsed.task && !parsed.tasks) parsed.tasks = [parsed.task]
    if (parsed.target && !parsed.targets) parsed.targets = [parsed.target]
    if (!parsed.tasks) parsed.tasks = []
    if (!parsed.targets) parsed.targets = []
    return parsed
  } catch (e) {
    return {
      intent: 'chat',
      tasks: [], targets: [], reply: '',
      error: `LLM 返回不是合法 JSON: ${text.slice(0, 200)}`,
    }
  }
}

const parseReminder = parse

// ============================================
// 闲聊 / 问答（intent=chat 时调用，给用户真实回答）
// ============================================
const CHAT_SYSTEM_BASE = `你是飞书机器人豆豆酱（QClaw 任务助手），除了管理用户的提醒任务，也能回答日常问题、聊天、做决策建议。

回答原则：
- 简洁有用，避免冗长（多数回答 3-15 行内）
- 用户问菜谱/做法 → 给具体步骤
- 用户问知识 → 给准确信息，不知道就坦白
- 用户闲聊/调侃 → 自然回应，不机械
- 用户问你能干啥 → 简短介绍 + 一两个具体例子
- 用户问"我有几个任务/我的任务清单/今天有啥任务" → 看下方上下文里的「用户任务清单」直接回答
- 用户问天气 → 看下方上下文里的「今日天气」直接回答
- 不要再说"我无法查看你的任务/天气"——你已被注入上下文，请用它
- 不要在每条回答最后加"试试说每天9点提醒我喝水"等推销引导

输出纯文本，简洁 markdown（**加粗**、- 列表）可用。`

function buildContextBlock(ctx) {
  if (!ctx) return ''
  const lines = []
  if (ctx.date) lines.push(`【现在时间】 ${ctx.date}`)
  if (ctx.lunarDate) lines.push(`【农历】 ${ctx.lunarDate}`)
  if (ctx.weather) {
    const w = ctx.weather
    let line = `【今日天气】 ${w.city}　${w.desc}　${w.temp}°C`
    if (w.feels) line += `（体感 ${w.feels}°C）`
    if (w.max && w.min) line += `，今日 ${w.min}°C~${w.max}°C`
    if (w.humidity) line += `，湿度 ${w.humidity}%`
    lines.push(line)
  }
  if (ctx.tasks && ctx.tasks.length > 0) {
    lines.push(`\n【用户当前的提醒任务清单（${ctx.tasks.length} 条启用中）】`)
    ctx.tasks.forEach(t => {
      const id = t.autoId || t.recordId
      const meta = t.human || t.cron || '(无时机)'
      const note = t.content ? `（${t.content.slice(0, 30)}）` : ''
      lines.push(`- #${id} ${t.title}${note}　— ${meta}`)
    })
  } else if (ctx.tasks) {
    lines.push(`\n【用户当前的提醒任务清单】 暂无启用中的任务`)
  }
  return lines.length ? '\n\n---\n以下是实时上下文，回答时直接用：\n' + lines.join('\n') : ''
}

// ============================================
// 早安寄语（morning_briefing 任务触发时调用）
// ============================================
async function morningGreeting({ date, lunarDate, taskCount, weather }) {
  const ctxLines = [
    `今天: ${date}`,
    lunarDate ? `${lunarDate}` : '',
    weather ? `天气: ${weather.desc} ${weather.temp}°C 体感${weather.feels}°C${weather.max && weather.min ? ` 今日${weather.min}~${weather.max}°C` : ''}` : '天气: 未知',
    `今日提醒数: ${taskCount}`,
  ].filter(Boolean).join('\n')

  const sys = `你是温暖的早安播报员，给用户发当日早安寄语。
要求：
- 50-100 字，简洁有人味
- 结合天气和任务数量给出贴心建议或鼓励
- 可以幽默、暖心，但不要鸡汤化（避免"加油！你是最棒的！"这种空话）
- 不要以"早安"开头（卡片已有标题）
- 不要列举任务（其他模块会展示）
- 不要建议用户做什么任务管理操作`
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: ctxLines },
    ],
    temperature: 0.9,
  })
  return (res.choices[0]?.message?.content || '').trim()
}

async function chatReply(userMessage, ctx = null) {
  const sys = CHAT_SYSTEM_BASE + buildContextBlock(ctx)
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
  })
  return res.choices[0]?.message?.content || ''
}

module.exports = { parse, parseReminder, chatReply, morningGreeting }
