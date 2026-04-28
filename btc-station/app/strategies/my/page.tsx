"use client";

import Link from 'next/link';

export default function MyStrategiesPage() {
  // Placeholder for Supabase integration
  const myStrategies: any[] = [];
  const isLoggedIn = true; // Replace with actual auth check

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-5xl text-center">
        <h1 className="text-3xl font-bold text-[var(--text)] mb-4">请先登录</h1>
        <p className="text-[var(--text-mute)] mb-8">登录后即可保存您的自定义策略配置</p>
        <Link href="/login" className="bg-[var(--primary)] text-white px-6 py-2 rounded font-medium">去登录</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[var(--text)] mb-3">我的策略</h1>
        <p className="text-[var(--text-mute)]">已保存的策略与历史回测记录</p>
      </div>

      {myStrategies.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-center">
          <div className="text-4xl mb-4 opacity-50">📂</div>
          <h2 className="text-xl font-bold text-[var(--text)] mb-2">还没有保存的策略</h2>
          <p className="text-[var(--text-mute)] mb-6">去策略库挑一个开始回测，并保存您的专属参数组合吧</p>
          <Link href="/strategies" className="bg-[var(--primary)] hover:bg-[#1f8c6a] text-white px-6 py-2 rounded font-medium transition-colors">
            浏览策略库
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Render saved strategies here */}
        </div>
      )}
    </div>
  );
}
