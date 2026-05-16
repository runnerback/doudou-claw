/**
 * 简单 JSON 存储：bot 接触过的群/私聊列表 + 启用状态
 * 文件：server/data/chats.json（rsync 排除，本地与 ECS 各自维护）
 */
const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '../../data')
const FILE = path.join(DATA_DIR, 'chats.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadChats() {
  ensureDir()
  if (!fs.existsSync(FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveChats(chats) {
  ensureDir()
  fs.writeFileSync(FILE, JSON.stringify(chats, null, 2) + '\n', 'utf-8')
}

function learnChat(chatId, chatType) {
  if (!chatId) return false
  const chats = loadChats()
  if (chats.find(c => c.chat_id === chatId)) return false
  chats.push({
    chat_id: chatId,
    chat_type: chatType || 'unknown',
    name: chatId,
    enabled: true,
    first_seen: new Date().toISOString(),
  })
  saveChats(chats)
  return true
}

function getChat(chatId) {
  return loadChats().find(c => c.chat_id === chatId) || null
}

function updateChat(chatId, updates) {
  const chats = loadChats()
  const idx = chats.findIndex(c => c.chat_id === chatId)
  if (idx === -1) return
  chats[idx] = { ...chats[idx], ...updates }
  saveChats(chats)
}

function deleteChat(chatId) {
  const chats = loadChats().filter(c => c.chat_id !== chatId)
  saveChats(chats)
}

module.exports = { loadChats, saveChats, learnChat, getChat, updateChat, deleteChat }
