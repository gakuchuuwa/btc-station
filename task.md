# Task Tracker (BTC Quant Platform)

- `[/]` **Phase 1: Core Data & Backend Scaffolding**
  - `[x]` Setup Python environment (`requirements.txt`).
  - `[x]` Create FastAPI basic server structure.
  - `[x]` Implement `data_feeder.py` using CCXT to download BTC K-lines.
  - `[x]` Implement local K-line storage logic (CSV or SQLite).
  - `[x]` Expose `/api/data` endpoint.
- `[ ]` **Phase 2: The Backtesting Engine**
  - `[ ]` Integrate `vectorbt`.
  - `[ ]` Write base strategy logic.
  - `[ ]` Expose `/api/backtest` endpoint.
- `[ ]` **Phase 3: The Frontend Cockpit**
  - `[ ]` Scaffold React/Vite app.
  - `[ ]` Integrate TradingView Lightweight Charts.
  - `[ ]` Connect API and draw trades.
- `[ ]` **Phase 4: Hyperparameter Optimization**
- `[ ]` **Phase 5: Live Execution**
