import { useEffect, useState } from 'react'
import { Card, Typography, Tag, Space, Descriptions } from 'antd'
import { api } from '../api'

const { Title, Paragraph } = Typography

export default function Home() {
  const [health, setHealth] = useState<{ status: string; bot_enabled: boolean; timestamp: string } | null>(null)
  const [err, setErr] = useState<string>('')

  useEffect(() => {
    api.health().then(setHealth).catch(e => setErr(e.message))
  }, [])

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Title level={2}>🦞 QClaw 助手</Title>
        <Paragraph>飞书机器人 · 24/7 部署在 ECS · 替代「电脑必须开机才能用」的桌面助手方案</Paragraph>
        <Paragraph type="secondary">
          当前阶段：MVP 框架，仅支持消息互动（echo）。后续按需求接入任务获取、任务推送、LLM 智能回复。
        </Paragraph>
      </Card>

      <Card title="服务状态" size="small">
        {err && <Paragraph type="danger">无法连接后端：{err}</Paragraph>}
        {health && (
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="状态">
              <Tag color="green">{health.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Bot 长连接">
              {health.bot_enabled
                ? <Tag color="blue">已启用 (ENABLE_BOT=true)</Tag>
                : <Tag>未启用</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="时间">
              {new Date(health.timestamp).toLocaleString('zh-CN', { hour12: false })}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>
    </Space>
  )
}
