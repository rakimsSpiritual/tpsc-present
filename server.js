// server.js
const express = require('express');
const fs = require('fs');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fetch = require('node-fetch'); // npm i node-fetch@2

const app = express();

// HTTPS setup (optional - Render handles HTTPS automatically)
const options = {
  key: fs.existsSync('key.pem') ? fs.readFileSync('key.pem') : null,
  cert: fs.existsSync('cert.pem') ? fs.readFileSync('cert.pem') : null,
};

const server = options.key && options.cert
  ? https.createServer(options, app)
  : require('http').createServer(app);

// Get Render-specific info
const HOST = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: { 
    origin: [
      `https://${HOST}`,
      `https://tpsc-final.onrender.com`,
      "http://localhost:3000",
      "http://localhost:8080"
    ],
    methods: ['GET', 'POST'] 
  },
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// HBS setup
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => res.redirect('/sign'));
app.get('/sign', (req, res) => res.render('signin'));
app.get('/appHome', (req, res) => res.render('appHome'));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// TURN/STUN credentials route
app.get('/turn-credentials', async (req, res) => {
  try {
    // Replace these with your Xirsys credentials
    const username = process.env.XIRSYS_USERNAME || 'francis';
    const secret = process.env.XIRSYS_SECRET || '65a8fdb8-7da3-11f0-98a1-0242ac130003';
    const domain = process.env.XIRSYS_DOMAIN || 'global.xirsys.net';
    
    const url = `https://global.xirsys.net/_turn/${domain}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': 'Basic ' + Buffer.from(username + ':' + secret).toString('base64') },
    });

    const data = await response.json();
    res.json(data.v || { iceServers: [] });
  } catch (err) {
    console.error('Failed to fetch TURN credentials:', err);
    res.json({ iceServers: [] }); // fallback handled on client
  }
});

// Meetings store
const meetings = {};

io.on('connection', socket => {
  console.log('User connected:', socket.id);

  // Join meeting
  socket.on('joinMeeting', ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;

    if (!meetings[meetingID]) meetings[meetingID] = {};
    meetings[meetingID][userID] = socket.id;

    // Notify new participant about all existing participants
    const participantIDs = Object.keys(meetings[meetingID]).filter(id => id !== userID);
    socket.emit('newParticipant', participantIDs);

    // Notify existing participants about new user
    participantIDs.forEach(id => {
      io.to(meetings[meetingID][id]).emit('newParticipant', [userID]);
    });
  });

  // Forward WebRTC signals
  socket.on('signal', ({ from, to, data }) => {
    const targetSocketID = meetings[socket.meetingID]?.[to];
    if (targetSocketID) {
      io.to(targetSocketID).emit('signal', { from, data });
    }
  });

  // Chat messages
  socket.on('sendMessage', ({ meetingID, userID, msg }) => {
    io.to(meetingID).emit('receiveMessage', { userID, msg });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const { meetingID, userID } = socket;
    if (meetingID && meetings[meetingID] && userID) {
      delete meetings[meetingID][userID];
      io.to(meetingID).emit('participantLeft', { userID });
    }
    console.log('User disconnected:', socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`External URL: https://${HOST || 'localhost'}`);
});
