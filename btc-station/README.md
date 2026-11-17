# BTC Station

专注比特币的本地优先行情、图表与量化研究工作台。核心行情和回测功能不依赖已停用的 Python 服务，也不需要登录。

## 可用功能

| 路由 | 功能 |
|---|---|
| `/` | BTC 行情、市场情绪、链上与周期指标 |
| `/chart` | OKX 现货/永续 K 线、多周期图表、指标与画线 |
| `/strategies` | 浏览器内运行的 TypeScript 示例策略与回测 |
| `/hyperopt` | 使用 Web Worker 本地搜索内置策略参数并导出 CSV |
| `/analysis` | 基于公开 BTC 日线数据的统计分析 |
| `/monte-carlo` | 本地蒙特卡洛模拟 |
| `/report` | 导入 CSV 后在本地进行筛选与稳健性分析 |

## 本地启动

```bash
npm ci
npm run dev
```

生产构建与启动：

```bash
npm run build
npm start
```

## 数据来源

- **行情 / K 线 / 永续公开指标**：OKX 公共 API
- **恐惧与贪婪指数**：Alternative.me
- **比特币链上 / 内存池信息**：mempool.space
- **新闻**：Google News RSS
- **市值**：CoinGecko

Next.js API 路由负责请求公共数据并做短期缓存；上游暂时不可用时，界面保留图表功能并以空值显示缺失指标，不会转发到已关闭的 Python 后端。

## 可选 Supabase 登录

若需账户功能，可复制 `.env.local.example` 为 `.env.local` 并填写 Supabase URL 与 anon key。行情、图表和本地策略回测不依赖 Supabase。
