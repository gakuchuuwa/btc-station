import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: '蒙特卡洛风控 | BTC Station',
  description: '在浏览器中运行蒙特卡洛抽样，探索 BTC 策略收益、回撤与风险的可能分布。',
}

export default function MonteCarloLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  )
}
