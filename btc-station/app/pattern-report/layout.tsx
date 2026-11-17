import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: '形态归因报告 | BTC Station',
  description: '自动按形态分类解析 TradingView 交易清单，进行多维度利润分解。',
}

export default function PatternReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  )
}
