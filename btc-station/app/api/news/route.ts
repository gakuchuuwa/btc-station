import { NextResponse } from 'next/server'
import { fetchNews } from '@/lib/news'

export const revalidate = 300 // Route Segment Config: 强制 5 分钟缓存

export async function GET() {
  try {
    const data = await fetchNews(30)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/news]', err)
    return NextResponse.json([], { status: 503 })
  }
}
