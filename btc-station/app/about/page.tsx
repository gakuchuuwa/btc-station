import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '关于 — BTC Station',
  description: 'BTC Station 是一款由独立开发者构建的量化回测与分析工作台，致力于让量化研究平民化。',
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
          BTC Station (quant-lab.org) 是一款由独立开发者构建的量化分析工作台。我们的愿景是“让量化分析平民化”——无需配置复杂的本地环境，任何人都可以随时随地打开网页，在线编写策略、极速回测、寻找最佳参数组合，并进行专业的稳健性评估。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>核心功能</h2>
        <p style={pStyle}>
          我们为研究者提供一条真实、透明、可复查的专业量化研究流水线。通过基于 VectorBT 的云端架构，用户可以在极短时间内完成复杂的参数网格扫描与蒙特卡洛压力测试。我们致力于提供纯粹的技术工具，帮助用户客观评估策略表现，识别常见的“过拟合”陷阱。
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
