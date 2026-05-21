import Link from 'next/link';
import { strategies } from '@/lib/strategies';

export default function StrategiesPage() {
  const categories = {
    'trend': '趋势',
    'mean-reversion': '均值回归',
    'breakout': '突破',
    'dca': '定投'
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-[var(--text)] mb-3">策略库</h1>
        <p className="text-[var(--text-mute)]">从经典到进阶的 BTC 交易策略，一键回测验证想法</p>
      </div>

      {/* Phase 3.1 入口 */}
      <div className="mb-8 p-5 rounded-xl border border-[var(--up)] bg-[var(--up-soft)] flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base font-bold text-[var(--text)]">Python 策略编辑器</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--up)] text-white font-medium">新</span>
          </div>
          <p className="text-sm text-[var(--text-mute)] leading-relaxed">
            用 Freqtrade IStrategy 写自己的策略，支持 5 年完整历史回测、永续合约精确模拟（含资金费率），生成可上传到 quant-lab.org 的 191 列 CSV。
          </p>
        </div>
        <Link
          href="/strategies/editor"
          className="flex-shrink-0 px-5 py-2.5 rounded-lg bg-[var(--up)] hover:bg-[#1f8c6a] text-white font-semibold text-sm transition-colors"
        >
          打开编辑器 →
        </Link>
      </div>

      <div className="flex gap-2 mb-6 justify-center">
        <button className="px-4 py-1.5 rounded-full bg-[var(--border-hi)] text-[var(--text)] text-sm font-medium">全部</button>
        {Object.entries(categories).map(([key, label]) => (
          <button key={key} className="px-4 py-1.5 rounded-full border border-[var(--border)] text-[var(--text-mute)] hover:text-[var(--text)] text-sm font-medium transition-colors">
            {label}
          </button>
        ))}
      </div>

      {/* 基准说明 - 让用户知道实测数据怎么读 */}
      <div className="mb-4 px-4 py-2.5 rounded-md bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text-mute)] leading-relaxed">
        <span className="font-semibold text-[var(--text)]">📊 实测基准</span>
        <span className="mx-2">·</span>
        Buy &amp; Hold 同期: <span className="font-mono text-[var(--up)]">+2100%</span> 收益 / <span className="font-mono text-red-400">-77%</span> 回撤 / Calmar <span className="font-mono">27.3</span>
        <span className="mx-2">·</span>
        策略要值得用,Calmar 必须明显高于这个数字
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {strategies.map((s) => (
          <Link href={`/strategies/${s.id}`} key={s.id} className="block group">
            <div className="h-full flex flex-col p-6 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--primary)] hover:shadow-[0_0_15px_rgba(38,161,123,0.1)] transition-all">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-lg font-bold text-[var(--text)] group-hover:text-[var(--primary)] transition-colors">{s.name}</h2>
                <div className="flex text-yellow-500 text-sm">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className={i < s.difficulty ? 'opacity-100' : 'opacity-20'}>★</span>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <span className="text-xs font-medium px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text-mute)]">
                  {categories[s.category]}
                </span>
              </div>
              <p className="text-[var(--text-mute)] text-sm leading-relaxed mb-4 line-clamp-3">
                {s.description}
              </p>

              {/* 实测数据 + 评级标签 - 不骗人,数据来自统一脚本 5 年 BTC 4h 实测 */}
              {s.backtestStats && (() => {
                const stats = s.backtestStats;
                const ratingBadge =
                  stats.rating === 'good'  ? { txt: '✅ 实战可用', cls: 'bg-[var(--up-soft)] text-[var(--up)] border-[var(--up)]' } :
                  stats.rating === 'demo'  ? { txt: '⚠️ 仅作演示', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/40' } :
                                             { txt: '❌ 不推荐',   cls: 'bg-red-500/10 text-red-400 border-red-500/40' };
                return (
                  <div className="mb-4 flex-grow flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${ratingBadge.cls}`}>{ratingBadge.txt}</span>
                      <span className="text-[10px] text-[var(--text-mute)]">5 年 BTC 4h 实测</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center bg-[var(--bg)] rounded-md p-2 border border-[var(--border)]">
                      <div>
                        <div className={`text-sm font-bold font-mono ${stats.returnPct >= 0 ? 'text-[var(--up)]' : 'text-red-400'}`}>
                          {stats.returnPct >= 0 ? '+' : ''}{stats.returnPct >= 1000 ? (stats.returnPct/100).toFixed(0)+'×' : stats.returnPct.toFixed(0)+'%'}
                        </div>
                        <div className="text-[9px] text-[var(--text-mute)] mt-0.5">总收益</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono text-red-400">-{stats.ddPct.toFixed(0)}%</div>
                        <div className="text-[9px] text-[var(--text-mute)] mt-0.5">最大回撤</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono text-[var(--text)]">{stats.calmar.toFixed(1)}</div>
                        <div className="text-[9px] text-[var(--text-mute)] mt-0.5">Calmar</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-[var(--text-mute)] leading-relaxed italic">{stats.honestNote}</p>
                  </div>
                );
              })()}
              {!s.backtestStats && <div className="flex-grow" />}

              <div className="text-[var(--primary)] text-sm font-medium flex items-center group-hover:translate-x-1 transition-transform">
                查看详情 <span className="ml-1">→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
