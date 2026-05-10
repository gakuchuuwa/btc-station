export function PageLoader({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="page-loader">
      <div className="page-loader-inner">
        <span className="dot-live" style={{ width: 8, height: 8 }} />
        <span style={{ fontSize: 13, color: 'var(--text-mute)' }}>{text}</span>
      </div>
    </div>
  )
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="page-loader">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--down)', marginBottom: 12 }}>{message}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{ padding: '7px 18px', borderRadius: 4, border: '1px solid var(--border-hi)', fontSize: 13, cursor: 'pointer', color: 'var(--text)', background: 'transparent' }}
          >
            重试
          </button>
        )}
      </div>
    </div>
  )
}
