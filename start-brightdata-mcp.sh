#!/bin/bash
# Start BrightData MCP Server

echo "🚀 Starting BrightData MCP Server..."
echo "=================================="

# Set environment variables
export API_TOKEN=ea009aaf-cd12-41f3-a589-abbd8c7ba95b
export WEB_UNLOCKER_ZONE=scraping_browser1
export BROWSER_ZONE=scraping_browser1

echo "✅ Environment configured:"
echo "   API_TOKEN: ${API_TOKEN:0:8}..."
echo "   WEB_UNLOCKER_ZONE: $WEB_UNLOCKER_ZONE"
echo "   BROWSER_ZONE: $BROWSER_ZONE"
echo ""

echo "🌐 Starting MCP server..."
npx @brightdata/mcp