import { useEffect, useState } from 'react'
import { Card, Table, Switch, Tag, Button, message, Typography } from 'antd'
import { api, type ChatRoute } from '../api'

const { Paragraph } = Typography

export default function BotManage() {
  const [routes, setRoutes] = useState<ChatRoute[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { routes } = await api.listRoutes()
      setRoutes(routes)
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggle(chatId: string, enabled: boolean) {
    try {
      await api.updateRoute(chatId, { enabled })
      message.success('已更新')
      load()
    } catch (e: any) {
      message.error(e.message)
    }
  }

  async function remove(chatId: string) {
    try {
      await api.deleteRoute(chatId)
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e.message)
    }
  }

  return (
    <Card
      title="Bot 群路由配置"
      extra={<Button onClick={load} loading={loading}>刷新</Button>}
    >
      <Paragraph type="secondary">
        机器人首次接触的群/私聊会自动登记到此处。可用开关控制是否对该会话生效。
      </Paragraph>
      <Table<ChatRoute>
        rowKey="chat_id"
        dataSource={routes}
        loading={loading}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'chat_type',
            width: 100,
            render: v => <Tag color={v === 'p2p' ? 'blue' : 'green'}>{v}</Tag>,
          },
          {
            title: 'chat_id',
            dataIndex: 'chat_id',
            render: v => <code style={{ fontSize: 12 }}>{v}</code>,
          },
          {
            title: '首次接触',
            dataIndex: 'first_seen',
            width: 180,
            render: v => v ? new Date(v).toLocaleString('zh-CN') : '-',
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (v, r) => <Switch checked={v} onChange={c => toggle(r.chat_id, c)} />,
          },
          {
            title: '操作',
            width: 80,
            render: (_, r) => (
              <Button danger size="small" onClick={() => remove(r.chat_id)}>删除</Button>
            ),
          },
        ]}
        locale={{
          emptyText: '暂无路由 — 把机器人拉进群并 @它，或私聊发消息，会自动登记',
        }}
      />
    </Card>
  )
}
