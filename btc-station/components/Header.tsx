'use client'

import { useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { formatUsd, formatPercent } from '@/lib/format'

const NAV = [
  { label: '首页', href: '/' },
  { label: '图表', href: '/chart' },
  { label: '策略', href: '/strategies' },
  { label: '回测', href: '/backtest', pro: true },
  { label: '实盘', href: '/live' },
]

interface TickerInfo {
  price: number
  change24h: number
  high24h: number
  low24h: number
  vol24h: number
}

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  // Ticker 实时数据
  const [tick, setTick] = useState<TickerInfo | null>(null)

  // 拉取 ticker
  useEffect(() => {
    async function fetchTicker() {
      try {
        const res = await fetch('/api/chart/ticker')
        if (!res.ok) return
        const d = await res.json()
        setTick({
          price: d.lastPrice,
          change24h: d.open24h > 0 ? (d.lastPrice - d.open24h) / d.open24h * 100 : 0,
          high24h: d.high24h,
          low24h: d.low24h,
          vol24h: d.volCcy24h,
        })
      } catch {/* silent */}
    }
    fetchTicker()
    const id = setInterval(fetchTicker, 15_000) // 每 15 秒刷新
    return () => clearInterval(id)
  }, [])

  // Auth
  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => setUser(data.user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // 点外面关闭菜单
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setShowMenu(false)
    router.push('/')
    router.refresh()
  }

  const avatarLetter = user?.email?.[0]?.toUpperCase() ?? '?'

  // 格式化大数字
  function fmtVol(n: number) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
    return n.toFixed(0)
  }

  const tickIsUp = tick ? tick.change24h >= 0 : true

  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <div className="header-left">
          <Link href="/" className="brand">
            <div className="brand-icon">₿</div>
            <span className="brand-name">BTC Station</span>
            <span className="beta">BETA</span>
          </Link>
          <nav className="nav">
            {NAV.map(({ label, href, pro }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
              return (
                <Link key={href} href={href} className={active ? 'active' : ''}>
                  {label}
                  {pro && <span className="chip chip-pro">Pro</span>}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="header-right">
          <div className="search-box">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <span>搜索...</span>
            <span className="kbd mono">⌘K</span>
          </div>

          {user ? (
            /* 已登录：头像菜单 */
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowMenu(p => !p)}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--accent)', color: '#fff',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {user.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                ) : avatarLetter}
              </button>
              {showMenu && (
                <div style={{
                  position: 'absolute', right: 0, top: 36, zIndex: 50, minWidth: 180,
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                  overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {user.user_metadata?.full_name ?? '用户'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 2 }}>{user.email}</div>
                  </div>
                  <Link href="/account" onClick={() => setShowMenu(false)} style={menuItemStyle}>账户设置</Link>
                  <Link href="/strategies" onClick={() => setShowMenu(false)} style={menuItemStyle}>我的策略</Link>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  <button onClick={handleSignOut} style={{ ...menuItemStyle, width: '100%', textAlign: 'left', color: 'var(--down)' }}>
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* 未登录：登录/注册按钮 */
            <>
              <Link href="/login" className="btn btn-ghost">登录</Link>
              <Link href="/signup" className="btn btn-primary">注册</Link>
            </>
          )}
        </div>
      </div>

      {/* Ticker strip — 实时数据 */}
      <div className="ticker">
        <div className="wrap ticker-inner" style={{ padding: 0, maxWidth: 'var(--max-w)' }}>
          <div className="ticker-cell">
            <span className="label">BTC/USDT</span>
            <span className="num">{tick ? formatUsd(tick.price) : '—'}</span>
            {tick && (
              <span className={`num ${tickIsUp ? 'up' : 'down'}`} style={{ fontSize: 10 }}>
                {formatPercent(tick.change24h)}
              </span>
            )}
          </div>
          <div className="ticker-cell">
            <span className="label">24h 最高</span>
            <span className="num">{tick ? formatUsd(tick.high24h) : '—'}</span>
          </div>
          <div className="ticker-cell">
            <span className="label">24h 最低</span>
            <span className="num">{tick ? formatUsd(tick.low24h) : '—'}</span>
          </div>
          <div className="ticker-cell">
            <span className="label">24h 成交量</span>
            <span className="num">{tick ? '$' + fmtVol(tick.vol24h) : '—'}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', padding: '9px 14px', fontSize: 13,
  color: 'var(--text)', cursor: 'pointer',
  background: 'none', border: 'none', textDecoration: 'none',
}
