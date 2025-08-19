// server.js
const express = require("express");
const fs = require("fs");
const https = require("https");
const { Server } = require("socket.io");
const path = require("path");
const mediasoup = require("mediasoup");

const app = express();

// HTTPS setup (optional)
const options = {
  key: fs.existsSync("key.pem") ? fs.readFileSync("key.pem") : null,
  cert: fs.existsSync("cert.pem") ? fs.readFileSync("cert.pem") : null,
};

const server = options.key && options.cert
  ? https.createServer(options, app)
  : require("http").createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Static files and HBS setup
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.get("/", (req, res) => res.redirect("/sign"));
app.get("/sign", (req, res) => res.render("signin"));
app.get("/appHome", (req, res) => res.render("appHome"));

// Meetings and mediasoup rooms
const meetings = {}; // { meetingID: { socketID: userID } }
const rooms = {};    // { meetingID: { router, peers: { socketID: { sendTransport, recvTransport, producers, consumers } } } }

let worker;

// Create Mediasoup worker
async function createWorker() {
  worker = await mediasoup.createWorker({ rtcMinPort: 40000, rtcMaxPort: 49999 });
  worker.on("died", () => {
    console.error("Mediasoup worker died, exiting...");
    process.exit(1);
  });
  console.log("Mediasoup worker created");
}
createWorker();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins meeting
  socket.on("joinMeeting", async ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;

    if (!meetings[meetingID]) meetings[meetingID] = {};
    meetings[meetingID][socket.id] = userID;

    io.to(meetingID).emit("newParticipant", {
      participants: Object.values(meetings[meetingID]),
      userID,
      socketID: socket.id
    });

    if (!rooms[meetingID]) {
      const router = await worker.createRouter({ mediaCodecs: [
        { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
        { kind: "video", mimeType: "video/VP8", clockRate: 90000 }
      ]});
      rooms[meetingID] = { router, peers: {} };
    }

    rooms[meetingID].peers[socket.id] = {
      sendTransport: null,
      recvTransport: null,
      producers: [],
      consumers: []
    };

    socket.emit("mediasoupRouterRtpCapabilities", rooms[meetingID].router.rtpCapabilities);
  });

  // Create WebRTC transport
  socket.on("createWebRtcTransport", async (_, callback) => {
    const room = rooms[socket.meetingID];
    if (!room) return;

    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    room.peers[socket.id].sendTransport = transport;
    room.peers[socket.id].recvTransport = transport; // simple setup

    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  // Connect transport
  socket.on("connectTransport", async ({ dtlsParameters }, callback) => {
    const room = rooms[socket.meetingID];
    const transport = room.peers[socket.id].sendTransport;
    await transport.connect({ dtlsParameters });
    callback();
  });

  // Produce track
  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    const room = rooms[socket.meetingID];
    const transport = room.peers[socket.id].sendTransport;
    const producer = await transport.produce({ kind, rtpParameters });
    room.peers[socket.id].producers.push(producer);

    // Notify all other clients to consume this producer
    for (const [peerId, peer] of Object.entries(room.peers)) {
      if (peerId !== socket.id) {
        io.to(peerId).emit("newProducer", { producerId: producer.id, kind });
      }
    }

    callback({ id: producer.id });
  });

  // Consume track
  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    const room = rooms[socket.meetingID];
    const router = room.router;

    if (!router.canConsume({ producerId, rtpCapabilities })) return;

    const transport = room.peers[socket.id].recvTransport;
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    room.peers[socket.id].consumers.push(consumer);

    callback({
      producerId,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  // Chat
  socket.on("sendMessage", ({ meetingID, userID, msg }) => {
    io.to(meetingID).emit("receiveMessage", { userID, msg });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const { meetingID, userID } = socket;
    if (meetingID && meetings[meetingID]) {
      delete meetings[meetingID][socket.id];
      io.to(meetingID).emit("participantLeft", { userID, socketID: socket.id });
    }

    if (meetingID && rooms[meetingID]) {
      delete rooms[meetingID].peers[socket.id];
    }

    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
