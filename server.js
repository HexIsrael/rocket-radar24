const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Socket.IO Server
const pikud = require('pikud-haoref-api');

const app = express();
const server = http.createServer(app); // Create HTTP server from Express app
const io = new Server(server, { // Initialize Socket.IO with the HTTP server
  cors: {
    origin: "*", // Allow all origins for simplicity (adjust in production)
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL = 30000; // Still poll Pikud, but only emit on changes

let lastAlertHash = ''; // To prevent re-emitting the same alert

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/cities-il.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'cities-il.json'));
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`⚡ User connected: ${socket.id}`);
  // Optionally, send the last known alert to new connections
  // if (lastAlertHash) {
  //   socket.emit('alert', JSON.parse(lastAlertHash)); // Re-send the last alert state
  // }
  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
  });
});

// Polling Pikud HaOref API and emitting via WebSockets
function pollPikudAndEmit() {
  pikud.getActiveAlert((err, alert) => {
    if (err) {
      console.error('Error fetching alert from Pikud:', err);
      return;
    }

    // Stringify and hash to compare current alert state to the last one
    const currentAlertString = JSON.stringify(alert);

    // Only emit if the alert is different AND not a 'none' type
    if (currentAlertString !== lastAlertHash) {
      lastAlertHash = currentAlertString; // Update last alert
      const parsedAlert = JSON.parse(currentAlertString);

      // Only emit actual alerts (filter out 'type: none')
      if (parsedAlert && (!Array.isArray(parsedAlert) || parsedAlert.length === 0 || parsedAlert[0].type !== 'none')) {
        console.log('[Pikud Alert - Emitting via WS]', parsedAlert);
        io.emit('alert', parsedAlert); // Emit to all connected clients
      } else {
        // Handle explicit 'none' type from Pikud by clearing client map visuals
        // If Pikud returns an empty array or specific 'none' alert, clear client
        if (parsedAlert && Array.isArray(parsedAlert) && parsedAlert.length > 0 && parsedAlert[0].type === 'none') {
            console.log('[Pikud Alert - No active alerts, clearing client visuals]');
            io.emit('clear_map_visuals'); // Custom event to tell clients to clear their maps
        }
      }
    }
    setTimeout(pollPikudAndEmit, POLL_INTERVAL);
  });
}
pollPikudAndEmit(); // Start polling

// Serve an initial empty alert for clients connecting before the first real alert
app.get('/alert', (req, res) => {
  res.json([]); // No longer needed for real-time, but keep for compatibility or initial load if needed
});


server.listen(PORT, () => { // Listen on the HTTP server, not the Express app directly
  console.log(`🚨 Server running at http://localhost:${PORT}`);
});
