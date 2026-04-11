#!/bin/sh
set -e

echo "🚀 Starting BizTrix Frontend (Nginx)..."
echo "📝 Checking Nginx configuration..."

# Test nginx config
if ! nginx -t; then
    echo "❌ Nginx config test failed!"
    exit 1
fi

echo "✅ Nginx config is valid"
echo "📁 Checking dist folder..."

# Check if dist folder exists
if [ ! -d "/usr/share/nginx/html" ]; then
    echo "❌ ERROR: /usr/share/nginx/html directory not found!"
    ls -la /usr/share/nginx/
    exit 1
fi

# Check if index.html exists
if [ ! -f "/usr/share/nginx/html/index.html" ]; then
    echo "❌ ERROR: /usr/share/nginx/html/index.html not found!"
    echo "📂 Contents of /usr/share/nginx/html:"
    ls -la /usr/share/nginx/html/
    exit 1
fi

echo "✅ React build files found"
echo "📊 Folder structure:"
ls -lah /usr/share/nginx/html/ | head -10

echo "🟢 All checks passed! Starting Nginx..."
exec nginx -g "daemon off;"
