import type { Metadata } from 'next'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: '蒙特卡洛风控 | BTC Station',
  description: '10000次重抽样蒙特卡洛压力测试，评估量化策略的破产概率与真实回撤分布。',
}

export default function MonteCarloLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
    </>
  )
}
