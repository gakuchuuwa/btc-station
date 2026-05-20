"""
Dashboard API — 市场总览 / 链上数据 / 宏观指标
路由前缀: /api/dashboard
"""

import time
import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/dashboard")

# ── 内存缓存 ──────────────────────────────────────────────────────────────
_cache: dict = {}

def _get_cached(key: str, ttl: int):
    """取缓存，未过期返回 data，否则返回 None"""
    entry = _cache.get(key)
    if entry and time.time() - entry["ts"] < ttl:
        return entry["data"]
    return None

def _set_cached(key: str, data):
    _cache[key] = {"data": data, "ts": time.time()}


# ── 通用 HTTP 辅助 ────────────────────────────────────────────────────────
def _get_json(url: str, timeout: int = 5):
    """发起 GET 请求并返回 JSON，失败返回 None"""
    try:
        r = httpx.get(url, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════════
# 端点 1: GET /api/dashboard/market
# ══════════════════════════════════════════════════════════════════════════
def _fetch_market_data() -> dict:
    """拉取多交易所市场数据，各数据源独立 try/except"""

    # ── 资金费率 ──
    funding = {}
    # Binance
    try:
        j = _get_json("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1")
        funding["binance"] = float(j[0]["fundingRate"]) if j else None
    except Exception:
        funding["binance"] = None
    # OKX
    try:
        j = _get_json("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP")
        funding["okx"] = float(j["data"][0]["fundingRate"]) if j else None
    except Exception:
        funding["okx"] = None
    # Bybit
    try:
        j = _get_json("https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1")
        funding["bybit"] = float(j["result"]["list"][0]["fundingRate"]) if j else None
    except Exception:
        funding["bybit"] = None

    # ── 持仓量 OI ──
    oi = {}
    # Binance（返回 USD 计价）
    try:
        j = _get_json("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT")
        oi["binance_usd"] = float(j["openInterest"]) if j else None
    except Exception:
        oi["binance_usd"] = None
    # OKX（返回 BTC 计价）
    try:
        j = _get_json("https://www.okx.com/api/v5/market/open-interest?instType=SWAP&instId=BTC-USDT-SWAP")
        oi["okx_btc"] = float(j["data"][0]["oi"]) if j else None
    except Exception:
        oi["okx_btc"] = None

    # ── 24h 爆仓 ──
    liq = {"long_usd": 0.0, "short_usd": 0.0}
    try:
        j = _get_json("https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT")
        if j:
            cutoff = (time.time() - 86400) * 1000  # 24 小时前的毫秒时间戳
            for order in j:
                if order.get("time", 0) < cutoff:
                    continue
                amount = float(order.get("price", 0)) * float(order.get("executedQty", 0))
                side = order.get("side", "").upper()
                # SELL 方向 = 多头被强平; BUY 方向 = 空头被强平
                if side == "SELL":
                    liq["long_usd"] += amount
                elif side == "BUY":
                    liq["short_usd"] += amount
    except Exception:
        pass

    # ── 交易所价差 ──
    prices = {}
    # Binance
    try:
        j = _get_json("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
        prices["binance"] = float(j["price"]) if j else None
    except Exception:
        prices["binance"] = None
    # OKX
    try:
        j = _get_json("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT")
        prices["okx"] = float(j["data"][0]["last"]) if j else None
    except Exception:
        prices["okx"] = None
    # Coinbase
    try:
        j = _get_json("https://api.coinbase.com/v2/prices/BTC-USD/spot")
        prices["coinbase"] = float(j["data"]["amount"]) if j else None
    except Exception:
        prices["coinbase"] = None

    # 计算价差百分比（最高价 - 最低价）/ 最低价 * 100
    valid_prices = [p for p in prices.values() if p is not None]
    spread_pct = None
    if len(valid_prices) >= 2:
        spread_pct = round((max(valid_prices) - min(valid_prices)) / min(valid_prices) * 100, 4)

    return {
        "funding_rates": funding,
        "open_interest": oi,
        "liquidations_24h": liq,
        "prices": prices,
        "spread_pct": spread_pct,
        "updated_at": int(time.time()),
    }


@router.get("/market")
def get_market():
    """市场总览：资金费率 / OI / 爆仓 / 价差"""
    cached = _get_cached("market", ttl=30)
    if cached:
        return cached
    data = _fetch_market_data()
    _set_cached("market", data)
    return data


# ══════════════════════════════════════════════════════════════════════════
# 端点 2: GET /api/dashboard/onchain
# ══════════════════════════════════════════════════════════════════════════
def _fetch_onchain_data() -> dict:
    """拉取 mempool.space 链上数据"""

    # ── 算力（EH/s）──
    hashrate_eh = None
    try:
        j = _get_json("https://mempool.space/api/v1/mining/hashrate/1m")
        if j and j.get("hashrates"):
            hashrate_eh = round(j["hashrates"][-1]["avgHashrate"] / 1e18, 2)
    except Exception:
        pass

    # ── 内存池 ──
    mempool_count = None
    mempool_vsize_mb = None
    try:
        j = _get_json("https://mempool.space/api/mempool")
        if j:
            mempool_count = j.get("count")
            vsize = j.get("vsize", 0)
            mempool_vsize_mb = round(vsize / 1e6, 2)
    except Exception:
        pass

    # ── 区块间隔（前 3 个区块的 timestamp 差值平均）──
    avg_block_interval = None
    try:
        j = _get_json("https://mempool.space/api/v1/blocks")
        if j and len(j) >= 4:
            diffs = []
            for i in range(3):
                d = j[i]["timestamp"] - j[i + 1]["timestamp"]
                diffs.append(d)
            avg_block_interval = round(sum(diffs) / len(diffs))
    except Exception:
        pass

    # ── 难度调整 ──
    difficulty = {}
    try:
        j = _get_json("https://mempool.space/api/v1/difficulty-adjustment")
        if j:
            difficulty = {
                "progress_pct": round(j.get("progressPercent", 0), 2),
                "change_pct": round(j.get("difficultyChange", 0), 2),
                "remaining_blocks": j.get("remainingBlocks"),
            }
    except Exception:
        pass

    return {
        "hashrate_eh": hashrate_eh,
        "mempool_count": mempool_count,
        "mempool_vsize_mb": mempool_vsize_mb,
        "avg_block_interval_sec": avg_block_interval,
        "difficulty_adjustment": difficulty,
        "updated_at": int(time.time()),
    }


@router.get("/onchain")
def get_onchain():
    """链上数据：算力 / 内存池 / 区块间隔 / 难度调整"""
    cached = _get_cached("onchain", ttl=300)
    if cached:
        return cached
    data = _fetch_onchain_data()
    _set_cached("onchain", data)
    return data


# ══════════════════════════════════════════════════════════════════════════
# 端点 3: GET /api/dashboard/macro
# ══════════════════════════════════════════════════════════════════════════

# 恐惧贪婪中文标签映射
_FNG_LABELS = {
    "Extreme Fear": "极度恐惧",
    "Fear": "恐惧",
    "Neutral": "中性",
    "Greed": "贪婪",
    "Extreme Greed": "极度贪婪",
}


def _fetch_macro_data() -> dict:
    """拉取宏观指标数据"""

    # ── 恐惧贪婪指数 ──
    fear_greed = {}
    try:
        j = _get_json("https://api.alternative.me/fng/?limit=1&format=json")
        if j and j.get("data"):
            item = j["data"][0]
            raw_label = item.get("value_classification", "")
            fear_greed = {
                "value": int(item["value"]),
                "label": _FNG_LABELS.get(raw_label, raw_label),
            }
    except Exception:
        pass

    # ── DXY（美元指数）──
    dxy = None
    try:
        import yfinance as yf
        ticker = yf.Ticker("DX-Y.NYB")
        hist = ticker.history(period="5d")
        if not hist.empty:
            dxy = round(float(hist["Close"].iloc[-1]), 2)
    except Exception:
        pass

    # ── BTC-SPX 30 天滚动相关性 ──
    btc_spx_corr = None
    try:
        import yfinance as yf
        import pandas as pd

        # SPX 60 天日线
        spx = yf.Ticker("^GSPC").history(period="90d")

        # BTC 60 天日线（Binance）
        btc_j = _get_json(
            "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=60"
        )
        if btc_j and not spx.empty:
            btc_closes = pd.Series(
                [float(k[4]) for k in btc_j],
                index=pd.to_datetime([k[0] for k in btc_j], unit="ms"),
            )
            # 对齐到工作日
            spx_ret = spx["Close"].pct_change().dropna()
            btc_ret = btc_closes.pct_change().dropna()

            # 取两者都有数据的日期
            common = spx_ret.index.intersection(btc_ret.index)
            if len(common) >= 30:
                corr = spx_ret.loc[common].tail(30).corr(btc_ret.loc[common].tail(30))
                btc_spx_corr = round(float(corr), 4) if corr == corr else None  # NaN 检查
    except Exception:
        pass

    # ── 200 周均线距离 ──
    wma200 = {}
    try:
        btc_w = _get_json(
            "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=200"
        )
        if btc_w and len(btc_w) >= 200:
            closes = [float(k[4]) for k in btc_w]
            sma200w = sum(closes) / len(closes)
            current = closes[-1]
            dist_pct = round((current - sma200w) / sma200w * 100, 2)
            wma200 = {
                "value": round(sma200w, 2),
                "current_price": round(current, 2),
                "distance_pct": dist_pct,
            }
    except Exception:
        pass

    # ── Pi Cycle Top 指标 ──
    pi_cycle = {}
    try:
        btc_d = _get_json(
            "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=365"
        )
        if btc_d and len(btc_d) >= 350:
            closes = [float(k[4]) for k in btc_d]
            # SMA111 = 最近 111 根日线收盘价的简单移动平均
            sma111 = sum(closes[-111:]) / 111
            # SMA350x2 = 最近 350 根日线收盘价的简单移动平均 * 2
            sma350x2 = (sum(closes[-350:]) / 350) * 2
            dist_pct = round((sma111 - sma350x2) / sma350x2 * 100, 2)
            # 当 SMA111 >= SMA350x2 时视为触发
            triggered = sma111 >= sma350x2
            pi_cycle = {
                "sma111": round(sma111, 2),
                "sma350x2": round(sma350x2, 2),
                "distance_pct": dist_pct,
                "triggered": triggered,
            }
    except Exception:
        pass

    return {
        "fear_greed": fear_greed,
        "dxy": dxy,
        "btc_spx_corr_30d": btc_spx_corr,
        "wma200": wma200,
        "pi_cycle": pi_cycle,
        "updated_at": int(time.time()),
    }


@router.get("/macro")
def get_macro():
    """宏观指标：恐惧贪婪 / DXY / BTC-SPX 相关性 / 200W SMA / Pi Cycle"""
    cached = _get_cached("macro", ttl=300)  # 5 分钟缓存（恐贪/DXY/200WMA 本身变化慢，避免频繁调 yfinance 被 Yahoo 限流）
    if cached:
        return cached
    data = _fetch_macro_data()
    _set_cached("macro", data)
    return data
