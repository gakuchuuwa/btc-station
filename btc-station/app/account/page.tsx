'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

type Tab = 'profile' | 'preferences' | 'security'

const TF_OPTIONS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w']
const TF_LABELS: Record<string, string> = {
  '1m': '1 分钟', '5m': '5 分钟', '15m': '15 分钟',
  '1h': '1 小时', '4h': '4 小时', '1d': '日线', '1w': '周线',
}

export default function AccountPage() {
  const [tab, setTab] = useState<Tab>('profile')
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
    }
    fetchUser()
  }, [])

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 8 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>账户设置</h1>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {([
          { key: 'profile', label: '个人资料' },
          { key: 'preferences', label: '偏好设置' },
          { key: 'security', label: '安全' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            background: 'none', border: 'none',
            color: tab === key ? 'var(--text)' : 'var(--text-mute)',
            borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab user={user} />}
      {tab === 'preferences' && <PreferencesTab />}
      {tab === 'security' && <SecurityTab user={user} />}
    </div>
  )
}

function ProfileTab({ user }: { user: User | null }) {
  const [displayName, setDisplayName] = useState(user?.user_metadata?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const supabase = createClient()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.auth.updateUser({ data: { full_name: displayName } })
    await supabase.from('profiles').update({ display_name: displayName, updated_at: new Date().toISOString() }).eq('id', user!.id)
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="card card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>显示名称</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} placeholder="你的名字" />
        </div>
        <div>
          <label style={labelStyle}>邮箱</label>
          <input value={user?.email ?? ''} readOnly style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>邮箱不可修改</p>
        </div>
        <div>
          <label style={labelStyle}>注册时间</label>
          <input value={user?.created_at ? new Date(user.created_at).toLocaleDateString('zh-CN') : ''} readOnly
            style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
        </div>
        <div>
          <label style={labelStyle}>订阅计划</label>
          <span className="chip chip-neutral">免费版</span>
        </div>
        <button type="submit" disabled={saving} className="btn btn-primary" style={{ alignSelf: 'flex-start', height: 34, fontSize: 13 }}>
          {saved ? '已保存 ✓' : saving ? '保存中...' : '保存更改'}
        </button>
      </form>
    </div>
  )
}

function PreferencesTab() {
  const [defaultTf, setDefaultTf] = useState('1h')
  const [ma, setMa] = useState(true)
  const [rsi, setRsi] = useState(false)
  const [macd, setMacd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    // 从 localStorage 读取偏好
    try {
      const stored = JSON.parse(localStorage.getItem('btc_prefs') ?? '{}')
      if (stored.default_timeframe) setDefaultTf(stored.default_timeframe)
      if (stored.indicators) {
        setMa(stored.indicators.ma?.enabled ?? true)
        setRsi(stored.indicators.rsi?.enabled ?? false)
        setMacd(stored.indicators.macd?.enabled ?? false)
      }
    } catch {/* ignore */}
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const prefs = {
      default_timeframe: defaultTf,
      indicators: {
        ma: { enabled: ma, periods: [20, 50] },
        rsi: { enabled: rsi, period: 14 },
        macd: { enabled: macd },
      },
      theme: 'dark',
    }
    localStorage.setItem('btc_prefs', JSON.stringify(prefs))
    // 尝试同步到服务端（需要登录）
    try {
      await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: prefs }),
      })
    } catch {/* 未登录时忽略 */}
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="card card-body">
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>默认时间周期</label>
          <select value={defaultTf} onChange={e => setDefaultTf(e.target.value)}
            style={{ ...inputStyle, width: 'auto', paddingRight: 32, cursor: 'pointer' }}>
            {TF_OPTIONS.map(tf => (
              <option key={tf} value={tf}>{TF_LABELS[tf]}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>默认启用的指标</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {[
              { key: 'ma', label: 'MA（20、50 均线）', value: ma, set: setMa },
              { key: 'rsi', label: 'RSI（14）', value: rsi, set: setRsi },
              { key: 'macd', label: 'MACD（12, 26, 9）', value: macd, set: setMacd },
            ].map(({ key, label, value, set }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={value} onChange={e => set(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>主题</label>
          <span style={{ fontSize: 13, color: 'var(--text-mute)' }}>深色（Light 模式将在后续版本推出）</span>
        </div>
        <button type="submit" disabled={saving} className="btn btn-primary" style={{ alignSelf: 'flex-start', height: 34, fontSize: 13 }}>
          {saved ? '已保存 ✓' : saving ? '保存中...' : '保存偏好'}
        </button>
      </form>
    </div>
  )
}

function SecurityTab({ user }: { user: User | null }) {
  const [current, setCurrent] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const supabase = createClient()

  const isOAuth = user?.app_metadata?.provider !== 'email'

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirm) { setMsg('两次密码不一致'); return }
    if (newPw.length < 8) { setMsg('新密码至少 8 位'); return }
    setLoading(true); setMsg('')
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setMsg(error.message) } else { setMsg('密码已更新'); setCurrent(''); setNewPw(''); setConfirm('') }
    setLoading(false)
  }

  return (
    <div className="card card-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {isOAuth ? (
        <p style={{ fontSize: 13, color: 'var(--text-mute)' }}>
          你使用 Google 登录，无需设置密码。
        </p>
      ) : (
        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>修改密码</h3>
          <div>
            <label style={labelStyle}>新密码（至少 8 位）</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required style={inputStyle} placeholder="••••••••" />
          </div>
          <div>
            <label style={labelStyle}>确认新密码</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required style={inputStyle} placeholder="••••••••" />
          </div>
          {msg && <p style={{ fontSize: 12, color: msg.includes('已更新') ? 'var(--up)' : 'var(--down)' }}>{msg}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ alignSelf: 'flex-start', height: 34, fontSize: 13 }}>
            {loading ? '更新中...' : '更新密码'}
          </button>
        </form>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>危险操作</h3>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 12 }}>
          删除账号功能将在正式上线前开放。如需删除请联系支持。
        </p>
        <button disabled className="btn btn-ghost" style={{ height: 34, fontSize: 13, opacity: 0.4, cursor: 'not-allowed', color: 'var(--down)', borderColor: 'var(--down)' }}>
          删除账号
        </button>
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
