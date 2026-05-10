import Link from 'next/link'

export default function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
              <div className="brand-icon">₿</div>
              <span className="brand-name" style={{fontSize:14}}>BTC Station</span>
            </div>
            <p>专注比特币的量化交易工具。实时行情、K线图表。</p>
            <div className="foot-status">
              <span style={{display:'flex',alignItems:'center',gap:6}}><span className="dot-live"></span>系统运行正常</span>
              <span className="text-dim">·</span>
              <span>数据源：OKX</span>
            </div>
          </div>
          <div className="foot-col">
            <div className="section-label">产品</div>
            <ul>
              <li><Link href="/">行情</Link></li>
              <li><Link href="/chart">图表</Link></li>
              <li><Link href="/strategies">策略</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <div className="section-label">数据源</div>
            <ul><li>OKX 公共 API</li><li>CoinGecko</li><li>CoinDesk RSS</li></ul>
          </div>
          <div className="foot-col">
            <div className="section-label">法律</div>
            <ul>
              <li><Link href="/terms">服务条款</Link></li>
              <li><Link href="/privacy">隐私政策</Link></li>
            </ul>
          </div>
        </div>
        <div className="foot-bottom">
          <p><strong>免责声明 · </strong>本服务仅为交易分析工具，不构成投资建议。加密货币交易具有极高风险，所有交易盈亏由用户自行承担。本服务不主动面向中国大陆居民提供，大陆用户使用本服务应自行遵守当地法律法规。</p>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span>© 2026 BTC Station</span>
            <span className="text-dim">·</span>
            <span>v0.2.1</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
