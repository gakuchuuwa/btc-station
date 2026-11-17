import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: '本地策略回测 | BTC Station',
  description: '在浏览器内运行 TypeScript 策略与回测，不依赖付费 Python 后端。',
}

export default function StrategiesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  )
}
