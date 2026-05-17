FROM python:3.11-slim

# System dependencies for numpy/pandas/vectorbt compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cache-friendly)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy all backend code
COPY . /app

# Create necessary directories
RUN mkdir -p /data/historical /data/users

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
