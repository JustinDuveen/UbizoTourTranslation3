// Custom Next.js server with Socket.IO support and filtered logging
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const os = require('os');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Store the original console.log function
const originalConsoleLog = console.log;

// Override console.log to filter out noisy development logs
console.log = function(...args) {
  const logMessage = args.join(' ');
  if (typeof logMessage === 'string') {
    // Filter out frequent polling endpoints to reduce noise
    const noisyPatterns = [
      'GET /api/tour/answer',
      'GET /api/tour/guide-ice',
      '⏳ No new guide candidates',
      '🔍 GUIDE-ICE RETRIEVAL',
      '🔍 Total candidates in Redis',
      '🔍 Redis key:',
      'Redis client connected', // Reduce Redis connection spam
      'Redis client connected successfully'
    ];

    if (noisyPatterns.some(pattern => logMessage.includes(pattern))) {
      return; // Skip logging these messages
    }
  }

  // Log all other messages normally
  originalConsoleLog.apply(console, args);
};

// Function to get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Get CORS origins from environment or use development defaults
  const getCorsOrigins = () => {
    if (process.env.CORS_ORIGINS) {
      return process.env.CORS_ORIGINS.split(',');
    }
    return dev ? ["http://localhost:3000", "http://0.0.0.0:3000", `http://${getLocalIP()}:3000`] : ["http://localhost:3000"];
  };

  // Initialize Socket.IO for WebRTC signaling
  const io = new Server(server, {
    path: '/socket.io/',
    cors: {
      origin: getCorsOrigins(),
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true  // Backward compatibility
  });

  // Socket.IO connection handling for WebRTC signaling
  io.on('connection', (socket) => {
    console.log('🔗 New Socket.IO connection attempt:', socket.id);
    console.log('🔗 Connection auth data:', socket.handshake.auth);
    
    const { tourId, language, role, attendeeId } = socket.handshake.auth;
    
    if (!tourId || !language || !role) {
      console.error('❌ Invalid auth data for socket connection:', socket.handshake.auth);
      socket.disconnect();
      return;
    }

    const clientId = `${role}:${language}:${attendeeId || 'guide'}`;
    console.log(`✅ [${language}] ${role} connected to signaling server (${clientId}) - Socket ID: ${socket.id}`);

    // Both guide and attendee now use tourCode directly, so no normalization needed
    // Join room for this tour and language
    const room = `tour:${tourId}:${language}`;
    socket.join(room);
    console.log(`📋 [${language}] ${role} joined room: ${room}`);

    // Handle ICE candidate exchange
    socket.on('ice-candidate', async (message) => {
      try {
        console.log(`[${language}] Relaying ICE candidate from ${message.sender}${message.attendeeId ? ` (${message.attendeeId})` : ''}`);
        socket.to(room).emit('ice-candidate', message);
      } catch (error) {
        console.error(`[${language}] Error handling ICE candidate:`, error);
        socket.emit('error', { message: 'Failed to relay ICE candidate' });
      }
    });

    // Handle offer exchange
    socket.on('offer', async (message) => {
      try {
        console.log(`[${language}] Relaying offer from ${message.sender}${message.attendeeId ? ` (${message.attendeeId})` : ''}`);
        socket.to(room).emit('offer', message);
      } catch (error) {
        console.error(`[${language}] Error handling offer:`, error);
        socket.emit('error', { message: 'Failed to relay offer' });
      }
    });

    // Handle answer exchange
    socket.on('answer', async (message) => {
      try {
        console.log(`[${language}] Relaying answer from ${message.sender}${message.attendeeId ? ` (${message.attendeeId})` : ''}`);
        socket.to(room).emit('answer', message);
      } catch (error) {
        console.error(`[${language}] Error handling answer:`, error);
        socket.emit('error', { message: 'Failed to relay answer' });
      }
    });

    // LEGACY: ICE server coordination (removed - both guide and attendee use static configuration)
    // No longer needed since both use static jb-turn1.xirsys.com configuration

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`[${language}] ${role} disconnected from signaling server: ${reason}`);
      socket.to(room).emit('peer-disconnected', {
        role,
        attendeeId,
        language,
        tourId,
        timestamp: Date.now()
      });
    });

    // Send connection confirmation
    socket.emit('connected', {
      message: 'Connected to signaling server',
      room,
      role,
      language,
      tourId,
      timestamp: Date.now()
    });
  });

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  
  server.listen(port, host, (err) => {
    if (err) throw err;
    const localIP = getLocalIP();
    console.log(`> Ready on http://localhost:${port}`);
    console.log(`> Network access available at http://${localIP}:${port}`);
    console.log('> Share this URL with devices on your network to allow them to join as attendees');
    console.log('> 🚀 WebSocket signaling server initialized at /socket.io/');
    console.log(`> 📡 Socket.IO server ready for WebRTC signaling on all interfaces`);
  });
});
