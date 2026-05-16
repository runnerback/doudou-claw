const express = require('express')
const router = express.Router()

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'qclaw-api',
    bot_enabled: process.env.ENABLE_BOT === 'true',
    timestamp: new Date().toISOString(),
  })
})

module.exports = router
