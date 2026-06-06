"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getStrategy } from '@/lib/strategies';
import { StrategyParams } from '@/lib/strategies/types';
import { ensureHistoricalData } from '@/lib/data/history';
import { runBacktest, BacktestConfig, BacktestResult } from '@/lib/backtest/engine';

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const strategy = getStrategy(id);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, message: '' });
  const [strategyParams, setStrategyParams] = useState<StrategyParams>({});
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig>({
    market: 'spot',
    leverage: 1,
    initial_capital: 10000,
    position_sizing: 'all_in',
    position_value: 100,
    fee_pct: 0.1,
    slippage_pct: 0.05
  });
  const [timeframe, setTimeframe] = useState('1d');
  const [lookbackYears, setLookbackYears] = useState(1);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (strategy) {
      const initialParams: StrategyParams = {};
      Object.entries(strategy.paramSchema).forEach(([key, def]) => {
        initialParams[key] = def.default;
      });
      setStrategyParams(initialParams);
    }
  }, [strategy]);

  if (!strategy) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <h1 className="text-2xl font-bold mb-4">策略未找到</h1>
        <button onClick={() => router.push('/strategies')} className="text-[var(--primary)]">返回策略库</button>
      </div>
    );
  }

  const handleParamChange = (key: string, value: any) => {
    setStrategyParams(prev => ({ ...prev, [key]: value }));
  };

  const executeBacktest = async () => {
    try {
      setIsRunning(true);
      setError('');
      setResult(null);
      setProgress({ percent: 0, message: '检查缓存...' });

      // 1. Ensure Data
      const candles = await ensureHistoricalData('spot', timeframe, lookbackYears, setProgress);

      if (candles.length === 0) {
        throw new Error('未拉取到历史数据');
      }

      setProgress({ percent: 100, message: '执行回测引擎...' });
      
      // Delay slightly for UI update
      await new Promise(r => setTimeout(r, 50));

      // 2. Generate Signals
      const signals = strategy.generateSignals(candles, strategyParams);

      // 3. Run Engine
      const btResult = await runBacktest(candles, signals, backtestConfig);
      
      setResult(btResult);
      setProgress({ percent: 100, message: '回测完成' });
    } catch (e: any) {
      console.error(e);
      setError(e.message || '回测发生错误');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl flex flex-col md:flex-row gap-6">
      {/* Left Sidebar: Params */}
      <div className="w-full md:w-80 flex flex-col gap-6">
        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border)]">
          <h1 className="text-xl font-bold text-[var(--text)] mb-2">{strategy.name}</h1>
          <p className="text-[var(--text-mute)] text-sm mb-4">{strategy.description}</p>
          <div className="flex gap-2">
            <span className="text-xs px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text-mute)]">难度 {strategy.difficulty}星</span>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border)]">
          <h3 className="font-bold text-[var(--text)] mb-4 pb-2 border-b border-[var(--border)]">参数设置</h3>
          <div className="flex flex-col gap-4">
            {Object.entries(strategy.paramSchema).map(([key, def]) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-[var(--text)]" title={def.description}>{def.label}</label>
                {def.type === 'select' ? (
                  <select 
                    className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
                    value={strategyParams[key] as string || ''}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                  >
                    {def.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : def.type === 'bool' ? (
                  <input 
                    type="checkbox"
                    checked={!!strategyParams[key]}
                    onChange={(e) => handleParamChange(key, e.target.checked)}
                    className="accent-[var(--primary)] h-4 w-4"
                  />
                ) : (
                  <input 
                    type="number" 
                    step={def.step || 1}
                    min={def.min}
                    max={def.max}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
                    value={strategyParams[key] as number || 0}
                    onChange={(e) => handleParamChange(key, def.type==='int'?parseInt(e.target.value):parseFloat(e.target.value))}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[var(--bg-card)] p-5 rounded-xl border border-[var(--border)]">
          <h3 className="font-bold text-[var(--text)] mb-4 pb-2 border-b border-[var(--border)]">回测设置</h3>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[var(--text)]">时间周期</label>
              <select value={timeframe} onChange={e=>setTimeframe(e.target.value)} className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]">
                <option value="1d">1天 (1d)</option>
                <option value="4h">4小时 (4h)</option>
                <option value="1h">1小时 (1h)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[var(--text)]">回测时长</label>
              <select value={lookbackYears} onChange={e=>setLookbackYears(parseInt(e.target.value))} className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]">
                <option value={1}>近 1 年</option>
                <option value={3}>近 3 年</option>
                <option value={5}>近 5 年</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[var(--text)]">初始资金 (USDT)</label>
              <input type="number" value={backtestConfig.initial_capital} onChange={e=>setBacktestConfig({...backtestConfig, initial_capital: parseInt(e.target.value)})} className="bg-[var(--bg)] border border-[var(--border)] rounded p-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"/>
            </div>
          </div>
          
          <button 
            onClick={executeBacktest}
            disabled={isRunning}
            className="w-full mt-6 bg-[var(--primary)] hover:bg-[#1f8c6a] text-white font-bold py-3 px-4 rounded transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {isRunning ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                {progress.percent}%
              </>
            ) : '运行回测'}
          </button>
          
          <div className="mt-3 text-center text-xs text-[var(--text-mute)]">
            {isRunning && progress.message}
            {error && <span className="text-red-500">{error}</span>}
          </div>
        </div>
      </div>

      {/* Right Main Area: Chart & Results */}
      <div className="flex-1 flex flex-col gap-6">
        <div className="h-[400px] bg-[var(--bg-card)] rounded-xl border border-[var(--border)] flex items-center justify-center">
           {/* Placeholder for Chart */}
           <div className="text-[var(--text-mute)] text-center">
             <div className="text-4xl mb-2">📈</div>
             <p>图表区域 (Lightweight Charts)</p>
             <p className="text-xs opacity-70 mt-1">集成信号 Marker 的图表组件即将接入</p>
           </div>
        </div>

        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 min-h-[300px]">
          {result ? (
            <div>
              <h2 className="text-xl font-bold text-[var(--text)] mb-6">回测结果</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="p-4 bg-[var(--bg)] rounded border border-[var(--border)]">
                  <div className="text-[var(--text-mute)] text-xs mb-1">总收益率</div>
                  <div className={`text-xl font-bold ${result.metrics.total_pnl_pct >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                    {result.metrics.total_pnl_pct > 0 ? '+' : ''}{result.metrics.total_pnl_pct.toFixed(2)}%
                  </div>
                </div>
                <div className="p-4 bg-[var(--bg)] rounded border border-[var(--border)]">
                  <div className="text-[var(--text-mute)] text-xs mb-1">胜率</div>
                  <div className="text-xl font-bold text-[var(--text)]">{result.metrics.win_rate.toFixed(2)}%</div>
                </div>
                <div className="p-4 bg-[var(--bg)] rounded border border-[var(--border)]">
                  <div className="text-[var(--text-mute)] text-xs mb-1">最大回撤</div>
                  <div className="text-xl font-bold text-red-500">{(result.metrics.ftmo_drawdown_pct ?? result.metrics.max_drawdown_pct).toFixed(2)}%</div>
                </div>
                <div className="p-4 bg-[var(--bg)] rounded border border-[var(--border)]">
                  <div className="text-[var(--text-mute)] text-xs mb-1">总交易笔数</div>
                  <div className="text-xl font-bold text-[var(--text)]">{result.metrics.total_trades}</div>
                </div>
              </div>
              
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-[var(--text)]">交易记录 ({result.trades.length})</h3>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[var(--text-mute)] bg-[var(--bg)] uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3 rounded-tl">入场时间</th>
                      <th className="px-4 py-3">方向</th>
                      <th className="px-4 py-3 text-right">入场价</th>
                      <th className="px-4 py-3 text-right">出场价</th>
                      <th className="px-4 py-3 text-right rounded-tr">盈亏 %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(0, 10).map((t, i) => (
                      <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--bg)]">
                        <td className="px-4 py-3 text-[var(--text)]">{new Date(t.entry_time * 1000).toLocaleString()}</td>
                        <td className="px-4 py-3 text-[var(--up)] font-medium">做多</td>
                        <td className="px-4 py-3 text-right text-[var(--text)]">{t.entry_price.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-[var(--text)]">{t.exit_price.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${t.pnl_pct >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                          {t.pnl_pct > 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.trades.length > 10 && (
                  <div className="text-center mt-4 text-[var(--text-mute)] text-xs">
                    仅显示最近 10 笔交易，更多记录请导出 CSV
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-mute)] py-12">
              <div className="text-3xl mb-3">🧪</div>
              <p>调整参数并点击"运行回测"查看结果</p>
              <p className="text-xs mt-2 opacity-60">本策略基于现货数据回测，永续合约精确模拟将在 Pro 版上线</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
