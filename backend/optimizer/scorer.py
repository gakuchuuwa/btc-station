def rank_results(results):
    """
    Ranks the optimization results using the quant-lab.org scoring logic.
    Utility Score: Combines net profit, win rate, and trade frequency.
    Robustness Score: Penalizes high drawdowns, favors stability.
    """
    if not results:
        return []

    # Find max values for normalization
    max_profit = max((r.get('net_profit_pct', 0) for r in results), default=1)
    max_profit = max(max_profit, 1) # prevent div by zero
    
    max_trades = max((r.get('total_trades', 0) for r in results), default=1)
    max_trades = max(max_trades, 1)

    for r in results:
        # Ignore failed or invalid runs
        if r.get('status') != 'ok':
            r['utility_score'] = 0
            r['robustness_score'] = 0
            r['combined_score'] = 0
            continue

        net_pct = r.get('net_profit_pct', 0)
        win_rate = r.get('win_rate_pct', 0)
        drawdown = abs(r.get('max_drawdown_pct', 0))
        trades = r.get('total_trades', 0)

        # 1. Utility Score Calculation
        # Assuming profit factor isn't explicitly calculated here, we use net_pct
        norm_profit = max(0, net_pct) / max_profit
        norm_win = win_rate / 100.0
        norm_trades = min(1.0, trades / max_trades)
        
        # Adjust weights (profit is king, then win rate, then activity)
        utility_score = (norm_profit * 0.5) + (norm_win * 0.3) + (norm_trades * 0.2)
        
        # 2. Robustness Score Calculation
        # High drawdown heavily penalizes robustness. 
        # For BTC, >30% DD is considered very risky for automated systems.
        dd_penalty = min(1.0, drawdown / 30.0) 
        robustness_score = 1.0 - dd_penalty
        
        # 3. Combined Score Calculation (quant-lab.org logic)
        # Utility holds slightly more weight than pure robustness
        combined_score = (utility_score * 0.6) + (robustness_score * 0.4)
        
        r['utility_score'] = round(utility_score * 100, 2)
        r['robustness_score'] = round(robustness_score * 100, 2)
        r['combined_score'] = round(combined_score * 100, 2)

    # Sort descending by combined_score
    ranked = sorted(results, key=lambda x: x.get('combined_score', 0), reverse=True)
    return ranked
