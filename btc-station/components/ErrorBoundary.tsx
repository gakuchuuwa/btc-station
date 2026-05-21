'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
  // 当 fallback 是函数时，可以拿到错误对象；否则直接渲染 ReactNode
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode)
  // 子树标识，便于在日志里区分多个 ErrorBoundary
  name?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 留下日志方便 F12 排错（生产环境不会在 React 之外冒泡）
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.name ? ':' + this.props.name : ''}]`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const fb = this.props.fallback
    if (typeof fb === 'function') return fb(error)
    if (fb !== undefined) return fb

    return (
      <div style={{
        padding: 20,
        margin: 10,
        borderRadius: 6,
        background: 'rgba(239,83,80,0.08)',
        border: '1px solid rgba(239,83,80,0.3)',
        color: '#ef5350',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠ 此模块渲染出错</div>
        <div style={{ color: '#d1d4dc' }}>{error.message || String(error)}</div>
        <div style={{ marginTop: 8, fontSize: 10, color: '#787b86' }}>
          其他模块不受影响，可继续使用。详细堆栈见浏览器控制台（F12）。
        </div>
      </div>
    )
  }
}
