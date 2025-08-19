const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mediasoup = require("mediasoup");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static and HBS
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Routes
app.get("/", (req, res) => res.redirect("/sign"));
app.get("/sign", (req, res) => res.render("signin"));
app.get("/appHome", (req, res) => res.render("appHome"));

// --- Mediasoup setup ---
let worker;
let router;
const peers = {}; // socketId => { transports, producers, consumers }

(async () => {
  worker = await mediasoup.createWorker({ logLevel: "warn" });
  router = await worker.createRouter({ mediaCodecs: [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    { kind: "video", mimeType: "video/VP8", clockRate: 90000 }
  ]});
})();

// --- Socket.io ---
io.on("connection", socket => {
  peers[socket.id] = { transports: [], producers: [], consumers: [] };

  socket.on("joinMeeting", ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;
    // Inform about existing participants
    const participants = Array.from(socket.rooms)
      .flatMap(r => Array.from(io.sockets.adapter.rooms.get(r) || []))
      .filter(id => id !== socket.id);
    socket.emit("existingParticipants", participants);
    socket.to(meetingID).emit("userJoined", { userID: socket.id });
  });

  socket.on("createWebRtcTransport", async (_, callback) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
    peers[socket.id].transports.push(transport);
    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  socket.on("transport-connect", async ({ dtlsParameters, transportId }) => {
    const transport = peers[socket.id].transports.find(t => t.id === transportId);
    await transport.connect({ dtlsParameters });
  });

  socket.on("transport-produce", async ({ kind, rtpParameters, transportId }, callback) => {
    const transport = peers[socket.id].transports.find(t => t.id === transportId);
    const producer = await transport.produce({ kind, rtpParameters });
    peers[socket.id].producers.push(producer);

    // Notify others
    socket.broadcast.emit("new-producer", { producerId: producer.id, kind, userId: socket.id });
    callback({ id: producer.id });
  });

  socket.on("consume", async ({ producerId, transportId }, callback) => {
    const transport = peers[socket.id].transports.find(t => t.id === transportId);
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: router.rtpCapabilities,
      paused: false
    });
    peers[socket.id].consumers.push(consumer);
    callback({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  socket.on("sendMessage", ({ meetingID, user, message }) => {
    io.to(meetingID).emit("newMessage", { user, message });
  });

  socket.on("disconnect", () => {
    peers[socket.id]?.producers.forEach(p => p.close());
    peers[socket.id]?.consumers.forEach(c => c.close());
    peers[socket.id]?.transports.forEach(t => t.close());
    delete peers[socket.id];
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
