import Link from 'next/link'

export default function BacktestPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 48 }}>🧪</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>敬请期待 Phase 3</h1>
      <p style={{ color: 'var(--text-mute)', maxWidth: 420, lineHeight: 1.6 }}>
        回测引擎即将上线（含 Pro 版参数优化，查看收益曲线、胜率、最大回撤）。
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <span className="chip chip-neutral">免费限次</span>
        <span className="chip chip-pro">Pro 无限</span>
      </div>
      <Link href="/" style={{
        marginTop: 12, padding: '8px 20px', borderRadius: 4, fontSize: 13, fontWeight: 500,
        border: '1px solid var(--border-hi)', color: 'var(--text)',
      }}>← 返回首页</Link>
    </div>
  )
}
