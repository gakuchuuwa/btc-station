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
              <li><Link href="/strategy">策略</Link></li>
              <li><Link href="/report">报告</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <div className="section-label">数据源</div>
            <ul><li>OKX 公共 API</li><li>CoinGecko</li><li>CoinDesk RSS</li></ul>
          </div>
          <div className="foot-col">
            <div className="section-label">法律</div>
            <ul>
              <li><Link href="/about">关于</Link></li>
              <li><Link href="/terms">服务条款</Link></li>
              <li><Link href="/privacy">隐私政策</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <div className="section-label" style={{ color: 'var(--accent)' }}>专属福利</div>
            <ul>
              <li>
                <a href="https://www.okx.com/join/1887308" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--up)', fontWeight: 600 }}>
                  OKX 减免 20% 手续费
                </a>
              </li>
              <li>
                <a href="https://www.binance.com/en/join?ref=YOUR_BINANCE_CODE_HERE" target="_blank" rel="noopener noreferrer">
                  Binance 专属通道
                </a>
              </li>
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
