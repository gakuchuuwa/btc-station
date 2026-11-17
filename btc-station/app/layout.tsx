import type { Metadata } from 'next'
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'BTC Station — 比特币行情与本地量化研究',
  description: '免费的 BTC 行情、K 线图表、技术分析、本地 TypeScript 策略回测与 CSV 稳健性分析工具。仅供研究，不构成投资建议。',
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
