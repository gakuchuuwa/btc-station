import type { Metadata } from 'next'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'BTC Station — 开源比特币量化回测工具',
  description: '免费的比特币量化回测与策略分析开发者工具。基于 VectorBT 的云端策略回测、参数网格优化、蒙特卡洛压力测试。由独立开发者构建，不提供投资建议。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta name="google-site-verification" content="7VNb-yIXvf8AtJpt_oaVVocyxd_fusq61tSzuNzT2cw" />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
