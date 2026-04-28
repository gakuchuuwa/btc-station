"""
Freqtrade live/dry-run daemon manager for Phase 6.
Uses subprocess.Popen to launch `freqtrade trade` as a long-running background process.
PID files under USERS_DIR/<user_id>/live/ manage lifecycle (start / stop / status).
"""
import os
import json
import signal
import logging
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR  = os.environ.get("FT_DATA_DIR",  "/data/historical")
USERS_DIR = os.environ.get("FT_USERS_DIR", "/data/users")
FT_IMAGE  = os.environ.get("FT_IMAGE",     "btcstation/freqtrade:latest")

# Freqtrade REST API port inside the container / process
FT_API_PORT_BASE = int(os.environ.get("FT_API_PORT_BASE", "8080"))


def _live_dir(user_id: str) -> Path:
    p = Path(USERS_DIR) / user_id / "live"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _pid_file(user_id: str) -> Path:
    return _live_dir(user_id) / "freqtrade.pid"


def _config_file(user_id: str) -> Path:
    return _live_dir(user_id) / "live_config.json"


def _strategy_file(user_id: str, class_name: str) -> Path:
    strategies_dir = Path(USERS_DIR) / user_id / "strategies"
    strategies_dir.mkdir(parents=True, exist_ok=True)
    return strategies_dir / f"{class_name}.py"


def _log_file(user_id: str) -> Path:
    return _live_dir(user_id) / "freqtrade.log"


def _port_for_user(user_id: str) -> int:
    """Deterministic per-user API port derived from user_id hash to avoid collisions."""
    return FT_API_PORT_BASE + (abs(hash(user_id)) % 1000)


def _write_live_config(
    user_id: str,
    class_name: str,
    dry_run: bool,
    timeframe: str,
    stake_amount: float,
    okx_api_key: str,
    okx_secret: str,
    okx_password: str,
) -> str:
    """Write freqtrade config.json for live/dry-run trade mode."""
    port = _port_for_user(user_id)

    # OKX perpetual pair
    pair = "BTC/USDT:USDT"

    config = {
        "max_open_trades": 1,
        "stake_currency": "USDT",
        "stake_amount": stake_amount,
        "tradable_balance_ratio": 0.99,
        "fiat_display_currency": "USD",
        "timeframe": timeframe,
        "dry_run": dry_run,
        "dry_run_wallet": stake_amount if dry_run else None,
        "cancel_open_orders_on_exit": True,
        "trading_mode": "futures",
        "margin_mode": "isolated",
        "exchange": {
            "name": "okx",
            "key": okx_api_key,
            "secret": okx_secret,
            "password": okx_password,
            "ccxt_config": {"defaultType": "swap"},
            "ccxt_async_config": {"defaultType": "swap"},
            "pair_whitelist": [pair],
            "pair_blacklist": [],
        },
        "pairlists": [{"method": "StaticPairList"}],
        "entry_pricing": {"price_side": "same", "use_order_book": False, "order_book_top": 1},
        "exit_pricing":  {"price_side": "same", "use_order_book": False, "order_book_top": 1},
        "api_server": {
            "enabled": True,
            "listen_ip_address": "0.0.0.0",
            "listen_port": port,
            "verbosity": "error",
            "enable_openapi": False,
            "jwt_secret_key": os.urandom(32).hex(),
            "username": "btcstation",
            "password": os.urandom(16).hex(),
        },
        "bot_name": f"btcstation-{user_id[:8]}",
        "internals": {"process_throttle_secs": 5},
        "telegram": {"enabled": False},
    }

    # Remove dry_run_wallet key when live (None values confuse FT)
    if not dry_run:
        config.pop("dry_run_wallet", None)

    path = _config_file(user_id)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    return str(path)


def is_running(user_id: str) -> bool:
    pid_path = _pid_file(user_id)
    if not pid_path.exists():
        return False
    try:
        pid = int(pid_path.read_text().strip())
        # os.kill(pid, 0) raises OSError if process is gone
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        pid_path.unlink(missing_ok=True)
        return False


def start_live(
    user_id: str,
    strategy_class: str,
    strategy_code: str,
    dry_run: bool,
    timeframe: str,
    stake_amount: float,
    okx_api_key: str,
    okx_secret: str,
    okx_password: str,
) -> dict:
    """
    Launch `freqtrade trade` as a background process.
    Returns {"status": "started", "pid": <int>, "dry_run": <bool>, "port": <int>}
    """
    if is_running(user_id):
        return {"status": "already_running", "pid": _read_pid(user_id)}

    # Write strategy file
    strat_path = _strategy_file(user_id, strategy_class)
    strat_path.write_text(strategy_code, encoding="utf-8")

    strategies_dir = str(strat_path.parent)
    config_path = _write_live_config(
        user_id, strategy_class, dry_run, timeframe, stake_amount,
        okx_api_key, okx_secret, okx_password,
    )

    results_dir = str(_live_dir(user_id))
    log_path    = str(_log_file(user_id))

    cmd = [
        "freqtrade", "trade",
        "--config",        config_path,
        "--strategy",      strategy_class,
        "--strategy-path", strategies_dir,
        "--userdir",       results_dir,
        "--datadir",       DATA_DIR,
        "--logfile",       log_path,
    ]

    logger.info(f"[LIVE {user_id[:8]}] Launching: {' '.join(cmd)}")

    log_fh = open(log_path, "a", encoding="utf-8")
    proc = subprocess.Popen(
        cmd,
        stdout=log_fh,
        stderr=log_fh,
        stdin=subprocess.DEVNULL,
        start_new_session=True,  # detach from parent so it survives API worker recycles
    )

    pid = proc.pid
    _pid_file(user_id).write_text(str(pid), encoding="utf-8")

    # Persist metadata alongside the PID so status() can report it without re-reading config
    meta = {
        "pid": pid,
        "dry_run": dry_run,
        "timeframe": timeframe,
        "stake_amount": stake_amount,
        "strategy_class": strategy_class,
        "port": _port_for_user(user_id),
    }
    (_live_dir(user_id) / "meta.json").write_text(json.dumps(meta), encoding="utf-8")

    logger.info(f"[LIVE {user_id[:8]}] PID={pid}, dry_run={dry_run}, port={meta['port']}")
    return {"status": "started", **meta}


def stop_live(user_id: str) -> dict:
    """
    Gracefully stop the running Freqtrade trade process (SIGTERM, then SIGKILL after 10s).
    """
    pid_path = _pid_file(user_id)
    if not pid_path.exists():
        return {"status": "not_running"}

    try:
        pid = int(pid_path.read_text().strip())
    except ValueError:
        pid_path.unlink(missing_ok=True)
        return {"status": "not_running"}

    try:
        os.kill(pid, signal.SIGTERM)
        # Give it up to 10 s to shut down gracefully
        import time
        for _ in range(10):
            time.sleep(1)
            try:
                os.kill(pid, 0)
            except OSError:
                break
        else:
            # Still alive after 10 s → force kill
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    except OSError:
        pass  # already gone

    pid_path.unlink(missing_ok=True)
    logger.info(f"[LIVE {user_id[:8]}] Stopped PID={pid}")
    return {"status": "stopped", "pid": pid}


def _read_pid(user_id: str) -> Optional[int]:
    try:
        return int(_pid_file(user_id).read_text().strip())
    except Exception:
        return None


def get_status(user_id: str) -> dict:
    """Return current live session status and metadata."""
    running = is_running(user_id)
    meta_path = _live_dir(user_id) / "meta.json"
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            pass

    return {
        "running": running,
        "pid": _read_pid(user_id) if running else None,
        **meta,
    }


def tail_log(user_id: str, lines: int = 100) -> list[str]:
    """Return the last N lines from the Freqtrade log file."""
    log_path = _log_file(user_id)
    if not log_path.exists():
        return []
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
        return text.splitlines()[-lines:]
    except Exception:
        return []
