'use client'

import { useEffect, useRef } from 'react'
import type { KlineBar } from '@/types/btc'

interface Props {
  data: KlineBar[]
  isUp: boolean
}

export default function MiniChart({ data, isUp }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const closes = data.map(d => d.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const range = max - min || 1

    const px = (i: number) => (i / (closes.length - 1)) * w
    const py = (v: number) => h - ((v - min) / range) * (h * 0.85)

    const color = isUp ? '#26A17B' : '#E84C3D'
    const fillColor = isUp ? 'rgba(38, 161, 123, 0.12)' : 'rgba(232, 76, 61, 0.12)'

    // Area fill
    ctx.beginPath()
    ctx.moveTo(px(0), h)
    ctx.lineTo(px(0), py(closes[0]))
    closes.forEach((v, i) => ctx.lineTo(px(i), py(v)))
    ctx.lineTo(px(closes.length - 1), h)
    ctx.closePath()
    ctx.fillStyle = fillColor
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.moveTo(px(0), py(closes[0]))
    closes.forEach((v, i) => ctx.lineTo(px(i), py(v)))
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [data, isUp])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
