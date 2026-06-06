import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: '量化策略编辑器 | BTC Station',
  description: 'Python 策略在线编写，内置 VectorBT 执行引擎，支持 8 种趋势跟踪模板。',
}

export default function StrategyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  )
}
