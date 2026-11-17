"""
X 宣传机器人：每运行一次发一篇英文帖子 = Grok 结合当周 BTC 新闻与走势写的文字 + 程序画的回测图表。
由 Windows 计划任务定时调用。

  试跑（只生成图片和文字到 promo_out/，不发帖）:  venv\\Scripts\\python.exe x_promo_bot.py --dry-run
  正式发帖:                                         venv\\Scripts\\python.exe x_promo_bot.py
  指定图表类型:                                     --chart equity|price|stats

需要的环境变量（backend/.env）：XAI_API_KEY、X_API_KEY、X_API_SECRET、X_ACCESS_TOKEN、X_ACCESS_TOKEN_SECRET
可选：XAI_MODEL（默认 grok-4.7）、PROMO_URL（帖子里附的网站链接；X 对带链接的帖子收费高得多，留空则不附）
"""
import argparse
import base64
import hashlib
import hmac
import os
import pathlib
import re
import secrets
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

BASE_DIR = pathlib.Path(__file__).parent
os.chdir(BASE_DIR)  # DataFeeder 用相对路径 data/

import httpx
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from dotenv import load_dotenv

load_dotenv(BASE_DIR / ".env")

from data_feeder import DataFeeder
from dynamic_runner import run_dynamic_code

SYMBOL = "BTC/USDT:USDT"
OUT_DIR = BASE_DIR / "promo_out"
POSTED_LOG = OUT_DIR / "posted.log"
NEWS_FEEDS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss/tag/bitcoin",
]
MAX_DATA_AGE_HOURS = 12
X_URL_WEIGHT = 23  # X 把任何链接按 23 个字符计
X_MAX_CHARS = 280  # 免费 / Basic 账号上限
DISCLAIMER = "Backtest only. Past results don't guarantee future returns."
BANNED = re.compile(r"guarantee|risk[- ]?free|can'?t lose|no[- ]lose|sure (win|profit)|100% (win|profit)"
                    r"|get rich|financial advice|moon", re.I)
FOOTER = ("Backtest on OKX BTC-USDT perpetual, 4H. Fees and slippage included, funding not included. "
          "Past performance does not guarantee future results.")


def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


# ── 数据与回测 ────────────────────────────────────────────────────────────────

def load_data():
    feeder = DataFeeder("okx")
    try:
        feeder.fetch_ohlcv(SYMBOL, "4h", limit=18000)
    except Exception as e:
        log(f"行情更新失败，改用本地缓存：{e}")
    df = feeder.get_local_data(SYMBOL, "4h")
    if df.empty:
        raise RuntimeError("没有本地 K 线数据")
    age_h = (pd.Timestamp.now("UTC").tz_localize(None) - df["timestamp"].iloc[-1]).total_seconds() / 3600
    if age_h > MAX_DATA_AGE_HOURS:
        raise RuntimeError(f"最新 K 线已是 {age_h:.0f} 小时前，数据过期，不发帖")
    return df


def run_backtest(df):
    code = (BASE_DIR / "strategies" / "TurtleSslDualStrategy.py").read_text(encoding="utf-8")
    result, err = run_dynamic_code(code, df, {"_timeframe": "4h", "enable_time_filter": False, "data_start_date": None}, "4h")  # full history from earliest data
    if err:
        raise RuntimeError(f"回测失败：{err[-500:]}")
    return result


def market_facts(df, result):
    close = df.set_index("timestamp")["close"]
    last = float(close.iloc[-1])
    chg = lambda days: (last / float(close[close.index <= close.index[-1] - pd.Timedelta(days=days)].iloc[-1]) - 1) * 100
    m = result["metrics"]
    open_legs = [t for t in result["trades"] if t.get("Status") == "Open"]
    if open_legs:
        d = open_legs[0]["Direction"]
        qty = sum(float(t["Size"]) for t in open_legs)
        avg = sum(float(t["Avg Entry Price"]) * float(t["Size"]) for t in open_legs) / qty
        upl = (last / avg - 1) * 100 * (1 if d == "Long" else -1)
        position = f"{d} since {open_legs[0]['Entry Timestamp'][:10]}, avg entry {avg:,.0f}, unrealized {upl:+.1f}%"
    else:
        position = "Flat (no open position), waiting for the next signal"
    return {
        "BTC price": f"{last:,.0f} USDT",
        "7-day change": f"{chg(7):+.1f}%",
        "30-day change": f"{chg(30):+.1f}%",
        "Strategy position": position,
        "Backtest period": f"{m['backtest_start']} to {m['backtest_end']}",
        "Backtest total return": f"{m['total_return_pct']:+.0f}%",
        "Max equity drawdown": f"{m['max_drawdown_pct']:.1f}%",
        "Closed-trade drawdown": f"{m['closed_max_drawdown_pct']:.1f}%",
        "Trades": str(m["total_trades"]),
        "Win rate": f"{m['win_rate_pct']:.0f}%",
        "BTC buy & hold over same period": f"{m['benchmark_return_pct']:+.0f}%",
    }


# ── 图表 ──────────────────────────────────────────────────────────────────────

def _new_fig(title, subtitle):
    plt.style.use("dark_background")
    fig, ax = plt.subplots(figsize=(12, 6.75), dpi=110)
    fig.subplots_adjust(top=0.84, bottom=0.12, left=0.08, right=0.97)
    fig.text(0.08, 0.94, title, fontsize=18, weight="bold")
    fig.text(0.08, 0.89, subtitle, fontsize=11, color="#bbbbbb")
    fig.text(0.08, 0.03, FOOTER, fontsize=8.5, color="#888888")
    ax.grid(alpha=0.15)
    return fig, ax


def chart_equity(df, result, path):
    m = result["metrics"]
    eq = pd.DataFrame(result["equity"])
    eq["t"] = pd.to_datetime(eq["time"], unit="s")
    px = df.set_index("timestamp")["close"]
    px = px[px.index >= eq["t"].iloc[0]]
    fig, ax = _new_fig(
        "BTC 4H trend strategy: backtest equity",
        f"{m['backtest_start']} to {m['backtest_end']}   Return {m['total_return_pct']:+.0f}%   "
        f"Max equity drawdown {m['max_drawdown_pct']:.1f}%   Trades {m['total_trades']}   Win rate {m['win_rate_pct']:.0f}%")
    ax.plot(eq["t"], eq["equity"], color="#26a69a", lw=2, label="Strategy equity (USDT)")
    ax.plot(px.index, px / px.iloc[0] * m["initial_capital"], color="#999999", lw=1.2,
            label="BTC buy & hold, same starting capital")
    ax.legend(loc="upper left", frameon=False)
    fig.savefig(path)
    plt.close(fig)
    return "equity curve of the strategy backtest versus BTC buy & hold"


def chart_price(df, result, path):
    close = df.set_index("timestamp")["close"]
    close = close[close.index >= close.index[-1] - pd.Timedelta(days=120)]
    fig, ax = _new_fig("BTC 4H: price and strategy trades, last 120 days",
                       f"Last close {close.iloc[-1]:,.0f} USDT   Markers = backtest entries and exits")
    ax.plot(close.index, close.values, color="#dddddd", lw=1.2)
    for t in result["trades"]:
        et = pd.Timestamp(t["Entry Timestamp"])
        if et < close.index[0]:
            continue
        long_ = t["Direction"] == "Long"
        ax.scatter(et, t["Avg Entry Price"], marker="^" if long_ else "v", s=90, zorder=3,
                   color="#26a69a" if long_ else "#ef5350")
        if t.get("Status") == "Open":
            ax.axhline(t["Avg Entry Price"], color="#f0b90b", ls="--", lw=1)
        elif t.get("Exit Timestamp"):
            ax.scatter(pd.Timestamp(t["Exit Timestamp"]), t["Avg Exit Price"], marker="x", s=70, zorder=3, color="#f0b90b")
    fig.savefig(path)
    plt.close(fig)
    return "BTC price over the last 120 days with the strategy's entries and exits"


def chart_stats(df, result, path):
    m = result["metrics"]
    rows = [
        ("Backtest period", f"{m['backtest_start']} to {m['backtest_end']}"),
        ("Starting capital", f"{m['initial_capital']:,.0f} USDT"),
        ("Net profit", f"{m['net_profit_abs']:,.0f} USDT ({m['total_return_pct']:+.0f}%)"),
        ("Annualized return (CAGR)", f"{m['cagr_pct']:.1f}%"),
        ("Max equity drawdown", f"{m['max_drawdown_pct']:.1f}%"),
        ("Max closed-trade drawdown", f"{m['closed_max_drawdown_pct']:.1f}%"),
        ("Trades / win rate", f"{m['total_trades']} / {m['win_rate_pct']:.0f}%"),
        ("Profit factor", f"{m['profit_factor']:.2f}"),
        ("BTC buy & hold, same period", f"{m['benchmark_return_pct']:+.0f}%"),
    ]
    fig, ax = _new_fig("BTC 4H trend strategy: backtest report", "Same rules, every trade, no cherry-picking")
    ax.axis("off")
    for i, (k, v) in enumerate(rows):
        y = 0.92 - i * 0.105
        ax.text(0.02, y, k, fontsize=15, color="#bbbbbb", transform=ax.transAxes)
        ax.text(0.98, y, v, fontsize=15, weight="bold", ha="right", transform=ax.transAxes)
    fig.savefig(path)
    plt.close(fig)
    return "a backtest report card with return, drawdowns, trade count and win rate"


CHARTS = {"equity": chart_equity, "price": chart_price, "stats": chart_stats}


# ── 新闻与文字 ────────────────────────────────────────────────────────────────

def fetch_news(days=7, limit=10):
    cutoff = pd.Timestamp.now("UTC") - pd.Timedelta(days=days)
    titles = []
    for url in NEWS_FEEDS:
        try:
            r = httpx.get(url, timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
            for item in ET.fromstring(r.content).findall(".//item"):
                title = (item.findtext("title") or "").strip()
                pub = item.findtext("pubDate")
                if not title or not re.search(r"bitcoin|btc", title, re.I):
                    continue
                if pub and parsedate_to_datetime(pub) < cutoff:
                    continue
                titles.append(title)
        except Exception as e:
            log(f"新闻源读取失败 {url}：{e}")
    return list(dict.fromkeys(titles))[:limit]


def x_length(text):
    urls = re.findall(r"https?://\S+", text)
    return len(re.sub(r"https?://\S+", "", text)) + X_URL_WEIGHT * len(urls)


def write_caption(facts, news, chart_desc, room):
    key = os.getenv("XAI_API_KEY")
    if not key:
        raise RuntimeError("缺少 XAI_API_KEY")
    system = (
        "You write X posts for an independent quant trader who built a BTC 4H trend-following strategy "
        "and a web app that backtests it. Goal: show the strategy and backtesting tool credibly. Rules: "
        f"English, plain text, at most {room} characters, at most 2 hashtags, no links, no emojis spam. "
        "Use ONLY the numbers given; never invent figures. If you mention the backtest return, also mention "
        "the max equity drawdown. Never promise or imply guaranteed profit, never give financial advice, "
        "never add a disclaimer (one is appended automatically). Tie one concrete news headline and the "
        "recent price trend to what the strategy is doing."
    )
    user = ("Facts:\n" + "\n".join(f"- {k}: {v}" for k, v in facts.items())
            + "\n\nThis week's BTC headlines:\n" + ("\n".join(f"- {t}" for t in news) or "- (none fetched)")
            + f"\n\nThe attached image shows {chart_desc}. Write the post.")
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for attempt in range(2):
        r = httpx.post("https://api.x.ai/v1/chat/completions", timeout=300,
                       headers={"Authorization": f"Bearer {key}"},
                       json={"model": os.getenv("XAI_MODEL", "grok-4.7"), "messages": messages})
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"].strip().strip('"')
        problem = None
        if BANNED.search(text):
            problem = f"contains a forbidden phrase ({BANNED.search(text).group(0)})"
        elif x_length(text) > room:
            problem = f"is {x_length(text)} characters, limit is {room}"
        if not problem:
            return text
        log(f"Grok 第 {attempt + 1} 次输出不合格：{problem}")
        messages += [{"role": "assistant", "content": text},
                     {"role": "user", "content": f"That post {problem}. Rewrite it following every rule."}]
    raise RuntimeError("Grok 两次输出都不合格，不发帖")


# ── X 接口（OAuth 1.0a） ──────────────────────────────────────────────────────

def _oauth_header(method, url, form=None):
    """form = application/x-www-form-urlencoded 的表单参数，OAuth 1.0a 规定必须参与签名（multipart / JSON 不参与）。"""
    q = lambda s: urllib.parse.quote(str(s), safe="")
    oauth = {
        "oauth_consumer_key": os.environ["X_API_KEY"],
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": os.environ["X_ACCESS_TOKEN"],
        "oauth_version": "1.0",
    }
    signed = {**oauth, **(form or {})}
    base = "&".join([method, q(url), q("&".join(f"{q(k)}={q(v)}" for k, v in sorted(signed.items())))])
    key = f"{q(os.environ['X_API_SECRET'])}&{q(os.environ['X_ACCESS_TOKEN_SECRET'])}"
    oauth["oauth_signature"] = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    return "OAuth " + ", ".join(f'{q(k)}="{q(v)}"' for k, v in oauth.items())


def _x_post(url, **kw):
    form = kw.get("data") if "files" not in kw else None
    r = httpx.post(url, headers={"Authorization": _oauth_header("POST", url, form)}, timeout=60, **kw)
    if r.status_code >= 300:
        raise RuntimeError(f"X 接口 {url} 返回 {r.status_code}：{r.text[:300]}")
    return r.json() if r.content else {}


def post_to_x(text, image_path):
    media_id = _x_post("https://api.x.com/2/media/upload", data={"media_category": "tweet_image"},
                       files={"media": (image_path.name, image_path.read_bytes(), "image/png")})["data"]["id"]
    return _x_post("https://api.x.com/2/tweets", json={"text": text, "media": {"media_ids": [media_id]}})["data"]["id"]


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只生成图片和文字，不发帖")
    ap.add_argument("--chart", choices=list(CHARTS), help="指定图表类型（默认按星期轮换）")
    args = ap.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    if not args.dry_run and POSTED_LOG.exists() and today in POSTED_LOG.read_text(encoding="utf-8"):
        log("今天已经发过，跳过")
        return

    df = load_data()
    result = run_backtest(df)
    facts = market_facts(df, result)
    news = fetch_news()
    log(f"抓到 {len(news)} 条新闻标题")

    kind = args.chart or list(CHARTS)[time.localtime().tm_wday % len(CHARTS)]
    stem = OUT_DIR / time.strftime("%Y%m%d_%H%M")
    image = stem.with_suffix(".png")
    chart_desc = CHARTS[kind](df, result, image)

    url = os.getenv("PROMO_URL", "").strip()
    tail = (f"\n{url}" if url else "") + f"\n{DISCLAIMER}"
    room = X_MAX_CHARS - x_length(tail)
    try:
        caption = write_caption(facts, news, chart_desc, room)
    except RuntimeError as e:
        if not args.dry_run:
            raise
        caption = f"[试跑：未生成文字，原因：{e}]"
    text = caption + tail
    stem.with_suffix(".txt").write_text(text, encoding="utf-8")
    log(f"图表：{image.name}（{kind}），文字 {x_length(text)} 字符：\n{text}")

    if args.dry_run:
        log("试跑结束，未发帖")
        return
    tweet_id = post_to_x(text, image)
    with POSTED_LOG.open("a", encoding="utf-8") as f:
        f.write(f"{today} {tweet_id} {kind}\n")
    log(f"已发帖：https://x.com/i/status/{tweet_id}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"失败：{e}")
        sys.exit(1)
