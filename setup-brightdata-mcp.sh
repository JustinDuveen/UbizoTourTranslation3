#!/bin/bash
# BrightData MCP Setup Script

echo "BrightData MCP Setup"
echo "==================="

# Check if API token is provided
if [ -z "$1" ]; then
    echo "Usage: ./setup-brightdata-mcp.sh YOUR_API_TOKEN"
    echo ""
    echo "To get your API token:"
    echo "1. Go to brightdata.com"  
    echo "2. Login to your account"
    echo "3. Go to Account Settings > API"
    echo "4. Copy your API token"
    echo ""
    exit 1
fi

API_TOKEN=$1

# Update .env file
echo "Updating .env.brightdata with your API token..."
cat > .env.brightdata << EOF
# BrightData MCP Configuration
API_TOKEN=$API_TOKEN
WEB_UNLOCKER_ZONE=scraping_browser1
BROWSER_ZONE=scraping_browser1
BRIGHTDATA_CUSTOMER_ID=hl_5fc0ca7e
EOF

# Test the configuration
echo "Testing BrightData MCP server..."
source .env.brightdata
API_TOKEN=$API_TOKEN WEB_UNLOCKER_ZONE=$WEB_UNLOCKER_ZONE BROWSER_ZONE=$BROWSER_ZONE npx @brightdata/mcp --version

echo ""
echo "Setup complete! To start the MCP server:"
echo "source .env.brightdata && API_TOKEN=\$API_TOKEN npx @brightdata/mcp"