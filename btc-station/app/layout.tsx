import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'BTC Station — 专注比特币的量化交易平台',
  description: '专注比特币的量化交易工具。实时行情、K线图表、策略回测、参数优化。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Header />
        <main>
          <div className="wrap">
            {children}
          </div>
        </main>
        <Footer />
      </body>
    </html>
  )
}
