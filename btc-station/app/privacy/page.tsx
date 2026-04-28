import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '隐私政策 — BTC Station',
}

const sectionStyle: React.CSSProperties = { marginBottom: 28 }
const h2Style: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }
const pStyle: React.CSSProperties = { color: 'var(--text-mute)', lineHeight: 1.8, fontSize: 13, marginBottom: 8 }

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 0 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>隐私政策</h1>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 32 }}>最后更新：2026 年 4 月</p>

      <div style={sectionStyle}>
        <h2 style={h2Style}>1. 信息收集</h2>
        <p style={pStyle}>
          当你注册 BTC Station 账户时，我们会收集以下信息：
        </p>
        <ul style={{ ...pStyle, paddingLeft: 24 }}>
          <li>邮箱地址（用于账户验证和登录）</li>
          <li>显示名称（可选，用于个性化体验）</li>
          <li>Google 账户基本信息（仅在使用 Google 登录时，包括名称和头像）</li>
        </ul>
        <p style={pStyle}>
          我们不会收集你的真实姓名、身份证号、银行卡信息或任何交易所 API 密钥（Phase 2.1 阶段）。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>2. 信息使用</h2>
        <p style={pStyle}>
          我们收集的信息仅用于以下目的：
        </p>
        <ul style={{ ...pStyle, paddingLeft: 24 }}>
          <li>提供账户认证和登录服务</li>
          <li>保存你的图表偏好设置（如默认时间周期、启用的指标）</li>
          <li>改善产品体验和修复技术问题</li>
          <li>发送账户相关通知（如密码重置邮件）</li>
        </ul>
        <p style={pStyle}>我们不会将你的个人信息用于广告推送或出售给第三方。</p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>3. 数据存储</h2>
        <p style={pStyle}>
          你的账户数据存储在 Supabase 提供的云数据库中（托管于 AWS 东京区域）。我们采取合理的技术和组织措施保护你的数据安全，包括但不限于：行级安全策略（RLS）、加密传输（HTTPS）、以及 HTTP-only Cookie 会话管理。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>4. Cookie 与本地存储</h2>
        <p style={pStyle}>
          本服务使用以下技术存储少量数据：
        </p>
        <ul style={{ ...pStyle, paddingLeft: 24 }}>
          <li><strong style={{ color: 'var(--text)' }}>Cookie</strong> — 用于维持登录会话状态（HTTP-only，防 XSS）</li>
          <li><strong style={{ color: 'var(--text)' }}>localStorage</strong> — 用于保存未登录用户的图表偏好设置（如时间周期、指标选择）</li>
        </ul>
        <p style={pStyle}>
          我们不使用第三方跟踪 Cookie 或广告追踪技术。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>5. 第三方服务</h2>
        <p style={pStyle}>
          本服务使用以下第三方服务：
        </p>
        <ul style={{ ...pStyle, paddingLeft: 24 }}>
          <li><strong style={{ color: 'var(--text)' }}>Supabase</strong> — 用户认证和数据库</li>
          <li><strong style={{ color: 'var(--text)' }}>Google OAuth</strong> — 可选的第三方登录</li>
          <li><strong style={{ color: 'var(--text)' }}>OKX 公共 API</strong> — 行情数据（不涉及用户信息）</li>
          <li><strong style={{ color: 'var(--text)' }}>Vercel</strong> — 网站托管</li>
        </ul>
        <p style={pStyle}>
          这些第三方服务各有其独立的隐私政策，我们建议你了解相关条款。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>6. 数据删除</h2>
        <p style={pStyle}>
          你有权要求删除你的账户和所有相关数据。账户删除功能将在后续版本中开放。在此之前，如需删除账户，请通过邮件联系我们。删除账户后，你的所有数据将从数据库中永久移除。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>7. 政策更新</h2>
        <p style={pStyle}>
          我们可能会不时更新本隐私政策。更新后的政策将在本页面公布，重大变更时我们会通过邮件通知已注册用户。继续使用本服务即表示接受更新后的隐私政策。
        </p>
      </div>

      <div style={{ marginTop: 32 }}>
        <Link href="/" style={{
          padding: '8px 20px', borderRadius: 4, fontSize: 13, fontWeight: 500,
          border: '1px solid var(--border-hi)', color: 'var(--text)',
        }}>← 返回首页</Link>
      </div>
    </div>
  )
}
