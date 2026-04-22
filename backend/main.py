from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from data_feeder import DataFeeder
import json

app = FastAPI(title="BTC Private Quant API")

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

feeder = DataFeeder('binance')

@app.get("/")
def read_root():
    return {"status": "ok", "message": "BTC Quant Platform Backend is running."}

@app.get("/api/data")
def get_k_lines(symbol: str = 'BTC/USDT', timeframe: str = '1h', limit: int = 500):
    """
    Endpoint to fetch K-lines. It first tries to download fresh data.
    """
    try:
        # Fetch fresh data (in production you might want to async update or check cache age)
        df = feeder.fetch_ohlcv(symbol, timeframe, limit=limit)
        
        # Convert DataFrame to JSON serializable dictionary
        # Format required by typical charting libraries: list of dicts
        records = df.to_dict(orient='records')
        # Ensure timestamp is string for JSON
        for r in records:
            r['timestamp'] = str(r['timestamp'])
            
        return {"symbol": symbol, "timeframe": timeframe, "data": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == '__main__':
    import uvicorn
    # Run the server on port 8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
