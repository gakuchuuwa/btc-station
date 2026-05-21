'use client'

import React, { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#787b86', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
      Loading 3D Engine...
    </div>
  )
})

export type SurfacePoint = {
  x: number
  y: number
  z: number
  text?: string
}

export default function Surface3DPlot({ 
  data, 
  labels 
}: { 
  data: SurfacePoint[]
  labels: { x: string; y: string; z: string }
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const xData = data.map(d => d.x)
  const yData = data.map(d => d.y)
  const zData = data.map(d => d.z)
  const hoverText = data.map(d => d.text || `X: ${d.x}<br>Y: ${d.y}<br>Z: ${d.z}`)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* @ts-expect-error react-plotly.js 的 TS 类型滞后于 Plotly 库实际支持的属性（mesh3d.intensity / axis.title 字符串等） */}
      <Plot
        data={[
          {
            type: 'mesh3d',
            x: xData,
            y: yData,
            z: zData,
            text: hoverText,
            hoverinfo: 'text',
            intensity: zData, // Color mapping based on Z value
            colorscale: [
              [0, '#ef5350'],       // Low: Red
              [0.3, '#1e222d'],     // Mid-low: Dark background color
              [0.6, '#26a69a'],     // Mid-high: Teal
              [1, '#FFD700']        // High: Gold
            ],
            // Use delaunayaxis to project points to 2D for triangulation (creates a terrain)
            delaunayaxis: 'z',
            opacity: 0.9,
            flatshading: true,
            contour: {
              show: true,
              color: 'rgba(255,255,255,0.1)',
              width: 1
            }
          },
          // Overlay scatter points to show the exact parameter combinations evaluated
          {
            type: 'scatter3d',
            mode: 'markers',
            x: xData,
            y: yData,
            z: zData,
            text: hoverText,
            hoverinfo: 'none',
            marker: {
              size: 3,
              color: '#ffffff',
              opacity: 0.5
            }
          }
        ]}
        layout={{
          autosize: true,
          margin: { l: 0, r: 0, t: 30, b: 0 },
          paper_bgcolor: 'transparent',
          scene: {
            aspectmode: 'auto',
            xaxis: {
              title: labels.x,
              backgroundcolor: 'rgba(30,34,45,0.5)',
              gridcolor: 'rgba(255,255,255,0.1)',
              showbackground: true,
              zerolinecolor: 'rgba(255,255,255,0.2)',
              tickfont: { color: '#787b86' },
              titlefont: { color: '#d1d4dc' }
            },
            yaxis: {
              title: labels.y,
              backgroundcolor: 'rgba(30,34,45,0.5)',
              gridcolor: 'rgba(255,255,255,0.1)',
              showbackground: true,
              zerolinecolor: 'rgba(255,255,255,0.2)',
              tickfont: { color: '#787b86' },
              titlefont: { color: '#d1d4dc' }
            },
            zaxis: {
              title: labels.z,
              backgroundcolor: 'rgba(30,34,45,0.5)',
              gridcolor: 'rgba(255,255,255,0.1)',
              showbackground: true,
              zerolinecolor: 'rgba(255,255,255,0.2)',
              tickfont: { color: '#787b86' },
              titlefont: { color: '#d1d4dc' }
            },
            camera: {
              eye: { x: 1.25, y: -1.25, z: 1.0 } // Zoomed in slightly to fill more space
            }
          }
        }}
        useResizeHandler={true}
        style={{ width: '100%', height: '100%' }}
        config={{ displayModeBar: false }}
      />
    </div>
  )
}
