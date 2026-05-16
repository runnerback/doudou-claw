const express = require('express')
const { loadChats, updateChat, deleteChat } = require('../utils/chatStore')

const router = express.Router()

// GET /api/bot/routes — 当前所有学习到的群/私聊 + 启用状态
router.get('/', (req, res) => {
  res.json({ routes: loadChats() })
})

// PUT /api/bot/routes/:chatId — 更新群名 / 启用状态
router.put('/:chatId', (req, res) => {
  const { chatId } = req.params
  const updates = req.body || {}
  updateChat(chatId, updates)
  res.json({ ok: true })
})

// DELETE /api/bot/routes/:chatId — 移除路由
router.delete('/:chatId', (req, res) => {
  deleteChat(req.params.chatId)
  res.json({ ok: true })
})

module.exports = router
