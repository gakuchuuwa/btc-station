"use client";

/**
 * HyperoptChart — WebGL scatter plot for Freqtrade hyperopt epoch results.
 * Uses Plotly scattergl (WebGL) instead of SVG scatter so 1000+ epochs
 * render without browser jank.
 */

import dynamic from "next/dynamic";
import type { EpochRecord } from "@/lib/freqtrade-api";

// Plotly is a large bundle — load client-side only, no SSR
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false, loading: () => (
  <div style={{ height: 420, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mute)", fontSize: 13 }}>
    图表加载中…
  </div>
) });

interface Props {
  epochs: EpochRecord[];
  bestEpoch?: EpochRecord | null;
}

export default function HyperoptChart({ epochs, bestEpoch }: Props) {
  if (epochs.length === 0) {
    return (
      <div style={{ height: 420, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mute)", fontSize: 13 }}>
        暂无 Epoch 数据
      </div>
    );
  }

  const xs   = epochs.map(e => e.epoch);
  const ys   = epochs.map(e => e.profit_pct);
  const dds  = epochs.map(e => e.drawdown_pct);
  const trs  = epochs.map(e => e.trades);
  const texts = epochs.map(e => {
    const paramStr = e.params
      ? Object.entries(e.params).map(([k, v]) => `${k}: ${v}`).join("<br>")
      : "";
    return `Epoch ${e.epoch}<br>收益: ${e.profit_pct >= 0 ? "+" : ""}${e.profit_pct.toFixed(2)}%<br>回撤: ${e.drawdown_pct.toFixed(2)}%<br>交易数: ${e.trades}${paramStr ? "<br>" + paramStr : ""}`;
  });

  // Main scatter trace — scattergl uses WebGL, handles thousands of points
  const mainTrace: Plotly.Data = {
    type: "scattergl" as const,
    mode: "markers",
    x: xs,
    y: ys,
    text: texts,
    hoverinfo: "text",
    marker: {
      size: epochs.map(e => Math.max(5, Math.min(14, e.trades / 8))), // size by trade count
      color: dds,
      colorscale: [
        [0,    "#00c864"],   // low drawdown → green
        [0.5,  "#ffd93d"],   // mid → yellow
        [1,    "#ff4d4f"],   // high drawdown → red
      ],
      colorbar: {
        title: { text: "回撤 %", font: { color: "#888", size: 11 } },
        tickfont: { color: "#888", size: 10 },
        len: 0.7,
        thickness: 12,
      },
      showscale: true,
      reversescale: false,
      opacity: 0.85,
      line: { width: 0 },
    },
    name: "Epochs",
  } as Plotly.Data;

  // Best epoch highlight
  const bestTraces: Plotly.Data[] = bestEpoch ? [{
    type: "scattergl" as const,
    mode: "text+markers",
    x: [bestEpoch.epoch],
    y: [bestEpoch.profit_pct],
    text: ["BEST"],
    textposition: "top center",
    textfont: { color: "#fff", size: 11, family: "monospace" },
    hoverinfo: "text" as const,
    hovertext: [`BEST — Epoch ${bestEpoch.epoch}<br>收益: ${bestEpoch.profit_pct >= 0 ? "+" : ""}${bestEpoch.profit_pct.toFixed(2)}%<br>回撤: ${bestEpoch.drawdown_pct.toFixed(2)}%`],
    marker: {
      size: 16,
      color: "#fff",
      symbol: "star",
      line: { color: "#ffd93d", width: 2 },
    },
    name: "最优",
  } as Plotly.Data] : [];

  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "#0d0d0d",
    font: { color: "#ccc", size: 11, family: "system-ui, sans-serif" },
    margin: { t: 16, r: 20, b: 48, l: 54 },
    xaxis: {
      title: { text: "Epoch", font: { size: 11 } },
      gridcolor: "#1e1e1e",
      zerolinecolor: "#333",
      tickfont: { color: "#888" },
    },
    yaxis: {
      title: { text: "收益率 %", font: { size: 11 } },
      gridcolor: "#1e1e1e",
      zerolinecolor: "#444",
      tickfont: { color: "#888" },
      ticksuffix: "%",
    },
    hovermode: "closest",
    showlegend: false,
    // Zero-profit reference line
    shapes: [{
      type: "line",
      x0: 0, x1: 1, xref: "paper",
      y0: 0, y1: 0, yref: "y",
      line: { color: "#444", width: 1, dash: "dot" },
    }],
  } as Partial<Plotly.Layout>;

  const config: Partial<Plotly.Config> = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["toImage", "sendDataToCloud"] as Plotly.ModeBarDefaultButtons[],
    toImageButtonOptions: { format: "png", filename: "hyperopt_scatter" },
  };

  return (
    <Plot
      data={[mainTrace, ...bestTraces]}
      layout={layout}
      config={config}
      style={{ width: "100%", height: 420 }}
      useResizeHandler
    />
  );
}
