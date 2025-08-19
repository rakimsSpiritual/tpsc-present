// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => res.redirect('/sign'));
app.get('/sign', (req, res) => res.render('signin'));
app.get('/appHome', (req, res) => res.render('appHome'));

// In-memory stores
const meetings = {}; // meetingID -> { sockets: { socketId: userID } }
const rooms = {};    // meetingID -> { router, peers: { socketId: { transports: [], producers: [], consumers: [] } } }

let worker;
(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  });
  worker.on('died', () => {
    console.error('mediasoup worker died, exiting');
    process.exit(1);
  });
  console.log('mediasoup worker created');
})();

// Helper: ensure room exists
async function ensureRoom(meetingID) {
  if (rooms[meetingID]) return rooms[meetingID];
  const router = await worker.createRouter({
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }
    ]
  });
  rooms[meetingID] = { router, peers: {} };
  return rooms[meetingID];
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('joinMeeting', async ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.meetingID = meetingID;
    socket.userID = userID;

    if (!meetings[meetingID]) meetings[meetingID] = { sockets: {} };
    meetings[meetingID].sockets[socket.id] = userID;

    const room = await ensureRoom(meetingID);
    room.peers[socket.id] = room.peers[socket.id] || { transports: [], producers: [], consumers: [] };

    // Notify participants list
    io.to(meetingID).emit('newParticipant', {
      participants: Object.values(meetings[meetingID].sockets),
      userID,
      socketID: socket.id
    });

    // Send existing producers for new joiner
    const existing = [];
    for (const [peerId, peer] of Object.entries(room.peers)) {
      if (peer.producers && peer.producers.length) {
        for (const p of peer.producers) existing.push({ producerId: p.id, producerSocketId: peerId, kind: p.kind });
      }
    }
    socket.emit('existingProducers', existing);
  });

  socket.on('getRouterRtpCapabilities', (data, callback) => {
    const meetingID = socket.meetingID;
    if (!meetingID || !rooms[meetingID]) return callback(null);
    callback(rooms[meetingID].router.rtpCapabilities);
  });

  socket.on('createTransport', async (data, callback) => {
    const meetingID = socket.meetingID;
    if (!meetingID) return callback(null);
    const room = await ensureRoom(meetingID);
    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
    room.peers[socket.id].transports.push(transport);
    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    const meetingID = socket.meetingID;
    if (!meetingID) return callback({ error: 'no-meeting' });
    const peer = rooms[meetingID].peers[socket.id];
    if (!peer) return callback({ error: 'no-peer' });
    const transport = peer.transports.find(t => t.id === transportId);
    if (!transport) return callback({ error: 'no-transport' });
    await transport.connect({ dtlsParameters });
    callback({ connected: true });
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    const meetingID = socket.meetingID;
    if (!meetingID) return callback({ error: 'no-meeting' });
    const peer = rooms[meetingID].peers[socket.id];
    const transport = peer.transports.find(t => t.id === transportId);
    if (!transport) return callback({ error: 'no-transport' });

    const producer = await transport.produce({ kind, rtpParameters });
    peer.producers.push(producer);

    // Notify others in meeting about new producer
    socket.to(meetingID).emit('newProducer', { producerId: producer.id, producerSocketId: socket.id, kind });
    callback({ id: producer.id });
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
    const meetingID = socket.meetingID;
    if (!meetingID) return callback({ error: 'no-meeting' });
    const room = rooms[meetingID];
    if (!room) return callback({ error: 'no-room' });
    const router = room.router;

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return callback({ error: 'cannot-consume' });
    }

    const peer = room.peers[socket.id];
    const transport = peer.transports.find(t => t.id === transportId);
    if (!transport) return callback({ error: 'no-transport' });

    // locate producer object (server-side)
    let foundProducer = null;
    for (const [peerId, p] of Object.entries(room.peers)) {
      for (const prod of (p.producers || [])) {
        if (prod.id === producerId) {
          foundProducer = prod;
          break;
        }
      }
      if (foundProducer) break;
    }
    if (!foundProducer) return callback({ error: 'producer-not-found' });

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    peer.consumers = peer.consumers || [];
    peer.consumers.push(consumer);

    callback({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  // helper: return list of producers for meeting
  socket.on('getProducers', (data, callback) => {
    const meetingID = socket.meetingID;
    if (!meetingID || !rooms[meetingID]) return callback([]);
    const list = [];
    for (const [peerId, p] of Object.entries(rooms[meetingID].peers)) {
      for (const prod of (p.producers || [])) {
        list.push({ producerId: prod.id, producerSocketId: peerId, kind: prod.kind });
      }
    }
    callback(list);
  });

  socket.on('sendMessage', ({ meetingID, user, message }) => {
    const mID = meetingID || socket.meetingID;
    if (!mID) return;
    io.to(mID).emit('receiveMessage', { user, message });
  });

  socket.on('disconnect', () => {
    const meetingID = socket.meetingID;
    const userID = socket.userID;
    if (meetingID && meetings[meetingID]) {
      delete meetings[meetingID].sockets[socket.id];
      // cleanup mediasoup objects for this peer
      const peer = rooms[meetingID] && rooms[meetingID].peers[socket.id];
      if (peer) {
        if (peer.producers) peer.producers.forEach(p => p.close());
        if (peer.consumers) peer.consumers.forEach(c => c.close());
        if (peer.transports) peer.transports.forEach(t => t.close());
        delete rooms[meetingID].peers[socket.id];
      }
      io.to(meetingID).emit('participantLeft', { userID, socketID: socket.id });
    }
    console.log('socket disconnected', socket.id);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
