import re

file_path = 'btc-station/app/chart/page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add indicatorDropdownOpen and indicatorDropdownRef state
state_injection = """  const [activeStrategy, setActiveStrategy] = useState<string | null>(null)
  const [strategyDropdownOpen, setStrategyDropdownOpen] = useState(false)
  const [indicatorDropdownOpen, setIndicatorDropdownOpen] = useState(false)
  const indicatorDropdownRef = useRef<HTMLDivElement>(null)"""
content = re.sub(r'  const \[activeStrategy, setActiveStrategy\] = useState<string \| null>\(null\)\n  const \[strategyDropdownOpen, setStrategyDropdownOpen\] = useState\(false\)', state_injection, content)

# 2. Add inside handleClick
click_injection = """    function handleClick(e: MouseEvent) {
      if (strategyDropdownRef.current && !strategyDropdownRef.current.contains(e.target as Node)) {
        setStrategyDropdownOpen(false)
      }
      if (indicatorDropdownRef.current && !indicatorDropdownRef.current.contains(e.target as Node)) {
        setIndicatorDropdownOpen(false)
      }
    }"""
content = re.sub(r'    function handleClick\(e: MouseEvent\) \{\n      if \(strategyDropdownRef\.current && !strategyDropdownRef\.current\.contains\(e\.target as Node\)\) \{\n        setStrategyDropdownOpen\(false\)\n      \}\n    \}', click_injection, content)

# 3. Add UI Button
ui_injection = """          {/* ƒx 指标库 下拉 */}
          <div ref={indicatorDropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIndicatorDropdownOpen(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 13px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                border: '1.5px solid rgba(100,181,246,0.7)',
                background: 'rgba(100,181,246,0.1)',
                color: '#64B5F6',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 16px rgba(100,181,246,0.45)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 8px rgba(100,181,246,0.2)'}
            >
              <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1 }}>ƒx</span>
              <span>指标</span>
              <span style={{ fontSize: 9, opacity: 0.7 }}>{indicatorDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {indicatorDropdownOpen && (
              <div style={{
                position: 'absolute', top: '110%', left: 0, zIndex: 60, minWidth: 200,
                background: 'var(--bg-card, #1a2232)', border: '1px solid var(--border)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 12px 4px', fontSize: 10, color: 'var(--text-mute)', fontWeight: 600, letterSpacing: '0.06em' }}>
                  常用技术指标
                </div>
                {[
                  { id: 'ma', label: 'MA 双均线 (20, 50)' },
                  { id: 'ema', label: 'EMA 双均线 (20, 50)' },
                  { id: 'macd', label: 'MACD (12, 26, 9)' },
                  { id: 'rsi', label: 'RSI (14)' },
                  { id: 'bollinger', label: '布林带 (20, 2)' },
                ].map(s => {
                  const isActive = indicatorParams[s.id as keyof IndicatorParams].enabled;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setIndicatorParams(p => ({ ...p, [s.id]: { ...(p as any)[s.id], enabled: !isActive } }))}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', textAlign: 'left', padding: '9px 14px',
                        background: isActive ? 'rgba(100,181,246,0.1)' : 'none',
                        border: 'none', cursor: 'pointer',
                        color: isActive ? '#64B5F6' : 'var(--text)',
                        fontSize: 13,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = isActive ? 'rgba(100,181,246,0.1)' : 'none')}
                    >
                      <span>{s.label}</span>
                      {isActive && <span style={{ fontSize: 10, color: '#64B5F6' }}>● 已开启</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ƒx 策略库 下拉 */}"""

content = re.sub(r'          \{\/\* ƒx 策略库 下拉 \*\/\}', ui_injection, content, count=1)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Successfully added indicator UI.")
