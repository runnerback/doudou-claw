import { Card, Typography, Empty } from 'antd'

const { Title, Paragraph } = Typography

export default function H5() {
  return (
    <Card>
      <Title level={3}>业务 H5 页面（占位）</Title>
      <Paragraph type="secondary">
        飞书内打开此页面 → 任务管理 / 笔记 / 知识库 等业务功能。
      </Paragraph>
      <Paragraph>
        当前仅作占位以满足飞书开放平台「网页应用主页地址」要求。具体业务需求确定后填充。
      </Paragraph>
      <Empty description="敬请期待" />
    </Card>
  )
}
