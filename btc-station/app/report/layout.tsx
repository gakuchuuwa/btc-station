import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: '稳健性分析 | BTC Station',
  description: '导入 CSV 后在本地进行参数筛选、帕累托前沿与邻域稳健性分析。',
}

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  )
}
