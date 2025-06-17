#!/bin/bash

# WebRTC Testing Script for Ubizo Tour Translator
# This script sets up and runs WebRTC connectivity tests

set -e  # Exit on any error

echo "🚀 Starting Ubizo WebRTC Test Suite"
echo "=================================="

# Check if Docker is available
if command -v docker &> /dev/null; then
    echo "✅ Docker found - using containerized testing"
    
    # Build containers
    echo "📦 Building Docker containers..."
    docker compose build
    
    # Start services
    echo "🔄 Starting services..."
    docker compose up -d redis app
    
    # Wait for services to be healthy
    echo "⏳ Waiting for services to be ready..."
    docker compose exec app sh -c 'until curl -f http://localhost:3000/api/health; do sleep 2; done'
    
    # Run tests
    echo "🧪 Running WebRTC tests..."
    docker compose run --rm test-runner
    
    # Cleanup
    echo "🧹 Cleaning up..."
    docker compose down
    
else
    echo "⚠️  Docker not found - using local testing"
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    npm install
    
    # Start Redis (if available)
    if command -v redis-server &> /dev/null; then
        echo "🔄 Starting Redis..."
        redis-server --daemonize yes
    else
        echo "⚠️  Redis not found - some tests may fail"
    fi
    
    # Build the application
    echo "🔨 Building application..."
    npm run build
    
    # Start the application in background
    echo "🚀 Starting application..."
    npm start &
    APP_PID=$!
    
    # Wait for application to start
    echo "⏳ Waiting for application to be ready..."
    sleep 10
    
    # Run tests
    echo "🧪 Running WebRTC tests..."
    node test-webrtc.js
    
    # Cleanup
    echo "🧹 Cleaning up..."
    kill $APP_PID 2>/dev/null || true
    pkill redis-server 2>/dev/null || true
fi

echo ""
echo "✅ Test suite completed!"
echo "📊 Check test-results/ directory for detailed results"