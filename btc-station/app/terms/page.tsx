import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '服务条款 — BTC Station',
}

const sectionStyle: React.CSSProperties = { marginBottom: 28 }
const h2Style: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }
const pStyle: React.CSSProperties = { color: 'var(--text-mute)', lineHeight: 1.8, fontSize: 13, marginBottom: 8 }

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 0 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>服务条款</h1>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 32 }}>最后更新：2026 年 4 月</p>

      <div style={sectionStyle}>
        <h2 style={h2Style}>1. 服务描述</h2>
        <p style={pStyle}>
          BTC Station（以下简称"本服务"）是一个专注于比特币的量化交易分析工具，提供实时行情、K 线图表、技术指标、策略回测及参数优化等功能。本服务仅为信息展示和分析工具，不构成任何形式的投资建议或推荐。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>2. 服务对象声明</h2>
        <p style={pStyle}>
          本服务主要面向全球华语加密货币用户提供。<strong style={{ color: 'var(--text)' }}>本服务不主动面向中国大陆居民提供。</strong>中国大陆用户使用本服务应自行遵守当地法律法规，因使用本服务产生的相关风险由用户自行承担。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>3. 用户责任</h2>
        <p style={pStyle}>
          用户在使用本服务时应确保遵守所在司法管辖区的法律法规。用户对其账户的所有活动负责，包括但不限于：妥善保管登录凭据、确保注册信息的准确性、以及在使用本服务进行的所有操作。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>4. 风险提示</h2>
        <p style={pStyle}>
          加密货币交易具有极高风险，可能导致全部本金的损失。历史回测结果不代表未来收益。本服务提供的所有数据、分析和工具仅供参考，用户应基于自身判断做出投资决策。本服务不对任何投资损失承担责任。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>5. 数据来源</h2>
        <p style={pStyle}>
          本服务的行情数据来源于 OKX 交易所公共 API，新闻数据来源于 CoinDesk 等公开渠道。我们尽力确保数据的准确性和及时性，但不对数据的完整性、准确性或实时性做出任何保证。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>6. 知识产权</h2>
        <p style={pStyle}>
          本服务中的所有内容（包括但不限于代码、设计、文字、图标）均受知识产权法律保护。未经授权，用户不得复制、修改、分发或以商业目的使用本服务的任何内容。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>7. 免责声明</h2>
        <p style={pStyle}>
          本服务按"现状"提供，不做任何明示或暗示的保证。在法律允许的最大范围内，本服务的运营者不对因使用或无法使用本服务而产生的任何直接、间接、附带、特殊或后果性损害承担责任。
        </p>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>8. 条款修改</h2>
        <p style={pStyle}>
          我们保留随时修改本服务条款的权利。修改后的条款将在本页面公布，继续使用本服务即表示接受修改后的条款。
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
