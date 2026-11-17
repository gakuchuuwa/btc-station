import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: '本地参数搜索 | BTC Station',
  description: '使用浏览器 Web Worker 对内置 BTC 策略做本地参数搜索，并导出结果 CSV。',
}

export default function HyperoptLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  )
}
