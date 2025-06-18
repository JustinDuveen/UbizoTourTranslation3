// Test script to help identify the correct BrightData API configuration
console.log('BrightData Configuration Test');
console.log('============================');

// From your Browser API credentials:
const browserCredentials = {
  customer: 'hl_5fc0ca7e',
  zone: 'scraping_browser1', 
  password: 'dsazpptv3z30',
  endpoint_wss: 'wss://brd-customer-hl_5fc0ca7e-zone-scraping_browser1:dsazpptv3z30@brd.superproxy.io:9222',
  endpoint_http: 'https://brd-customer-hl_5fc0ca7e-zone-scraping_browser1:dsazpptv3z30@brd.superproxy.io:9515'
};

console.log('Browser API Credentials:', browserCredentials);

// For MCP, you might need to:
// 1. Use the full credential string as API_TOKEN
// 2. Or get a separate API token from brightdata.com account settings

const possibleTokens = [
  'dsazpptv3z30', // Just the password
  'hl_5fc0ca7e:dsazpptv3z30', // customer:password
  'brd-customer-hl_5fc0ca7e-zone-scraping_browser1:dsazpptv3z30' // Full credential string
];

console.log('\nPossible API_TOKEN formats to try:');
possibleTokens.forEach((token, i) => {
  console.log(`${i + 1}. ${token}`);
});

console.log('\nNext steps:');
console.log('1. Try each token format above with the MCP server');
console.log('2. Or get the actual API token from brightdata.com > Account Settings > API');