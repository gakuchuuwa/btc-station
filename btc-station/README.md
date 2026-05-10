# BTC Station

专注比特币的量化交易工作台。

## 页面结构

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | 首页 | 实时价格、7日迷你图、新闻资讯 |
| `/analysis` | 分析页 | 技术指标分析 |
| `/chart` | 图表页 | 多周期K线、技术指标、策略回测 |
| `/strategies` | 策略页 | 策略列表与管理 |
| `/report` | 报告页 | 稳健性分析报告 |

## 快速启动

```bash
# 前端
cd btc-station
npm install
npm run dev
# 浏览器访问 http://localhost:3000

# 后端
cd backend
.\venv\Scripts\python.exe main.py
# API 服务 http://localhost:8000
```

## 数据源

- **实时价格 / K 线**：OKX 公共 API（无需 Key）
- **市值**：CoinGecko 免费 API（无需 Key）
- **新闻**：CoinDesk RSS（无需 Key）

## 可选配置

创建 `btc-station/.env.local`：

```
CRYPTOPANIC_TOKEN=your_token_here
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```
