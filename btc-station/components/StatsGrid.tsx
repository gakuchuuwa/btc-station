import { ArrowUp, ArrowDown, BarChart2, Globe } from 'lucide-react'
import { formatUsd, formatVolume, formatMarketCap } from '@/lib/format'
import type { BtcSummary } from '@/types/btc'

interface Props {
  summary: BtcSummary
}

export default function StatsGrid({ summary }: Props) {
  const stats = [
    {
      label: '24h High',
      value: formatUsd(summary.high24h),
      icon: <ArrowUp size={16} className="text-[#26A17B]" />,
    },
    {
      label: '24h Low',
      value: formatUsd(summary.low24h),
      icon: <ArrowDown size={16} className="text-[#E84C3D]" />,
    },
    {
      label: '24h Volume',
      value: formatVolume(summary.volume24h),
      icon: <BarChart2 size={16} className="text-[#848E9C]" />,
    },
    {
      label: 'Market Cap',
      value: summary.marketCap > 0 ? formatMarketCap(summary.marketCap) : '—',
      icon: <Globe size={16} className="text-[#848E9C]" />,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map(({ label, value, icon }) => (
        <div
          key={label}
          className="rounded-[12px] p-4"
          style={{ background: '#161A1E', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            {icon}
            <span className="text-xs text-[#848E9C] font-medium">{label}</span>
          </div>
          <p className="tabular-nums font-semibold text-[#EAECEF] text-sm md:text-base">
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}
