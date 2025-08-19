// server.js
const express = require("express");
const fs = require("fs");
const https = require("https");
const { Server } = require("socket.io");
const path = require("path");
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

// Static files
app.use(express.static(path.join(__dirname, "public")));

// HBS setup
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Routes
app.get("/", (req,res)=>res.redirect("/sign"));
app.get("/sign", (req,res)=>res.render("signin"));
app.get("/appHome", (req,res)=>res.render("appHome"));

// Meetings storage
const meetings = {}; // { meetingID: { socketID: userID } }

// Mediasoup
let worker;
(async () => { worker = await mediasoup.createWorker(); })();
const rooms = {}; // { meetingID: { router, transports, producers } }

// Socket.IO
io.on("connection", socket => {
  console.log("User connected:", socket.id);

  // Join meeting
  socket.on("joinMeeting", async ({meetingID, userID}) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;

    if(!meetings[meetingID]) meetings[meetingID]={};
    meetings[meetingID][socket.id] = userID;

    // Mediasoup router for meeting
    if(!rooms[meetingID]){
      const router = await worker.createRouter({ mediaCodecs:[{
        kind:"audio",
        mimeType:"audio/opus",
        clockRate:48000,
        channels:2
      },{
        kind:"video",
        mimeType:"video/VP8",
        clockRate:90000,
        parameters:{}
      }]});
      rooms[meetingID] = { router, transports:{}, producers:{} };
    }

    io.to(meetingID).emit("newParticipant",{participants:Object.values(meetings[meetingID]), userID, socketID: socket.id});
  });

  // Mediasoup: create transport
  socket.on("createTransport", async (_, callback) => {
    const room = rooms[socket.meetingID];
    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    room.transports[socket.id] = transport;
    callback({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      rtpCapabilities: room.router.rtpCapabilities
    });
  });

  // Mediasoup: connect transport
  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    const room = rooms[socket.meetingID];
    const transport = room.transports[socket.id];
    await transport.connect({ dtlsParameters });
  });

  // Mediasoup: produce
  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    const room = rooms[socket.meetingID];
    const transport = room.transports[socket.id];
    const producer = await transport.produce({ kind, rtpParameters });
    room.producers[socket.id] = room.producers[socket.id] || [];
    room.producers[socket.id].push(producer);

    // Notify all other clients to consume
    socket.to(socket.meetingID).emit("newProducer",{ producerId: producer.id, producerSocketId: socket.id, kind });
    callback({ id: producer.id });
  });

  // Mediasoup: consume
  socket.on("consume", async ({ producerId }, callback) => {
    const room = rooms[socket.meetingID];
    const router = room.router;
    const transport = room.transports[socket.id];
    const producerOwner = Object.values(room.producers).flat().find(p=>p.id===producerId);
    if(!producerOwner) return;

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: router.rtpCapabilities,
      paused:false
    });
    callback({ id: consumer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
  });

  // Chat
  socket.on("sendMessage", ({meetingID, userID, msg}) => {
    io.to(meetingID).emit("receiveMessage",{ userID, msg });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const { meetingID, userID } = socket;
    if(meetingID && meetings[meetingID]){
      delete meetings[meetingID][socket.id];
      io.to(meetingID).emit("participantLeft",{ userID, socketID: socket.id });
    }
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
