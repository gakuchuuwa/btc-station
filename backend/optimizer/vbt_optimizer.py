import io
import csv
import pandas as pd
import pandas_ta as ta
import vectorbt as vbt
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List

# Import DataFeeder from the backend directory
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from data_feeder import DataFeeder

router = APIRouter()

class OptimizeRequest(BaseModel):
    symbol: str = "BTC/USDT"
    timeframe: str = "4h"
    fast_ma_range: List[int] = [10, 15, 20]
    slow_ma_range: List[int] = [30, 40, 50]
    initial_capital: float = 10000.0

def run_vectorbt_grid_search(df: pd.DataFrame, fast_range: List[int], slow_range: List[int], initial_capital: float):
    # Ensure datetime index is proper for vectorbt
    if 'timestamp' in df.columns:
        df = df.set_index('timestamp')
        
    fast_ma_grid, slow_ma_grid = vbt.utils.params.create_param_combs(
        (fast_range, slow_range)
    )
    
    valid_mask = fast_ma_grid < slow_ma_grid
    fast_ma_grid = fast_ma_grid[valid_mask]
    slow_ma_grid = slow_ma_grid[valid_mask]

    if len(fast_ma_grid) == 0:
        raise ValueError("No valid parameter combinations. Fast MA must be strictly less than Slow MA.")

    fast_ma = vbt.MA.run(df['close'], window=fast_ma_grid, short_name='fast')
    slow_ma = vbt.MA.run(df['close'], window=slow_ma_grid, short_name='slow')
    
    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)
    
    pf = vbt.Portfolio.from_signals(
        df['close'],
        entries,
        exits,
        init_cash=initial_capital,
        fees=0.0005,
        freq='4h'
    )
    
    returns = pf.total_return()
    best_idx = returns.idxmax()
    
    # Extract the best portfolio out of the multi-dimensional index
    best_pf = pf.iloc[best_idx]
    
    return best_pf, {"fast_ma": best_idx[0], "slow_ma": best_idx[1]}

def generate_tv_csv(pf: vbt.Portfolio, params: dict, initial_capital: float) -> str:
    stats = pf.stats()
    trades_df = pf.trades.records_readable
    
    net_profit_pct = round(stats.get("Total Return [%]", 0), 4)
    win_rate = round(stats.get("Win Rate [%]", 0), 2)
    max_dd = round(stats.get("Max Drawdown [%]", 0), 4)
    total_trades = int(stats.get("Total Trades", 0))
    net_profit_abs = round(net_profit_pct / 100 * initial_capital, 4)
    
    param_headers = [f"__{k}" for k in params.keys()]
    param_values = list(params.values())
    
    header = [
        "Net profit %: All", "Net profit: All", "Gross profit: All", "Gross loss: All", "Percent profitable: All",
        "Total trades: All", "Winning trades: All", "Losing trades: All", "Avg winning trade %: All", "Avg losing trade %: All",
        "Largest winning trade %: All", "Largest losing trade %: All", "Max equity drawdown %", "Profit factor: All",
        "Sharpe ratio", "Sortino ratio", "Calmar ratio", "Initial Capital: All", "Net profit abs: All",
        "Net profit %: Long", "Total trades: Long", "Win rate %: Long", "Avg win %: Long",
        "Net profit %: Short", "Total trades: Short", "Win rate %: Short", "Avg win %: Short",
        "Funding fee cost total", "Liquidations",
        "Trade #", "Open date", "Close date", "Duration", "Direction", "Entry price", "Exit price",
        "Profit %", "Profit abs", "Cumulative profit %"
    ] + param_headers
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)
    
    summary_row = [
        net_profit_pct, net_profit_abs, "", "", win_rate, total_trades, "", "",
        "", "", "", "", max_dd, "", "", "", "", initial_capital, net_profit_abs,
        "", "", "", "", "", "", "", "", 0, 0,
        "", "", "", "", "", "", "", "", "", ""
    ] + param_values
    writer.writerow(summary_row)
    
    cumulative = 0.0
    for i, t in trades_df.iterrows():
        pnl_pct = round(t.get("Return", 0) * 100, 4)
        pnl_abs = round(t.get("PnL", 0), 4)
        cumulative += pnl_pct
        
        direction = t.get("Direction", "Long")
        if isinstance(direction, str):
            direction = direction.replace("Direction.", "")
        
        row = [
            "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
            "", "", "", "", "", "", "", "", "", "",
            i + 1, 
            t.get("Entry Timestamp", ""), 
            t.get("Exit Timestamp", ""), 
            "", 
            direction,
            round(t.get("Entry Price", 0), 2),
            round(t.get("Exit Price", 0), 2),
            pnl_pct, pnl_abs, round(cumulative, 4)
        ] + ([""] * len(param_headers))
        writer.writerow(row)
        
    return "﻿" + output.getvalue()

@router.post("/optimize_strategy_csv")
async def optimize_strategy_csv(req: OptimizeRequest):
    try:
        feeder = DataFeeder('okx')
        df = feeder.get_local_data(req.symbol, req.timeframe)
        if df.empty:
             raise HTTPException(status_code=503, detail="Data is currently syncing in the background. Please try again.")

        best_pf, best_params = run_vectorbt_grid_search(
            df=df,
            fast_range=req.fast_ma_range,
            slow_range=req.slow_ma_range,
            initial_capital=req.initial_capital
        )
        
        csv_text = generate_tv_csv(best_pf, best_params, req.initial_capital)
        
        return Response(
            content=csv_text.encode("utf-8-sig"),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="VectorBT_Opt_{best_params["fast_ma"]}_{best_params["slow_ma"]}.csv"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
