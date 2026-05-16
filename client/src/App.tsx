import { Layout, Menu } from 'antd'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import BotManage from './pages/BotManage'
import H5 from './pages/H5'

const { Header, Content, Footer } = Layout

export default function App() {
  const loc = useLocation()
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ color: '#fff', fontWeight: 600, marginRight: 40, fontSize: 16 }}>
          🦞 QClaw
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[loc.pathname]}
          style={{ flex: 1 }}
          items={[
            { key: '/', label: <Link to="/">首页</Link> },
            { key: '/bot-manage', label: <Link to="/bot-manage">Bot 管理</Link> },
            { key: '/h5', label: <Link to="/h5">业务页面</Link> },
          ]}
        />
      </Header>
      <Content style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bot-manage" element={<BotManage />} />
          <Route path="/h5" element={<H5 />} />
        </Routes>
      </Content>
      <Footer style={{ textAlign: 'center' }}>
        QClaw · 飞书机器人助手 · {new Date().getFullYear()}
      </Footer>
    </Layout>
  )
}
