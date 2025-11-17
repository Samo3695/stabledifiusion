#!/bin/bash
set -e

echo "🚀 Starting Stable Diffusion Backend..."
echo "📂 Current directory: $(pwd)"
echo "📂 Files in /app:"
ls -la /app/

echo "📂 Files in /app/sd-backend:"
ls -la /app/sd-backend/ || echo "sd-backend directory not found!"

echo "🐍 Python version:"
python3 --version

echo "📦 Installed packages:"
pip list | grep -E "(torch|diffusers|transformers|flask)"

# Start the Flask server
echo "🌐 Starting Flask server on port 5000..."
cd /app/sd-backend
python3 app-lite.py 2>&1 | tee /tmp/flask.log

# If Flask exits, show the error
echo "❌ Flask exited with code $?"
cat /tmp/flask.log
tail -f /dev/null
