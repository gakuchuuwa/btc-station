//@version=6
strategy("BTC 简单趋势策略 (EMA交叉)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10, commission_type=strategy.commission.percent, commission_value=0.05)

// =========================================================================
// 1. 定义输入参数 (方便你在图表设置中随时修改)
// =========================================================================
fastLength = input.int(20, title="快速EMA周期", minval=1)
slowLength = input.int(50, title="慢速EMA周期", minval=1)

// =========================================================================
// 2. 计算技术指标
// =========================================================================
fastEMA = ta.ema(close, fastLength)
slowEMA = ta.ema(close, slowLength)

// =========================================================================
// 3. 在图表上绘制均线
// =========================================================================
plot(fastEMA, color=color.new(color.green, 0), title="快速 EMA", linewidth=2)
plot(slowEMA, color=color.new(color.red, 0), title="慢速 EMA", linewidth=2)

// =========================================================================
// 4. 定义交易信号条件
// =========================================================================
// 金叉：快速均线上穿慢速均线
longCondition = ta.crossover(fastEMA, slowEMA)
// 死叉：快速均线下穿慢速均线
shortCondition = ta.crossunder(fastEMA, slowEMA)

// =========================================================================
// 5. 执行交易指令
// =========================================================================
if (longCondition)
    strategy.entry("做多", strategy.long)

if (shortCondition)
    strategy.entry("做空", strategy.short)

// =========================================================================
// 6. 可选：高亮背景以区分当前持仓状态
// =========================================================================
bgcolor(strategy.position_size > 0 ? color.new(color.green, 90) : strategy.position_size < 0 ? color.new(color.red, 90) : na, title="持仓背景")