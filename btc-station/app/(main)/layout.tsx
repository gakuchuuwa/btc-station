import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'BTC Station | 比特币行情与周期看板',
  description: '基于 OKX、Alternative.me 与 mempool.space 公共数据展示 BTC 行情、周期指标、市场情绪及链上信息。',
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
