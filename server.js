require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const exphbs = require('express-handlebars');
const path = require('path');
const mediasoup = require('mediasoup');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

app.engine('hbs', exphbs.engine({ extname: '.hbs' }));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => res.render('appHome'));

// Mediasoup setup
let worker;
let router;
let transports = [];
let producers = [];
let consumers = [];

(async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  });
  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting...');
    process.exit(1);
  });

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 }
      }
    ]
  });
})();

// Helper to create transport
async function createTransport(callback) {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "0.0.0.0", announcedIp: process.env.RENDER_EXTERNAL_IP || null }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  transports.push(transport);

  callback({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });

  return transport;
}

// Socket.io logic
io.on("connection", socket => {
  console.log("Client connected:", socket.id);

  socket.on("getRouterRtpCapabilities", (cb) => {
    cb(router.rtpCapabilities);
  });

  socket.on("createTransport", async (data, cb) => {
    const transport = await createTransport(cb);
    transport.appData = { socketId: socket.id, producing: data.producing };
    socket.data.transports = socket.data.transports || [];
    socket.data.transports.push(transport);
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }) => {
    const transport = transports.find(t => t.id === transportId);
    if (!transport) return;
    await transport.connect({ dtlsParameters });
  });

  socket.on("produce", async ({ transportId, kind, rtpParameters }, cb) => {
    const transport = transports.find(t => t.id === transportId);
    if (!transport) return;
    const producer = await transport.produce({ kind, rtpParameters });
    producers.push(producer);

    // Notify others
    socket.broadcast.emit("newProducer", { producerId: producer.id, kind });
    cb({ id: producer.id });
  });

  socket.on("consume", async ({ producerId, transportId, rtpCapabilities }, cb) => {
    const transport = transports.find(t => t.id === transportId);
    if (!transport) return;

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      return cb({ error: "Cannot consume" });
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });
    consumers.push(consumer);

    cb({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (socket.data.transports) {
      socket.data.transports.forEach(t => t.close());
    }
  });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
