'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('两次输入的密码不一致'); return }
    if (password.length < 8) { setError('密码至少 8 位'); return }
    setLoading(true); setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/login')
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 38, padding: '0 12px', borderRadius: 4,
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    color: 'var(--text)', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div className="card card-body" style={{ width: '100%', maxWidth: 400 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>设置新密码</h1>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 6 }}>新密码（至少 8 位）</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} placeholder="••••••••" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-mute)', display: 'block', marginBottom: 6 }}>确认新密码</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required style={inputStyle} placeholder="••••••••" />
          </div>
          {error && <p style={{ fontSize: 12, color: 'var(--down)' }}>{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ height: 38, fontSize: 14 }}>
            {loading ? '更新中...' : '更新密码'}
          </button>
        </form>
      </div>
    </div>
  )
}
