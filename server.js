const express = require('express');
const fs = require('fs');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fetch = require('node-fetch'); // Needed to call Xirsys API

const app = express();

// HTTPS setup (optional)
const options = {
  key: fs.existsSync('key.pem') ? fs.readFileSync('key.pem') : null,
  cert: fs.existsSync('cert.pem') ? fs.readFileSync('cert.pem') : null,
};

const server = options.key && options.cert
  ? https.createServer(options, app)
  : require('http').createServer(app);

// Render host info
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
    methods: ['GET','POST']
  },
});

// Serve static files
app.use(express.static(path.join(__dirname,'public')));

// HBS setup
app.set('view engine','hbs');
app.set('views',path.join(__dirname,'views'));

// Routes
app.get('/', (req,res) => res.redirect('/sign'));
app.get('/sign', (req,res) => res.render('signin'));
app.get('/appHome', (req,res) => res.render('appHome'));

// Health check
app.get('/health', (req,res) => res.status(200).json({ status:'OK', timestamp: new Date().toISOString() }));

// Meetings store
const meetings = {};

// Socket.io handling
io.on('connection', socket => {
  console.log('User connected:', socket.id);

  socket.on('joinMeeting', ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;

    if(!meetings[meetingID]) meetings[meetingID] = {};
    meetings[meetingID][userID] = socket.id;

    const participantIDs = Object.keys(meetings[meetingID]).filter(id => id !== userID);
    socket.emit('newParticipant', participantIDs);

    participantIDs.forEach(id => {
      io.to(meetings[meetingID][id]).emit('newParticipant', [userID]);
    });
  });

  socket.on('signal', ({ from, to, data }) => {
    const targetSocketID = meetings[socket.meetingID]?.[to];
    if(targetSocketID){
      io.to(targetSocketID).emit('signal',{ from, data });
    }
  });

  socket.on('sendMessage', ({ meetingID, userID, msg }) => {
    io.to(meetingID).emit('receiveMessage',{ userID, msg });
  });

  socket.on('disconnect', () => {
    const { meetingID, userID } = socket;
    if(meetingID && meetings[meetingID] && userID){
      delete meetings[meetingID][userID];
      io.to(meetingID).emit('participantLeft',{ userID });
    }
    console.log('User disconnected:', socket.id);
  });
});

// --- Xirsys ICE server endpoint ---
app.get('/turn-credentials', async (req,res) => {
  try {
    const apiUrl = `https://global.xirsys.net/_turn/Tpsc33`;
    const params = new URLSearchParams({
      ident: 'francis',
      secret: '65a8fdb8-7da3-11f0-98a1-0242ac130003',
      format: 'json'
    });
    
    const response = await fetch(`${apiUrl}?${params.toString()}`);
    const data = await response.json();

    if(data.v && data.v.iceServers){
      res.json({ iceServers: data.v.iceServers });
    } else {
      throw new Error('No ICE servers from API');
    }
  } catch(err){
    console.error('Failed to fetch ICE servers:', err);
    // Fallback: use hardcoded Xirsys servers
    res.json({
      iceServers: [
        { urls: [ "stun:jb-turn1.xirsys.com" ] },
        {
          username: "ydzCFyiUOl504sLLeswqK7d8MLZwCHOLFDOTJQg2nKg6x5madjZEkJYzy0n72UjQAAAAAGilmwBmcmFuY2lz",
          credential: "776888d6-7dab-11f0-89de-0242ac120004",
          urls: [
            "turn:jb-turn1.xirsys.com:80?transport=udp",
            "turn:jb-turn1.xirsys.com:3478?transport=udp",
            "turn:jb-turn1.xirsys.com:80?transport=tcp",
            "turn:jb-turn1.xirsys.com:3478?transport=tcp",
            "turns:jb-turn1.xirsys.com:443?transport=tcp",
            "turns:jb-turn1.xirsys.com:5349?transport=tcp"
          ]
        }
      ]
    });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`External URL: https://${HOST || 'localhost'}`);
});
