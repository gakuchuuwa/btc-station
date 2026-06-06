import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'BTC Station | 比特币宏观周期与链上数据看板',
  description: '汇聚全球顶尖机构的比特币数据，涵盖周期罗盘、流动性指标、季节性规律与 AI 新闻速递。',
}
import Footer from '@/components/Footer'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>
        <div className="wrap">
          {children}
        </div>
      </main>
      <Footer />
    </>
  )
}
