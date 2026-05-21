import type { Metadata } from 'next'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'BTC Station — 开源比特币量化回测工具',
  description: '免费的比特币量化回测与策略分析开发者工具。基于 VectorBT 的云端策略回测、参数网格优化、蒙特卡洛压力测试。由独立开发者构建，不提供投资建议。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="google-site-verification" content="7VNb-yIXvf8AtJpt_oaVVocyxd_fusq61tSzuNzT2cw" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
