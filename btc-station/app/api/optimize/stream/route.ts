// SSE 透传代理 — 绕开 Next.js dev rewrite 的缓冲问题
// 直接在 Next.js 服务端用 Node fetch 连 FastAPI,然后用 ReadableStream pipe 给浏览器
// 这条链路 Next.js 不会缓冲,SSE 真正实时

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.text()

  const upstream = await fetch(`${BACKEND_URL}/api/optimize/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    // 关键:Node 18+ fetch 需要 duplex:'half' 才能正确处理流式 body
    // @ts-expect-error - duplex is valid for Node fetch but missing in TS types
    duplex: 'half',
  })

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => '')
    return new Response(txt || 'Upstream error', { status: upstream.status })
  }

  // 直接把后端的 ReadableStream pipe 给浏览器,不做任何缓冲
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
