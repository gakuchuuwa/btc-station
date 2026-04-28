export default function Sidebar() {
  return (
    <aside className="aside">
      {/* Quick start CTA */}
      <div className="card card-body cta-card">
        <div className="section-label">快速开始</div>
        <h3>从图表到策略<br/>一站式 BTC 量化工作台</h3>
        <p>多周期 K 线、常用技术指标、参数回测——全部只针对 BTC。</p>
        <div className="cta-btns">
          <a href="/chart" className="btn-row prim">
            <span className="l"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 6-6"/></svg>打开完整图表</span>
            <span>→</span>
          </a>
          <a href="/strategies" className="btn-row ghost">
            <span className="l"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15 9 22 9 16.5 13.5 18 21 12 17 6 21 7.5 13.5 2 9 9 9"/></svg>测试一个策略</span>
            <span className="arr">→</span>
          </a>
        </div>
      </div>

      {/* Sentiment gauge */}
      <div className="card card-body">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div className="section-label">市场情绪</div>
          <span style={{fontSize:10,color:'var(--text-dim)'}}>Alternative.me</span>
        </div>
        <div className="gauge-row">
          <div className="gauge">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6"/>
              <circle cx="50" cy="50" r="42" fill="none" stroke="url(#gG)" strokeWidth="6" strokeDasharray="190 264" strokeLinecap="round"/>
              <defs><linearGradient id="gG" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#EF5350"/><stop offset="50%" stopColor="#E5A74A"/><stop offset="100%" stopColor="#26A69A"/>
              </linearGradient></defs>
            </svg>
            <div className="gauge-num"><span className="n num">72</span><span className="d">/100</span></div>
          </div>
          <div style={{flex:1}}>
            <div className="sent-label">Greed · 贪婪</div>
            <div style={{fontSize:11,color:'var(--text-mute)',marginTop:4}}>较昨日 <span className="up num">+6</span></div>
            <div className="sent-bars">
              <span style={{background:'rgba(239,83,80,0.4)'}}></span>
              <span style={{background:'rgba(239,83,80,0.25)'}}></span>
              <span style={{background:'rgba(229,167,74,0.35)'}}></span>
              <span style={{background:'var(--up)'}}></span>
              <span style={{background:'rgba(38,166,154,0.3)'}}></span>
            </div>
            <div className="sent-scale"><span>极度恐惧</span><span>极度贪婪</span></div>
          </div>
        </div>
      </div>

      {/* Roadmap */}
      <div className="card">
        <div className="roadmap-head">
          <div className="section-label">产品路线图</div>
          <span style={{fontSize:10,color:'var(--text-dim)'}}>当前 · Phase 1</span>
        </div>
        <ul className="roadmap">
          <li className="road-item">
            <span className="road-dot done"><svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#26A69A" strokeWidth="2"><polyline points="1 5 4 8 9 2"/></svg></span>
            <div>
              <div className="road-title">行情 · 资讯 · 迷你图表</div>
              <div className="road-sub"><span>Phase 1</span><span className="text-dim">·</span><span className="up">当前版本</span></div>
            </div>
          </li>
          <li className="road-item">
            <span className="road-dot next"></span>
            <div>
              <div className="road-title">完整 TradingView 图表</div>
              <div className="road-sub">Phase 2 · 免费 · 登录后保存</div>
            </div>
          </li>
          <li className="road-item">
            <span className="road-dot future"></span>
            <div>
              <div className="road-title">策略回测 <span className="chip chip-pro">Pro</span></div>
              <div className="road-sub">Phase 3 · 免费限次 + Pro 无限</div>
            </div>
          </li>
          <li className="road-item">
            <span className="road-dot future"></span>
            <div>
              <div className="road-title">AI 策略分析</div>
              <div className="road-sub">Phase 5 · 自带 Claude / OpenAI Key</div>
            </div>
          </li>
        </ul>
      </div>

      {/* Legal */}
      <div className="legal">
        <strong>重要提示 · </strong>
        本平台仅为交易分析工具，不构成投资建议。所有策略由用户自行编写与选择，盈亏自负。平台不推送信号、不代客理财、不托管资金。
      </div>
    </aside>
  )
}
