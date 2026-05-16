const BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export type ChatRoute = {
  chat_id: string
  chat_type: string
  name: string
  enabled: boolean
  first_seen?: string
}

export const api = {
  health: () => request<{ status: string; bot_enabled: boolean; timestamp: string }>('/api/health'),
  listRoutes: () => request<{ routes: ChatRoute[] }>('/api/bot/routes'),
  updateRoute: (chatId: string, updates: Partial<ChatRoute>) =>
    request(`/api/bot/routes/${encodeURIComponent(chatId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  deleteRoute: (chatId: string) =>
    request(`/api/bot/routes/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
}
