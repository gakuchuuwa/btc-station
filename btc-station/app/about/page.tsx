import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '关于 — BTC Station',
  description: 'BTC Station 是一款比特币行情、图表与本地量化研究工作台。',
}

const sectionStyle: React.CSSProperties = { marginBottom: 28 }
const h2Style: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }
const pStyle: React.CSSProperties = { color: 'var(--text-mute)', lineHeight: 1.8, fontSize: 13, marginBottom: 8 }

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 0 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>关于 BTC Station</h1>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 32 }}>最后更新：2026 年 5 月</p>

      <div style={sectionStyle}>
        <h2 style={h2Style}>项目初衷</h2>
        <p style={pStyle}>
          BTC Station (quant-lab.org) 是一款比特币行情与量化研究工作台，重点提供公开市场数据、多周期 K 线图表、浏览器内示例策略回测、蒙特卡洛模拟，以及基于 CSV 的稳健性分析。核心研究功能在本地运行，不依赖专用 Python 回测服务。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>核心功能</h2>
        <p style={pStyle}>
          行情、K 线和公开衍生品数据来自 OKX，情绪与链上信息来自公开 API。策略信号和回测由浏览器中的 TypeScript 引擎计算；参数邻域与 CSV 报告分析也在本地完成。历史结果依赖所选样本、费用和滑点假设，不保证未来表现。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>独立声明</h2>
        <p style={pStyle}>
          本平台是一个纯粹的技术基础设施。我们保持绝对中立，不提供任何投资建议，不售卖交易信号，也不要求用户连接钱包或转移资金。
        </p>
        <p style={pStyle}>
          注：本站域名为 quant-lab.org，作为独立的技术工具运行，与网络上任何其他同名或类似名称的商业机构、理财专案均无任何关联。
        </p>
      </div>

      <div style={{ marginTop: 32 }}>
        <Link href="/" style={{
          padding: '8px 20px', borderRadius: 4, fontSize: 13, fontWeight: 500,
          border: '1px solid var(--border-hi)', color: 'var(--text)',
        }}>← 返回首页</Link>
      </div>
    </div>
  )
}
