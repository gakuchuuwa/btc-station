import Link from 'next/link'
import { strategies } from '@/lib/strategies'

const CATEGORY_LABELS: Record<string, string> = {
  trend: '趋势跟踪',
  'mean-reversion': '均值回归',
  breakout: '区间突破',
  dca: '定投',
}

export default function StrategiesPage() {
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 20px 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          Local backtests · No Python service
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>本地策略回测</h1>
        <p style={{ maxWidth: 700, margin: '0 auto', color: 'var(--text-mute)', lineHeight: 1.8, fontSize: 14 }}>
          选择一个内置示例，在浏览器中生成信号并运行 TypeScript 回测。历史 K 线通过本站 Next.js API 从 OKX 公共接口获取；策略计算无需 Python、登录或付费后端。
        </p>
      </div>

      <div style={{ padding: '13px 16px', marginBottom: 22, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(255,255,255,.025)', color: 'var(--text-mute)', fontSize: 12, lineHeight: 1.7 }}>
        回测仅供研究示例。结果会受交易周期、样本区间、手续费和滑点影响；不构成投资建议，也不代表未来表现。当前示例仅做多，不含真实订单执行。
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        {strategies.map(strategy => (
          <Link key={strategy.id} href={`/strategies/${strategy.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <article style={{ height: '100%', padding: 20, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', transition: 'border-color .15s, transform .15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{strategy.name}</h2>
                <span style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 999, color: 'var(--text-mute)', fontSize: 10, whiteSpace: 'nowrap' }}>
                  {CATEGORY_LABELS[strategy.category] ?? '策略'}
                </span>
              </div>
              <p style={{ minHeight: 60, margin: '0 0 14px', color: 'var(--text-mute)', lineHeight: 1.7, fontSize: 13 }}>{strategy.description}</p>
              <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>设置参数并回测 <span aria-hidden="true">→</span></div>
            </article>
          </Link>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 24 }}>
        <Link href="/hyperopt" className="btn btn-primary">本地搜索参数</Link>
        <Link href="/chart" className="btn btn-ghost">打开 K 线图表</Link>
        <Link href="/report" className="btn btn-ghost">导入回测 CSV 做稳健性分析</Link>
      </div>
    </div>
  )
}
