'use client'

import { useState, useRef, useCallback } from 'react'

interface Row {
  pattern: string
  trades: number
  wins: number
  losses: number
  win_rate: number
  total_pnl_usdt: number
  avg_pnl_pct: number
  profit_factor: number | null
  max_win_usdt: number
  max_loss_usdt: number
  avg_win_usdt: number
  avg_loss_usdt: number
  kelly: number
  long_trades: number
  short_trades: number
}
interface Total {
  trades: number
  wins: number
  win_rate: number
  total_pnl_usdt: number
  avg_pnl_pct: number
  long_trades: number
  short_trades: number
  // 来自 TradingView 汇总 sheet（xlsx 时有值）
  net_profit_pct?: number
  max_drawdown_usdt?: number
  max_drawdown_pct?: number
  cagr_pct?: number
  commission_usdt?: number
  sharpe?: number
  sortino?: number
  profit_factor?: number
  avg_win_usdt?: number
  avg_loss_usdt?: number
  win_loss_ratio?: number
  max_win_usdt_sheet?: number
  max_loss_usdt_sheet?: number
}
interface Resp { summary: Row[]; total: Total; filename: string }

const fmtMoney = (n: number) =>
  (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' USDT'
const fmtPct = (n: number, d = 2) => (n >= 0 ? '+' : '') + n.toFixed(d) + '%'

// 趋势策略不踏空：凯利推荐仓位最低按 1% 保底
const KELLY_FLOOR = 0.01
const kellyPos = (k: number) => Math.max(k, KELLY_FLOOR)

type SortKey = 'pattern' | 'trades' | 'win_rate' | 'total_pnl_usdt' | 'avg_pnl_pct' | 'profit_factor' | 'kelly'

export default function PatternReportPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('total_pnl_usdt')
  const [sortDesc, setSortDesc] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    setLoading(true); setErr(''); setData(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/py-api/api/pattern-report/analyze', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.detail || '解析失败')
      setData(json)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }

  const sortedRows = data ? [...data.summary].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity
    const bv = b[sortKey] ?? -Infinity
    if (typeof av === 'string' || typeof bv === 'string') {
      return sortDesc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
    }
    return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number)
  }) : []

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc(d => !d)
    else { setSortKey(k); setSortDesc(true) }
  }

  const exportCsv = () => {
    if (!data) return
    const header = ['形态', '交易次数', '盈利', '亏损', '胜率', '总净收益USDT', '平均收益率%', '盈亏比', '最大盈利USDT', '最大亏损USDT', '平均盈利USDT', '平均亏损USDT', '凯利仓位%', '半凯利仓位%', '相对仓位(最差=1)']
    const lines = [header.join(',')]
    sortedRows.forEach(r => {
      lines.push([
        r.pattern, r.trades, r.wins, r.losses,
        (r.win_rate * 100).toFixed(2) + '%',
        r.total_pnl_usdt, r.avg_pnl_pct,
        r.profit_factor ?? '',
        r.max_win_usdt, r.max_loss_usdt,
        r.avg_win_usdt, r.avg_loss_usdt,
        (kellyPos(r.kelly) * 100).toFixed(2),
        (kellyPos(r.kelly * 0.5) * 100).toFixed(2),
        (kellyPos(r.kelly) / minKellyPos).toFixed(1),
      ].join(','))
    })
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `pattern_report_${Date.now()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const maxAbsPnl = data ? Math.max(...data.summary.map(r => Math.abs(r.total_pnl_usdt)), 1) : 1
  // 相对仓位基准：全部形态保底后凯利的最小值（最差形态 = 1）
  const minKellyPos = data ? Math.min(...data.summary.map(r => kellyPos(r.kelly))) : KELLY_FLOOR

  return (
    <div style={{ maxWidth: 'var(--max-w)', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>形态归因分析</h1>
        <div style={{ fontSize: 13, color: 'var(--text-mute)', lineHeight: 1.7 }}>
          上传 TradingView 策略测试器导出的"交易清单"（xlsx / csv），自动按形态（P1–P99）匹配进场信号与出场盈亏，
          计算各形态的胜率与净收益。基于"交易 #"合并行，正则 <code style={{ color: 'var(--accent)' }}>(P\d+)</code> 提取形态。
        </div>
      </div>

      {/* 上传区 */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          background: dragOver ? 'var(--accent-soft)' : 'var(--card)',
          borderRadius: 10, padding: '40px 24px', textAlign: 'center',
          cursor: 'pointer', transition: 'all 0.15s', marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          {loading ? '解析中…' : '拖拽文件到此处，或点击选择'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>
          支持 .xlsx（多 sheet 自动选"交易清单"） / .csv
        </div>
        <input
          ref={inputRef} type="file" accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }}
        />
      </div>

      {err && (
        <div style={{
          padding: '14px 18px', borderRadius: 8, marginBottom: 24,
          background: 'var(--down-soft)', border: '1px solid var(--down)',
          color: 'var(--down)', fontSize: 13,
        }}>错误：{err}</div>
      )}

      {data && (
        <>
          {/* 总览 */}
          <div className="card" style={{ padding: '18px 22px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              总览 · {data.filename}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 16 }}>
              {[
                { k: '总交易数', v: String(data.total.trades), color: 'var(--text)' },
                { k: '胜率', v: (data.total.win_rate * 100).toFixed(2) + '%', color: data.total.win_rate >= 0.5 ? 'var(--up)' : 'var(--down)' },
                { k: '总净收益', v: fmtMoney(data.total.total_pnl_usdt), color: data.total.total_pnl_usdt >= 0 ? 'var(--up)' : 'var(--down)' },
                { k: '平均收益率', v: fmtPct(data.total.avg_pnl_pct), color: data.total.avg_pnl_pct >= 0 ? 'var(--up)' : 'var(--down)' },
                { k: '多空分布', v: `${data.total.long_trades}多 / ${data.total.short_trades}空`, color: 'var(--text-mute)' },
              ].map(c => (
                <div key={c.k}>
                  <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 4 }}>{c.k}</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: c.color }}>{c.v}</div>
                </div>
              ))}
            </div>

            {/* 风险指标（xlsx 才有） */}
            {data.total.sharpe !== undefined && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-mute)', marginBottom: 10, letterSpacing: '0.06em' }}>
                  策略风险指标（来自文件汇总 Sheet）
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
                  {([
                    { k: '夏普比率', v: data.total.sharpe?.toFixed(3), color: (data.total.sharpe ?? 0) >= 1 ? 'var(--up)' : 'var(--gold)' },
                    { k: 'Sortino', v: data.total.sortino?.toFixed(3), color: (data.total.sortino ?? 0) >= 1 ? 'var(--up)' : 'var(--gold)' },
                    { k: '盈利因子', v: data.total.profit_factor?.toFixed(2), color: (data.total.profit_factor ?? 0) >= 2 ? 'var(--up)' : 'var(--gold)' },
                    { k: '最大回撤', v: data.total.max_drawdown_pct !== undefined ? `-${data.total.max_drawdown_pct?.toFixed(2)}%` : undefined, color: 'var(--down)' },
                    { k: 'CAGR', v: data.total.cagr_pct !== undefined ? `${data.total.cagr_pct?.toFixed(2)}%` : undefined, color: 'var(--up)' },
                    { k: '已付佣金', v: data.total.commission_usdt !== undefined ? `${data.total.commission_usdt?.toFixed(2)} U` : undefined, color: 'var(--text-mute)' },
                  ] as { k: string; v: string | undefined; color: string }[]).filter(c => c.v !== undefined).map(c => (
                    <div key={c.k}>
                      <div style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 3 }}>{c.k}</div>
                      <div className="num" style={{ fontSize: 15, fontWeight: 700, color: c.color }}>{c.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 净收益柱状图（横向） */}
          <div className="card" style={{ padding: '18px 22px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>各形态净收益对比</div>
              <button onClick={exportCsv} style={{
                padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: '1px solid var(--accent)',
                background: 'var(--accent-soft)', color: 'var(--accent)',
              }}>↓ 导出 CSV</button>
            </div>
            {sortedRows.map(r => {
              const ratio = Math.abs(r.total_pnl_usdt) / maxAbsPnl
              const positive = r.total_pnl_usdt >= 0
              return (
                <div key={r.pattern} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 60, fontSize: 12, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{r.pattern}</div>
                  <div style={{ flex: 1, height: 22, position: 'relative', display: 'flex' }}>
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                      {!positive && (
                        <div style={{ width: `${ratio * 100}%`, height: '100%', background: 'var(--down)', borderRadius: '3px 0 0 3px' }} />
                      )}
                    </div>
                    <div style={{ width: 1, background: 'var(--text-dim)', opacity: 0.4 }} />
                    <div style={{ flex: 1 }}>
                      {positive && (
                        <div style={{ width: `${ratio * 100}%`, height: '100%', background: 'var(--up)', borderRadius: '0 3px 3px 0' }} />
                      )}
                    </div>
                  </div>
                  <div className="num" style={{ width: 130, fontSize: 12, fontWeight: 600, color: positive ? 'var(--up)' : 'var(--down)', textAlign: 'right' }}>
                    {fmtMoney(r.total_pnl_usdt)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 详细表格 */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              各形态明细 · 点击表头排序
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {([
                      ['pattern', '形态'],
                      ['trades', '交易数'],
                      ['win_rate', '胜率'],
                      ['total_pnl_usdt', '总净收益 USDT'],
                      ['avg_pnl_pct', '平均收益率'],
                      ['profit_factor', '盈亏比'],
                      ['kelly', '凯利仓位'],
                    ] as [SortKey, string][]).map(([k, label]) => (
                      <th key={k} onClick={() => toggleSort(k)} style={{
                        padding: '10px 14px', textAlign: 'left', color: 'var(--text-mute)',
                        fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer',
                        userSelect: 'none',
                      }}>
                        {label} {sortKey === k && (sortDesc ? '↓' : '↑')}
                      </th>
                    ))}
                    <th onClick={() => toggleSort('kelly')} style={{
                      padding: '10px 14px', textAlign: 'left', color: 'var(--text-mute)',
                      fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                    }}>相对仓位（最差=1）</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-mute)', fontWeight: 500, fontSize: 11 }}>方向</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-mute)', fontWeight: 500, fontSize: 11 }}>最大盈/亏 USDT</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(r => (
                    <tr key={r.pattern} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--accent)' }}>{r.pattern}</td>
                      <td className="num" style={{ padding: '10px 14px', color: 'var(--text-mute)' }}>
                        {r.trades} <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>({r.wins}W / {r.losses}L)</span>
                      </td>
                      <td className="num" style={{ padding: '10px 14px', color: r.win_rate >= 0.5 ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
                        {(r.win_rate * 100).toFixed(2)}%
                      </td>
                      <td className="num" style={{ padding: '10px 14px', color: r.total_pnl_usdt >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                        {fmtMoney(r.total_pnl_usdt)}
                      </td>
                      <td className="num" style={{ padding: '10px 14px', color: r.avg_pnl_pct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {fmtPct(r.avg_pnl_pct)}
                      </td>
                      <td className="num" style={{ padding: '10px 14px', color: 'var(--text)' }}>
                        {r.profit_factor === null ? '∞' : r.profit_factor.toFixed(2)}
                      </td>
                      <td className="num" style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ color: r.kelly <= 0 ? 'var(--down)' : 'var(--gold)', fontWeight: 700 }}>
                          {(kellyPos(r.kelly) * 100).toFixed(1)}%
                        </span>
                        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                          （半凯利 {(kellyPos(r.kelly * 0.5) * 100).toFixed(1)}%）
                        </span>
                        {r.kelly <= 0 && (
                          <span style={{ color: 'var(--down)', fontSize: 11 }}>保底</span>
                        )}
                      </td>
                      <td className="num" style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--accent)' }}>
                        ×{(kellyPos(r.kelly) / minKellyPos).toFixed(1)}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 11 }}>
                        {r.long_trades > 0 && (
                          <span style={{ color: 'var(--up)', marginRight: 6 }}>多{r.long_trades}</span>
                        )}
                        {r.short_trades > 0 && (
                          <span style={{ color: 'var(--down)' }}>空{r.short_trades}</span>
                        )}
                      </td>
                      <td className="num" style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-mute)' }}>
                        <span style={{ color: 'var(--up)' }}>+{r.max_win_usdt.toFixed(0)}</span>
                        {' / '}
                        <span style={{ color: 'var(--down)' }}>{r.max_loss_usdt.toFixed(0)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7 }}>
            说明：胜率 = 净损益 USDT &gt; 0 的交易占比；盈亏比 = 盈利总额 / 亏损总额；
            未匹配到 P 编号的信号将按原信号名称分组。
            凯利仓位 f* = p − (1−p)/b，其中 p 为该形态胜率，b = 平均盈利 / 平均亏损（赔率）；
            表示单笔投入占总资金的理论最优比例。全凯利波动较大，实盘通常建议采用半凯利。
            为配合趋势策略不错过任何入场机会，推荐仓位最低按 1% 保底（标"保底"的形态凯利值 ≤ 0，
            即历史上无统计优势，仅为不踏空保留最小仓位）。
            Scale-in 加仓单（P1 信号持仓中触发、仓位为 P1 的一半）统一归入"P1加仓"形态独立归因；
            相对仓位以保底后凯利最小的形态为 1，给出其他形态的建仓倍数。
            样本数过少（&lt;20 笔）的形态结果仅供参考。
          </div>
        </>
      )}
    </div>
  )
}
