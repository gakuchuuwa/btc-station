'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('两次输入的密码不一致'); return }
    if (password.length < 8) { setError('密码至少 8 位'); return }
    if (!agreed) { setError('请先同意服务条款'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    if (error) { setError(error.message); setLoading(false); return }
    setDone(true)
  }

  async function handleGoogleSignup() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    })
  }

  if (done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
        <div className="card card-body" style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>请检查邮箱</h2>
          <p style={{ color: 'var(--text-mute)', fontSize: 13, lineHeight: 1.6 }}>
            验证邮件已发送至 <strong style={{ color: 'var(--text)' }}>{email}</strong>，请点击邮件中的链接完成验证后即可登录。
          </p>
          <Link href="/login" style={{ display: 'block', marginTop: 20, color: 'var(--accent)', fontSize: 13 }}>
            前往登录 →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card card-body" style={{ width: '100%', maxWidth: 400 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>注册</h1>

        <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} placeholder="your@email.com" />
          </div>
          <div>
            <label style={labelStyle}>密码（至少 8 位）</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} placeholder="••••••••" />
          </div>
          <div>
            <label style={labelStyle}>确认密码</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required style={inputStyle} placeholder="••••••••" />
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.5 }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--accent)' }} />
            <span>我已阅读并同意 <Link href="/terms" style={{ color: 'var(--accent)' }}>服务条款</Link> 和 <Link href="/privacy" style={{ color: 'var(--accent)' }}>隐私政策</Link></span>
          </label>
          {error && <p style={{ fontSize: 12, color: 'var(--down)' }}>{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ height: 38, fontSize: 14, marginTop: 4 }}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>或</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <button onClick={handleGoogleSignup} className="btn btn-ghost" style={{ width: '100%', height: 38, fontSize: 13, gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          使用 Google 注册
        </button>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-mute)' }}>
          已有账号？<Link href="/login" style={{ color: 'var(--accent)' }}>登录</Link>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 6 }
const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 12px', borderRadius: 4,
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
}
