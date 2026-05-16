require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { startBot } = require('./bot')
const health = require('./routes/health')
const botRoutes = require('./routes/botRoutes')

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.use('/api/health', health)
app.use('/api/bot/routes', botRoutes)

const PORT = Number(process.env.PORT) || 13100

app.listen(PORT, () => {
  console.log(`[server] QClaw API listening on :${PORT} (${process.env.NODE_ENV || 'development'})`)
  startBot()
})
