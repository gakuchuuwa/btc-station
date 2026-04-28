from fastapi.responses import JSONResponse
try:
    JSONResponse(content={"val": float('nan')}).render({"val": float('nan')})
    print("SUCCESS")
except Exception as e:
    print("ERROR:", repr(e))
