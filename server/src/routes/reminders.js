const express = require('express')
const reminderService = require('../services/reminderService')

const router = express.Router()

router.get('/', (req, res) => {
  res.json({ reminders: reminderService.loadLocal() })
})

router.post('/reload', async (req, res) => {
  try {
    await reminderService.loadAndScheduleAll()
    res.json({ ok: true, count: reminderService.loadLocal().length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 手动触发一次 sync（不用等 60s 周期）
router.post('/sync', async (req, res) => {
  try {
    await reminderService.syncFromBitable('manual')
    res.json({ ok: true, count: reminderService.loadLocal().length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/:recordId', async (req, res) => {
  try {
    await reminderService.deleteReminder(req.params.recordId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:recordId/pause', async (req, res) => {
  try {
    await reminderService.pauseReminder(req.params.recordId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
