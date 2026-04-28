"""
Freqtrade Docker container orchestration for Phase 3.1.
Manages per-user Freqtrade containers for backtesting.
"""
import os
import json
import time
import uuid
import logging
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("FT_DATA_DIR", "/data/historical")
USERS_DIR = os.environ.get("FT_USERS_DIR", "/data/users")
FT_IMAGE = os.environ.get("FT_IMAGE", "btcstation/freqtrade:latest")

# Resource limits per plan
PLAN_LIMITS = {
    "free": {"mem": "512m", "cpu_quota": 50000, "timeout": 300},
    "pro":  {"mem": "2g",   "cpu_quota": 200000, "timeout": 1800},
}


import subprocess

def _run_subprocess(cmd: list[str], timeout: int, on_log: Optional[Callable[[str], None]] = None) -> tuple[int, str]:
    """Run a subprocess, capture all output, return (exit_code, full_output)."""
    print(f"[SUBPROCESS] Running: {' '.join(cmd)}", flush=True)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        full_output = (result.stdout or "") + "\n" + (result.stderr or "")
        # Print to Railway logs directly — print FULL output in chunks to bypass log line limits
        print(f"[SUBPROCESS] Exit code: {result.returncode}", flush=True)
        print(f"[SUBPROCESS] Output total length: {len(full_output)} chars", flush=True)
        # Print line by line so Railway log truncation per-line doesn't hide content
        for i, line in enumerate(full_output.splitlines()):
            print(f"[FT-OUT {i:04d}] {line}", flush=True)
        if on_log:
            on_log(f"退出码 {result.returncode}")
            for line in full_output.splitlines()[-30:]:
                if line.strip():
                    on_log(line)
        return result.returncode, full_output
    except subprocess.TimeoutExpired:
        raise TimeoutError(f"进程超时（{timeout}秒）")


def _ensure_user_dirs(user_id: str) -> tuple[str, str]:
    strategies_dir = Path(USERS_DIR) / user_id / "strategies"
    results_dir = Path(USERS_DIR) / user_id / "results"
    strategies_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)
    return str(strategies_dir), str(results_dir)


def _write_strategy_file(strategies_dir: str, class_name: str, code: str) -> str:
    path = Path(strategies_dir) / f"{class_name}.py"
    path.write_text(code, encoding="utf-8")
    return str(path)


def _write_freqtrade_config(
    results_dir: str,
    timeframe: str,
    market: str,
    initial_capital: float,
    leverage: int,
    fee_pct: float,
) -> str:
    """
    永续模式采用 TV 风格简化处理：
      - 用现货 BTC/USDT 数据（5+ 年历史完整）
      - 通过 stake_amount × leverage 模拟杠杆
      - 不模拟资金费率、强平价（避免数据缺失）
    现货模式：1x，正常回测
    """
    # 永远用现货 pair，避免 funding_rate 数据问题
    pair = "BTC/USDT"
    # effective_wallet = 杠杆后总钱包，dry_run_wallet 决定可用余额上限
    # stake_amount = "unlimited" → 全仓复利滚动，每次把全部余额投入一笔
    effective_wallet = initial_capital * leverage if market == "futures" else initial_capital

    config = {
        "max_open_trades": 1,
        "stake_currency": "USDT",
        "stake_amount": "unlimited",
        "tradable_balance_ratio": 0.99,
        "fiat_display_currency": "USD",
        "timeframe": timeframe,
        "dry_run": True,
        "dry_run_wallet": effective_wallet,
        "cancel_open_orders_on_exit": False,
        "trading_mode": "spot",  # 强制 spot，永续靠 stake_amount 倍数模拟
        "exchange": {
            "name": "binance",
            "key": "",
            "secret": "",
            "ccxt_config": {},
            "ccxt_async_config": {},
            "pair_whitelist": [pair],
            "pair_blacklist": [],
        },
        "pairlists": [{"method": "StaticPairList"}],
        "entry_pricing": {"price_side": "same", "use_order_book": False, "order_book_top": 1},
        "exit_pricing": {"price_side": "same", "use_order_book": False, "order_book_top": 1},
        "fee": fee_pct / 100,
        "internals": {"process_throttle_secs": 5},
    }

    config_path = Path(results_dir) / "config.json"
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    return str(config_path)


def run_backtest_container(
    user_id: str,
    task_id: str,
    strategy_class: str,
    strategy_code: str,
    timeframe: str,
    timerange: str,
    market: str,
    initial_capital: float,
    leverage: int,
    fee_pct: float,
    plan: str,
    on_log: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Synchronous: spin up a Freqtrade container, run backtest, return parsed result dict.
    Called from a Celery worker thread.
    """
    # 替换为直接使用 subprocess 调用 freqtrade
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])

    strategies_dir, results_dir = _ensure_user_dirs(user_id)
    _write_strategy_file(strategies_dir, strategy_class, strategy_code)
    config_path = _write_freqtrade_config(results_dir, timeframe, market, initial_capital, leverage, fee_pct)

    task_name = f"ft-{user_id[:8]}-{task_id[:8]}"

    if on_log:
        on_log(f"启动回测进程 {task_name} ...")

    try:
        # Step 1: 下载现货历史数据（永续模式也用现货数据 + 杠杆模拟）
        pair = "BTC/USDT"

        download_cmd = [
            "freqtrade", "download-data",
            "--config", config_path,
            "--pairs", pair,
            "--timeframes", timeframe,
            "--days", "1800",
            "--datadir", DATA_DIR,
        ]

        if on_log:
            on_log(f"正在下载历史数据（{pair} {timeframe}）...")

        dl_exit, dl_output = _run_subprocess(download_cmd, timeout=300, on_log=None)
        if on_log:
            on_log(f"数据下载退出码: {dl_exit}")
            # 发送下载过程中的关键行
            for line in dl_output.splitlines()[-20:]:
                if line.strip() and any(kw in line for kw in ["Download", "download", "Error", "error", "Found", "Saving"]):
                    on_log(line.strip())
        if dl_exit != 0:
            raise RuntimeError(f"历史数据下载失败 (退出码 {dl_exit}):\n{dl_output[-1500:]}")

        # 验证数据文件是否存在
        data_path = Path(DATA_DIR)
        json_data_files = list(data_path.rglob("*.json"))
        feather_files = list(data_path.rglob("*.feather"))
        if on_log:
            on_log(f"数据目录包含 {len(json_data_files)} 个 JSON 文件, {len(feather_files)} 个 feather 文件")
            # 列出所有数据文件（方便调试）
            all_data = json_data_files + feather_files
            if all_data:
                on_log(f"数据文件: {[str(f.relative_to(data_path)) for f in all_data[:10]]}")
                # 输出第一个数据文件的大小，确认有数据
                first = all_data[0]
                size_kb = first.stat().st_size / 1024
                on_log(f"首个数据文件大小: {size_kb:.1f} KB")
        # 也通过 print 写到 Railway 日志（绕过前端日志面板限制）
        print(f"[DATA-CHECK] DATA_DIR={DATA_DIR}", flush=True)
        for p in data_path.rglob("*"):
            try:
                sz = p.stat().st_size if p.is_file() else 0
                print(f"[DATA-CHECK] {p}: {sz} bytes", flush=True)
            except Exception:
                pass
        if not json_data_files and not feather_files:
            all_items = list(data_path.rglob("*"))
            raise RuntimeError(f"数据目录为空，下载可能未成功。目录内容: {[str(f) for f in all_items[:20]]}")

        if on_log:
            on_log("开始执行回测...")

        # Step 2: 执行回测
        # 把结果文件写到我们自己的 results_dir（有写入权限）
        result_file = str(Path(results_dir) / "bt_result.json")

        cmd = [
            "freqtrade", "backtesting",
            "--config", config_path,
            "--strategy", strategy_class,
            "--timerange", timerange,
            "--export", "trades",
            "--export-filename", result_file,
            "--datadir", DATA_DIR,
            "--strategy-path", strategies_dir,
            "--userdir", results_dir,
            "--cache", "none",
            "-v",  # 详细日志模式，输出 BACKTESTING REPORT + 信号诊断
        ]

        if on_log:
            on_log(f"执行命令: {' '.join(cmd)}")

        # 不传 on_log 给 _run_subprocess，避免日志重复；我们自己在下方过滤关键行
        exit_code, bt_output = _run_subprocess(cmd, timeout=limits["timeout"], on_log=None)

        if on_log:
            # 过滤出关键行并发送
            key_lines = [l for l in bt_output.splitlines() if any(
                kw in l for kw in ["Trade", "trade", "profit", "Profit", "Result", "result",
                                    "No data", "no data", "Warning", "Error", "error",
                                    "Signal", "signal", "Backtesting", "backtesting",
                                    "BACKTESTING REPORT", "entry", "exit", "pair",
                                    "Applying", "Loading", "Found"]
            )]
            on_log(f"回测进程退出码: {exit_code} | 筛出关键日志: {len(key_lines)} 行")
            for line in key_lines[-40:]:
                if line.strip():
                    on_log(line.strip())

        if exit_code != 0:
            raise RuntimeError(f"Freqtrade 退出码 {exit_code}:\n{bt_output}")

        # Step 3: 查找结果文件
        # Freqtrade 2024+ 把结果写到 --userdir/backtest_results/ 子目录
        # 主数据文件格式可能是: .json, .zip, .feather - 我们都要扫
        # .meta.json 是元数据（不含 trades 详情）
        bt_results_dir = Path(results_dir) / "backtest_results"
        search_dirs = [bt_results_dir, Path(results_dir)] if bt_results_dir.exists() else [Path(results_dir)]

        # 列出所有可能的结果文件以便调试
        all_files_in_results = []
        for sd in search_dirs:
            for f in sd.rglob("*"):
                if f.is_file():
                    all_files_in_results.append(f)
        print(f"[RESULT] All files in result dirs ({len(all_files_in_results)}):", flush=True)
        for f in all_files_in_results:
            print(f"[RESULT]   {f}: {f.stat().st_size} bytes", flush=True)

        data_files = []
        meta_files = []
        zip_files = []
        for f in all_files_in_results:
            if f.name in ("config.json", ".last_result.json"):
                continue
            if f.name.endswith(".meta.json"):
                meta_files.append(f)
            elif f.suffix == ".zip":
                zip_files.append(f)
            elif f.suffix == ".json":
                data_files.append(f)

        data_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        meta_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        zip_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        print(f"[RESULT] JSON data files: {[str(f) for f in data_files]}", flush=True)
        print(f"[RESULT] ZIP files: {[str(f) for f in zip_files]}", flush=True)
        print(f"[RESULT] Meta files: {[str(f) for f in meta_files]}", flush=True)

        # Freqtrade 2024+ 默认写 .zip 包，含 main JSON + meta
        # 优先级: zip > json data > meta
        raw = None
        if zip_files:
            import zipfile
            zf_path = zip_files[0]
            if on_log:
                on_log(f"读取 ZIP 结果包: {zf_path.name}")
            with zipfile.ZipFile(zf_path) as zf:
                # zip 内部一般有一个主 .json 文件（不是 .meta.json）
                main_name = None
                for name in zf.namelist():
                    if name.endswith(".meta.json"):
                        continue
                    if name.endswith(".json"):
                        main_name = name
                        break
                if not main_name:
                    raise FileNotFoundError(f"ZIP {zf_path.name} 内没有主 JSON 数据文件: {zf.namelist()}")
                with zf.open(main_name) as fp:
                    raw = json.load(fp)
                if on_log:
                    on_log(f"从 ZIP 内读取: {main_name}")
        elif data_files:
            result_path = data_files[0]
            if on_log:
                on_log(f"使用结果文件: {result_path.name}")
            with open(result_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        elif meta_files:
            result_path = meta_files[0]
            if on_log:
                on_log(f"⚠ 仅找到 meta 文件: {result_path.name}")
            with open(result_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        else:
            raise FileNotFoundError(
                f"回测结果文件未生成。结果目录文件: {[f.name for f in all_files_in_results]}\n"
                f"Freqtrade 输出末尾:\n{bt_output[-1500:]}"
            )

        trades_count = len(raw.get("trades", []))
        if on_log:
            on_log(f"回测完成！交易笔数: {trades_count}")
            if trades_count == 0:
                # 输出摘要信息帮助诊断0交易原因
                strat_comp = raw.get("strategy_comparison", [])
                if strat_comp:
                    sc = strat_comp[0]
                    on_log(f"策略摘要: trades={sc.get('trades',0)}, profit={sc.get('profit_total',0):.4f}, "
                           f"wins={sc.get('wins',0)}, losses={sc.get('losses',0)}")
                pairs = raw.get("results_per_pair", [])
                if pairs:
                    on_log(f"数据对: {[p.get('key','?') for p in pairs[:5]]}")
                top_keys = {k: v for k, v in raw.items() if k not in ("trades", "results_per_pair", "strategy_comparison")}
                on_log(f"结果文件顶层键: {list(top_keys.keys())[:15]}")
                on_log(f"--- Freqtrade输出末尾 ---")
                for line in bt_output.splitlines()[-30:]:
                    if line.strip():
                        on_log(line.strip())

        return raw

    except Exception as e:
        if on_log:
            on_log(f"回测执行异常: {str(e)}")
        raise

