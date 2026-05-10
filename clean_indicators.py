import re

file_path = 'btc-station/app/chart/page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove calculation functions
calc_pattern = r'// ============================\n// 指标计算（客户端 JS）\n// ============================\n.*?// ============================\n// 类型定义\n// ============================'
content = re.sub(calc_pattern, '// ============================\n// 类型定义\n// ============================', content, flags=re.DOTALL)

# 2. Remove IndicatorParams type and DEFAULT
ind_param_pattern = r'interface IndicatorParams \{.*?\n\}\n\nconst DEFAULT_INDICATOR_PARAMS: IndicatorParams = \{.*?\n\}\n\n'
content = re.sub(ind_param_pattern, '', content, flags=re.DOTALL)

# 3. Simplify ChartPanelProps
content = content.replace('  indicatorParams: IndicatorParams\n', '')

# 4. Simplify ChartPanel arguments
content = content.replace('  candles, tf, market, indicatorParams, drawings, activeTool,', '  candles, tf, market, drawings, activeTool,')

# 5. Remove indicatorDropdown state & click logic
drop_state = r'  const \[indicatorDropdownOpen, setIndicatorDropdownOpen\] = useState\(false\)\n  const indicatorDropdownRef = useRef<HTMLDivElement>\(null\)'
content = re.sub(drop_state, '', content)

click_logic = r'      if \(indicatorDropdownRef\.current && !indicatorDropdownRef\.current\.contains\(e\.target as Node\)\) \{\n        setIndicatorDropdownOpen\(false\)\n      \}\n'
content = re.sub(click_logic, '', content)

# 6. Remove the fx Indicator UI
fx_ui = r'          \{\/\* ƒx 指标库 下拉 \*\/\}[\s\S]*?\{\/\* ƒx 策略库 下拉 \*\/\}'
content = re.sub(fx_ui, '{/* ƒx 策略库 下拉 */}', content)

# 7. ChartPanel internal cleanup: refs
refs_to_remove = [
    r'  const rsiContainerRef = useRef<HTMLDivElement>\(null\)\n',
    r'  const macdContainerRef = useRef<HTMLDivElement>\(null\)\n',
    r'  const stochContainerRef = useRef<HTMLDivElement>\(null\)\n',
    r'  const atrContainerRef = useRef<HTMLDivElement>\(null\)\n',
    r'  const obvContainerRef = useRef<HTMLDivElement>\(null\)\n',
]
for ref in refs_to_remove:
    content = re.sub(ref, '', content)

charts_ref = r'  const chartsRef = useRef<\{.*?\}>\(.*?\)'
simplified_charts_ref = """  const chartsRef = useRef<{
    main: IChartApi | null;
    vol: IChartApi | null;
  }>({ main: null, vol: null })"""
content = re.sub(charts_ref, simplified_charts_ref, content, flags=re.DOTALL)

series_ref = r'  const seriesRefs = useRef<\{.*?\}>\(.*?\)'
simplified_series_ref = """  const seriesRefs = useRef<{
    candle: ISeriesApi<'Candlestick'> | null;
    vol: ISeriesApi<'Histogram'> | null;
  }>({ candle: null, vol: null })"""
content = re.sub(series_ref, simplified_series_ref, content, flags=re.DOTALL)

# 8. ChartPanel initialize effect cleanup
init_effect_rm = r'    if \(rsiContainerRef\.current\) \{.*?if \(obvContainerRef\.current\) \{.*?\n      seriesRefs\.current\.obvMa = c\.addSeries\(LineSeries, \{ color: \'#FF9800\', lineWidth: 1, priceLineVisible: false, lastValueVisible: false \}\)\n    \}'
content = re.sub(init_effect_rm, '', content, flags=re.DOTALL)

resize_rm = r'      if \(rsiContainerRef\.current && chartsRef\.current\.rsi\) chartsRef\.current\.rsi\.applyOptions\(\{ width: rsiContainerRef\.current\.clientWidth \}\)\n      if \(macdContainerRef\.current && chartsRef\.current\.macd\) chartsRef\.current\.macd\.applyOptions\(\{ width: macdContainerRef\.current\.clientWidth \}\)\n      if \(stochContainerRef\.current && chartsRef\.current\.stoch\) chartsRef\.current\.stoch\.applyOptions\(\{ width: stochContainerRef\.current\.clientWidth \}\)\n      if \(atrContainerRef\.current && chartsRef\.current\.atr\) chartsRef\.current\.atr\.applyOptions\(\{ width: atrContainerRef\.current\.clientWidth \}\)\n      if \(obvContainerRef\.current && chartsRef\.current\.obv\) chartsRef\.current\.obv\.applyOptions\(\{ width: obvContainerRef\.current\.clientWidth \}\)\n'
content = re.sub(resize_rm, '', content)

unmount_rm = r'      chartsRef\.current = \{ main: null, vol: null, rsi: null, macd: null, stoch: null, atr: null, obv: null \}'
content = re.sub(unmount_rm, '      chartsRef.current = { main: null, vol: null }', content)

# 9. ChartPanel update effect cleanup
update_effect_dep = r'\}, \[candles, indicatorParams, rangePreset, tf\]\)'
content = re.sub(update_effect_dep, '}, [candles, rangePreset, tf])', content)

custom_series_rm = r'    // Update Custom Main Series \(MA, EMA, BB\)[\s\S]*?// Update Sub Charts'
content = re.sub(custom_series_rm, '// Update Sub Charts', content)

vol_ma_rm = r'      if \(indicatorParams\.volume_ma\.enabled && seriesRefs\.current\.volMa\) \{[\s\S]*?\} else if \(seriesRefs\.current\.volMa\) \{\n        seriesRefs\.current\.volMa\.setData\(\[\]\)\n      \}'
content = re.sub(vol_ma_rm, '', content)
content = re.sub(r'if \(indicatorParams\.volume_ma\.enabled \|\| true\) \{ // Vol is always visible', 'if (true) {', content)

sub_charts_rm = r'    if \(indicatorParams\.rsi\.enabled && seriesRefs\.current\.rsi\) \{[\s\S]*?\} else if \(seriesRefs\.current\.obvMa\) \{\n        seriesRefs\.current\.obvMa\.setData\(\[\]\)\n      \}\n    \}'
content = re.sub(sub_charts_rm, '', content)

# 10. JSX cleanup
jsx_vol_ma = r'成交量\{indicatorParams\.volume_ma\.enabled \? ` · MA\(\{indicatorParams\.volume_ma\.period\}\)` : \'\'\}'
content = re.sub(jsx_vol_ma, '成交量', content)
content = re.sub(r'display: indicatorParams\.volume_ma\.enabled \|\| true \? \'block\' : \'none\'', "display: 'block'", content)

jsx_sub_rm = r'      <div style=\{\{ borderTop: \'1px solid var\(--border\)\', display: indicatorParams\.rsi\.enabled \? \'block\' : \'none\' \}\}>[\s\S]*?<div ref=\{obvContainerRef\} style=\{\{ height: 100, width: \'100%\' \}\} />\n      </div>'
content = re.sub(jsx_sub_rm, '', content)

# 11. ChartPanel calls cleanup in page.tsx
calls_rm1 = r'                    indicatorParams=\{indicatorParams\}\n'
content = re.sub(calls_rm1, '', content)

calls_rm2 = r'                    indicatorParams=\{\{ \.\.\.indicatorParams, rsi: \{ \.\.\.indicatorParams\.rsi, enabled: false \}, macd: \{ \.\.\.indicatorParams\.macd, enabled: false \}, stochastic: \{ \.\.\.indicatorParams\.stochastic, enabled: false \}, atr: \{ \.\.\.indicatorParams\.atr, enabled: false \}, obv: \{ \.\.\.indicatorParams\.obv, enabled: false \} \}\}\n'
content = re.sub(calls_rm2, '', content)

# 12. Remove `const [indicatorParams, setIndicatorParams] = useState<IndicatorParams>(DEFAULT_INDICATOR_PARAMS)` from default export
state_rm = r'  const \[indicatorParams, setIndicatorParams\] = useState<IndicatorParams>\(DEFAULT_INDICATOR_PARAMS\)\n'
content = re.sub(state_rm, '', content)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Cleanup script executed.")
