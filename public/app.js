let device;
let sendTransport;
let recvTransport;
let localStream;
const peers = {}; // { producerId: videoElement }

// Initialize Mediasoup
async function init(userID, meetingID) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("localVideoCtr").srcObject = localStream;

    const rtpCapabilities = await new Promise(resolve => socket.emit("getRouterRtpCapabilities", null, resolve));
    device = new mediasoup.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });

    // Create send transport
    const sendData = await new Promise(resolve => socket.emit("createTransport", null, resolve));
    sendTransport = device.createSendTransport(sendData);
    sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
        socket.emit("connectTransport", { transportId: sendTransport.id, dtlsParameters }, callback);
    });
    sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
        socket.emit("produce", { transportId: sendTransport.id, kind, rtpParameters }, ({ id }) => callback({ id }));
    });

    // Produce tracks
    localStream.getTracks().forEach(track => sendTransport.produce({ track }));

    // Handle new producers
    socket.on("newProducer", async ({ producerId, producerSocketId, kind }) => {
        await consume(producerId);
    });

    // Chat
    document.getElementById("btnSendMsg").onclick = () => {
        const msg = document.getElementById("msgbox").value;
        if (msg.trim() === "") return;
        socket.emit("sendMessage", { user: userID, message: msg });
        document.getElementById("msgbox").value = "";
    };
    document.getElementById("msgbox").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btnSendMsg").click(); });
}

// Consume a remote producer
async function consume(producerId) {
    const consumeTransportData = await new Promise(resolve => socket.emit("createTransport", null, resolve));
    const consumeTransport = device.createRecvTransport(consumeTransportData);
    await new Promise(resolve => socket.emit("connectTransport", { transportId: consumeTransport.id, dtlsParameters: consumeTransportData.dtlsParameters }, resolve));

    const consumerData = await new Promise(resolve => socket.emit("consume", { transportId: consumeTransport.id, producerId, rtpCapabilities: device.rtpCapabilities }, resolve));

    const consumer = await consumeTransport.consume(consumerData);
    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.srcObject = new MediaStream([consumer.track]);
    document.getElementById("divUsers").appendChild(videoEl);

    peers[producerId] = { consumer, videoEl };
}
