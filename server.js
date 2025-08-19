const express = require("express");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();

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

// HBS
app.set("view engine","hbs");
app.set("views", path.join(__dirname,"views"));

// Routes
app.get("/", (req,res)=>res.redirect("/sign"));
app.get("/sign", (req,res)=>res.render("signin"));
app.get("/appHome", (req,res)=>res.render("appHome"));

// Store meetings
const meetings = {};

// Mediasoup server
let worker;
(async () => {
    worker = await mediasoup.createWorker();
    console.log("Mediasoup worker started");
})();

// Meeting rooms store
const rooms = {};

io.on("connection", socket => {
    console.log("User connected:", socket.id);

    socket.on("joinMeeting", async ({ meetingID, userID }) => {
        socket.userID = userID;
        socket.meetingID = meetingID;

        socket.join(meetingID);
        if(!rooms[meetingID]){
            rooms[meetingID] = { peers: {}, router: await worker.createRouter({ mediaCodecs: [{
                kind: "audio",
                mimeType: "audio/opus",
                clockRate: 48000,
                channels: 2
            },{
                kind:"video",
                mimeType:"video/VP8",
                clockRate:90000
            }]}) };
        }

        rooms[meetingID].peers[socket.id] = { socket, transports: [], producers: [] };

        // Inform everyone
        io.to(meetingID).emit("newParticipant", { participants: Object.values(rooms[meetingID].peers).map(p=>p.socket.userID), userID });
    });

    // Mediasoup signaling
    socket.on("createTransport", async (_, callback) => {
        const room = rooms[socket.meetingID];
        const transport = await room.router.createWebRtcTransport({ listenIps: ["127.0.0.1"], enableUdp: true, enableTcp:true, preferUdp:true });
        room.peers[socket.id].transports.push(transport);
        callback({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
    });

    socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
        const room = rooms[socket.meetingID];
        const transport = room.peers[socket.id].transports.find(t=>t.id===transportId);
        await transport.connect({ dtlsParameters });
    });

    socket.on("produce", async ({ kind, rtpParameters }, callback) => {
        const room = rooms[socket.meetingID];
        const transport = room.peers[socket.id].transports[0];
        const producer = await transport.produce({ kind, rtpParameters });
        room.peers[socket.id].producers.push(producer);

        // Inform others
        socket.broadcast.to(socket.meetingID).emit("newProducer", { producerId: producer.id, producerSocketId: socket.id, kind });
        callback({ id: producer.id });
    });

    socket.on("consume", async ({ producerId }, callback) => {
        const room = rooms[socket.meetingID];
        const consumerTransport = room.peers[socket.id].transports[0]; // simplified
        const producer = Object.values(room.peers).map(p=>p.producers).flat().find(p=>p.id===producerId);
        if(!producer) return;
        const consumer = await consumerTransport.consume({ producerId: producer.id, rtpCapabilities: room.router.rtpCapabilities, paused: false });
        callback({ id: consumer.id, producerId: producer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
    });

    socket.on("disconnect", () => {
        const room = rooms[socket.meetingID];
        if(room){
            delete room.peers[socket.id];
            io.to(socket.meetingID).emit("participantLeft", { userID: socket.userID });
        }
        console.log("User disconnected:", socket.id);
    });
});

server.listen(3000, ()=>console.log("Server running on port 3000"));
