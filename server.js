// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static("public"));
app.set("view engine", "hbs");
app.set("views", __dirname + "/views");

app.get("/", (req, res) => res.redirect("/sign"));
app.get("/appHome", (req, res) => res.render("appHome"));

// --- Mediasoup setup ---
let worker;
let router;
const peers = {}; // { socketId: { transports: [], producers: [], consumers: [] } }

(async () => {
    worker = await mediasoup.createWorker();
    router = await worker.createRouter({ mediaCodecs: [
        { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
        { kind: "video", mimeType: "video/VP8", clockRate: 90000 }
    ]});
})();

// Socket.IO
io.on("connection", socket => {
    console.log("Socket connected:", socket.id);
    peers[socket.id] = { transports: [], producers: [], consumers: [] };

    socket.on("getRouterRtpCapabilities", (_, callback) => {
        callback(router.rtpCapabilities);
    });

    socket.on("createTransport", async (_, callback) => {
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

    socket.on("connectTransport", async ({ transportId, dtlsParameters }, callback) => {
        const transport = peers[socket.id].transports.find(t => t.id === transportId);
        await transport.connect({ dtlsParameters });
        callback({ connected: true });
    });

    socket.on("produce", async ({ transportId, kind, rtpParameters }, callback) => {
        const transport = peers[socket.id].transports.find(t => t.id === transportId);
        const producer = await transport.produce({ kind, rtpParameters });
        peers[socket.id].producers.push(producer);

        // Notify all other peers
        socket.broadcast.emit("newProducer", { producerId: producer.id, producerSocketId: socket.id, kind });
        callback({ id: producer.id });
    });

    socket.on("consume", async ({ transportId, producerId, rtpCapabilities }, callback) => {
        if (!router.canConsume({ producerId, rtpCapabilities })) return;
        const transport = peers[socket.id].transports.find(t => t.id === transportId);
        const consumer = await transport.consume({ producerId, rtpCapabilities, paused: false });
        peers[socket.id].consumers.push(consumer);
        callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
        });
    });

    socket.on("sendMessage", ({ user, message }) => {
        io.emit("receiveMessage", { user, message });
    });

    socket.on("disconnect", () => {
        peers[socket.id].producers.forEach(p => p.close());
        peers[socket.id].consumers.forEach(c => c.close());
        peers[socket.id].transports.forEach(t => t.close());
        delete peers[socket.id];
        console.log("Socket disconnected:", socket.id);
    });
});

server.listen(3000, () => console.log("Server running on port 3000"));
