import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: '参数优化与稳健性 | BTC Station',
  description: '多维参数网格搜索，帕累托前沿分析与参数邻域稳健性得分。',
}

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  )
}
