const express = require("express");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();

// HTTPS optional
const options = {
  key: fs.existsSync("key.pem") ? fs.readFileSync("key.pem") : null,
  cert: fs.existsSync("cert.pem") ? fs.readFileSync("cert.pem") : null,
};
const server = options.key && options.cert
  ? https.createServer(options, app)
  : require("http").createServer(app);

const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

// Serve static files
app.use(express.static(path.join(__dirname,"public")));

// HBS setup
app.set("view engine","hbs");
app.set("views", path.join(__dirname,"views"));

// Routes
app.get("/", (req,res)=>res.redirect("/sign"));
app.get("/sign", (req,res)=>res.render("signin"));
app.get("/appHome", (req,res)=>res.render("appHome"));

// --- Mediasoup setup ---
let worker;
let router;
let peers = {}; // {socketId: { transports:[], producers:[] }}

(async () => {
  worker = await mediasoup.createWorker({ logLevel:"warn" });
  router = await worker.createRouter({ mediaCodecs:[
    { kind:"audio", mimeType:"audio/opus", clockRate:48000, channels:2 },
    { kind:"video", mimeType:"video/VP8", clockRate:90000 }
  ]});
})();

// Socket.IO signaling
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("joinMeeting", async ({meetingID, userID}) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;
    if(!peers[socket.id]) peers[socket.id] = { transports:[], producers:[], userID };
    
    const otherPeers = Object.values(peers).filter(p=>p.userID!==userID).map(p=>p.userID);
    socket.emit("existingParticipants", otherPeers);
    socket.to(meetingID).emit("userJoined", { userID });
  });

  socket.on("getRouterRtpCapabilities", (_, callback) => {
    callback(router.rtpCapabilities);
  });

  socket.on("createTransport", async (_, callback) => {
    const transport = await router.createWebRtcTransport({
      listenIps:[{ ip:"0.0.0.0", announcedIp: null }],
      enableUdp:true, enableTcp:true, preferUdp:true
    });
    peers[socket.id].transports.push(transport);
    callback({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    const transport = peers[socket.id].transports.find(t=>t.id===transportId);
    await transport.connect({ dtlsParameters });
  });

  socket.on("produce", async ({ transportId, kind, rtpParameters }, callback) => {
    const transport = peers[socket.id].transports.find(t=>t.id===transportId);
    const producer = await transport.produce({ kind, rtpParameters });
    peers[socket.id].producers.push(producer);

    // Inform all others
    socket.to(socket.meetingID).emit("newProducer", { producerId: producer.id, userID: peers[socket.id].userID, kind });
    callback({ id: producer.id });
  });

  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    if(!router.canConsume({ producerId, rtpCapabilities })) return;
    const transport = peers[socket.id].transports[0]; // first transport
    const consumer = await transport.consume({ producerId, rtpCapabilities, paused:false });
    callback({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
  });

  // Chat messages
  socket.on("sendMessage", ({meetingID, userID, msg}) => {
    io.to(meetingID).emit("receiveMessage", { userID, msg });
  });

  // Disconnect
  socket.on("disconnect", ()=> {
    const p = peers[socket.id];
    if(p){
      p.producers.forEach(prod=>prod.close());
      p.transports.forEach(t=>t.close());
      delete peers[socket.id];
      io.to(p.meetingID).emit("participantLeft", { userID: p.userID });
    }
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
