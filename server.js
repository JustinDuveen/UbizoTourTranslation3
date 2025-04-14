// Custom Next.js server with filtered logging
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Store the original console.log function
const originalConsoleLog = console.log;

// Override console.log to filter out specific logs
console.log = function(...args) {
  // Check if this is a log message for GET /api/tour/answer
  const logMessage = args.join(' ');
  if (typeof logMessage === 'string' && 
      (logMessage.includes('GET /api/tour/answer') || 
       logMessage.match(/- GET \/api\/tour\/answer\?/))) {
    // Skip logging this message
    return;
  }
  
  // Log all other messages normally
  originalConsoleLog.apply(console, args);
};

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');
  });
});
