# BTC Station — Phase 1

专注比特币的量化交易工作台。

## 快速启动

```bash
# 进入项目目录
cd btc-station

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)

## 数据源

- **实时价格 / K 线**：OKX 公共 API（无需 Key）
- **市值**：CoinGecko 免费 API（无需 Key）
- **新闻**：CoinDesk RSS（无需 Key）

## 可选配置

如需使用 CryptoPanic 新闻备用源，创建 `.env.local`：

```
CRYPTOPANIC_TOKEN=your_token_here
```

## Phase 路线图

| Phase | 内容 | 状态 |
|---|---|---|
| 1 | 主页：实时价格 + 7日图 + 新闻 | ✅ 当前 |
| 1.5 | 用户登录注册（NextAuth.js + PostgreSQL）| 规划中 |
| 2 | 完整图表页（多周期 K 线 + 技术指标）| 规划中 |
| 3 | 策略系统 + 回测引擎（Python FastAPI）| 规划中 |
| 4 | AI 分析（Claude/GPT 接入）| 规划中 |
| 5 | OKX 交易所对接（模拟盘 → 实盘）| 规划中 |
