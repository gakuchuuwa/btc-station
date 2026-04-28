'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reset-password`,
    })
    if (error) { setError(error.message); setLoading(false); return }
    setDone(true)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card card-body" style={{ width: '100%', maxWidth: 400 }}>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>邮件已发送</h2>
            <p style={{ color: 'var(--text-mute)', fontSize: 13, lineHeight: 1.6 }}>
              密码重置链接已发送至 <strong style={{ color: 'var(--text)' }}>{email}</strong>，请查收。
            </p>
            <Link href="/login" style={{ display: 'block', marginTop: 20, color: 'var(--accent)', fontSize: 13 }}>
              返回登录 →
            </Link>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>忘记密码</h1>
            <p style={{ fontSize: 13, color: 'var(--text-mute)', marginBottom: 24 }}>
              输入注册邮箱，我们将发送密码重置链接。
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 6 }}>邮箱</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  style={{ width: '100%', height: 38, padding: '0 12px', borderRadius: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
                  placeholder="your@email.com"
                />
              </div>
              {error && <p style={{ fontSize: 12, color: 'var(--down)' }}>{error}</p>}
              <button type="submit" disabled={loading} className="btn btn-primary" style={{ height: 38, fontSize: 14 }}>
                {loading ? '发送中...' : '发送重置链接'}
              </button>
            </form>
            <div style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-mute)' }}>
              <Link href="/login" style={{ color: 'var(--accent)' }}>返回登录</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
