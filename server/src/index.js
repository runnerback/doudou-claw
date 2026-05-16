require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { startBot } = require('./bot')
const reminderService = require('./services/reminderService')
const health = require('./routes/health')
const botRoutes = require('./routes/botRoutes')
const reminderRoutes = require('./routes/reminders')

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.use('/api/health', health)
app.use('/api/bot/routes', botRoutes)
app.use('/api/reminders', reminderRoutes)

const PORT = Number(process.env.PORT) || 13100

app.listen(PORT, async () => {
  console.log(`[server] QClaw API listening on :${PORT} (${process.env.NODE_ENV || 'development'})`)
  startBot()
  // 启动后加载现有任务（仅 ENABLE_BOT=true 时实际调度）
  await reminderService.loadAndScheduleAll()
})
