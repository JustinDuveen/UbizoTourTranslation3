#!/bin/bash

# Complete Docker WebRTC Setup Script
set -e

echo "🚀 Setting up Ubizo WebRTC for Docker deployment"
echo "================================================"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose not found. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker environment detected"

# Check for required environment variables
echo "🔍 Checking environment configuration..."

if [ ! -f ".env.docker" ]; then
    echo "❌ .env.docker file not found!"
    echo "Please configure your Xirsys credentials:"
    echo ""
    echo "Required variables in .env.docker:"
    echo "  XIRSYS_CHANNEL=your-channel"
    echo "  XIRSYS_USERNAME=your-username"
    echo "  XIRSYS_API_KEY=your-api-key"
    echo "  JWT_SECRET=your-secure-jwt-secret"
    echo "  NEXTAUTH_SECRET=your-secure-nextauth-secret"
    echo ""
    exit 1
fi

# Validate critical environment variables
if ! grep -q "XIRSYS_CHANNEL=" .env.docker || ! grep -q "XIRSYS_USERNAME=" .env.docker || ! grep -q "XIRSYS_API_KEY=" .env.docker; then
    echo "⚠️  WARNING: Xirsys TURN/STUN server credentials not configured!"
    echo "   WebRTC connections may fail without proper TURN servers."
    echo "   Please update .env.docker with your Xirsys credentials."
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "✅ Environment configuration found"

# Clean up any existing containers
echo "🧹 Cleaning up existing containers..."
docker compose down 2>/dev/null || true

# Build containers
echo "📦 Building Docker containers..."
docker compose build

# Start services
echo "🚀 Starting services..."
docker compose up -d redis app

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
attempt=0
max_attempts=30

while [ $attempt -lt $max_attempts ]; do
    if docker compose exec app wget --quiet --tries=1 --spider http://localhost:3000/ 2>/dev/null; then
        echo "✅ Application is ready!"
        break
    fi
    
    attempt=$((attempt + 1))
    echo "   Attempt $attempt/$max_attempts - waiting 2 seconds..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "❌ Application failed to start properly"
    echo "Checking logs..."
    docker compose logs app
    exit 1
fi

# Run health checks
echo "🔍 Running health checks..."

# Test basic connectivity
if curl -f http://localhost:3000/ >/dev/null 2>&1; then
    echo "✅ HTTP server responding"
else
    echo "❌ HTTP server not responding"
    exit 1
fi

# Test WebSocket endpoint
if curl -f http://localhost:3000/socket.io/ >/dev/null 2>&1; then
    echo "✅ WebSocket endpoint available"
else
    echo "❌ WebSocket endpoint not available"
    exit 1
fi

# Test API endpoints
api_endpoints=("/api/session" "/api/auth/check" "/api/tour/languages")
for endpoint in "${api_endpoints[@]}"; do
    if curl -f "http://localhost:3000$endpoint" >/dev/null 2>&1; then
        echo "✅ API endpoint $endpoint responding"
    else
        echo "⚠️  API endpoint $endpoint returned error (may be expected for auth endpoints)"
    fi
done

echo ""
echo "🎉 Docker WebRTC setup complete!"
echo "================================"
echo ""
echo "📋 Next steps:"
echo "1. Open http://localhost:3000 in your browser"
echo "2. Register a guide account"  
echo "3. Register an attendee account"
echo "4. Test WebRTC connection between guide and attendee"
echo ""
echo "🔧 Debugging commands:"
echo "  View logs:     docker compose logs -f app"
echo "  Test health:   curl http://localhost:3000/"
echo "  Stop services: docker compose down"
echo ""
echo "⚠️  IMPORTANT: Ensure Xirsys credentials are configured in .env.docker"
echo "   for reliable WebRTC connections in production environments."
echo ""

# Optional: Run automated tests
read -p "Run automated WebRTC tests? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧪 Running automated tests..."
    if docker compose run --rm test-runner; then
        echo "✅ All tests passed!"
    else
        echo "❌ Some tests failed - check output above"
    fi
fi

echo "Setup complete! 🚀"