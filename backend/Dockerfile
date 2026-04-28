FROM freqtradeorg/freqtrade:stable

# Switch to root to install our custom backend dependencies
USER root

# Create the working directory for the backend API
WORKDIR /app

# Install our required Python packages
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy all the FastAPI backend code
COPY . /app

# Create necessary directories and set ownership to ftuser
RUN mkdir -p /data/historical /data/users /app/user_data/strategies /app/user_data/data && \
    chown -R ftuser:ftuser /app /data/historical /data/users

# Switch back to the unprivileged freqtrade user
USER ftuser

# Expose FastAPI default port
EXPOSE 8000

# CRITICAL: Clear the Freqtrade ENTRYPOINT so we can run uvicorn directly
ENTRYPOINT []

# Start command
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
