const socket = io();
let device, sendTransport, localStream;
const consumers = {};
let recordedBlobs = [];
let mediaRecorder;

// Initialize everything
(async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const userID = urlParams.get('uid') || prompt("Enter your nickname");
    const meetingID = urlParams.get('meetingID') || prompt("Enter Meeting ID");

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("localVideoCtr").srcObject = localStream;

    const rtpCapabilities = await new Promise(resolve => socket.emit("getRouterRtpCapabilities", null, resolve));
    device = new mediasoup.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });

    // Send transport
    const sendTransportData = await new Promise(resolve => socket.emit("createTransport", null, resolve));
    sendTransport = device.createSendTransport(sendTransportData);
    sendTransport.on("connect", ({ dtlsParameters }, callback) => {
        socket.emit("connectTransport", { transportId: sendTransport.id, dtlsParameters }, callback);
    });
    sendTransport.on("produce", ({ kind, rtpParameters }, callback) => {
        socket.emit("produce", { transportId: sendTransport.id, kind, rtpParameters }, ({ id }) => callback({ id }));
    });

    // Produce local tracks
    localStream.getTracks().forEach(track => sendTransport.produce({ track }));

    // Listen for new producers
    socket.on("newProducer", ({ producerId }) => consume(producerId));

    // Chat
    $("#btnSendMsg").click(() => {
        const msg = $("#msgbox").val().trim();
        if (!msg) return;
        socket.emit("sendMessage", { user: userID, message: msg });
        $("#msgbox").val('');
    });
    $("#msgbox").keydown(e => { if (e.key === "Enter") $("#btnSendMsg").click(); });

    // Recording
    $("#start-recording").click(startRecording);
    $("#download-video").click(downloadRecording);

})();

// Consume remote producer
async function consume(producerId) {
    const consumeTransportData = await new Promise(resolve => socket.emit("createTransport", null, resolve));
    const recvTransport = device.createRecvTransport(consumeTransportData);
    await new Promise(resolve => socket.emit("connectTransport", { transportId: recvTransport.id, dtlsParameters: consumeTransportData.dtlsParameters }, resolve));

    const consumerData = await new Promise(resolve => socket.emit("consume", { transportId: recvTransport.id, producerId, rtpCapabilities: device.rtpCapabilities }, resolve));
    const consumer = await recvTransport.consume(consumerData);
    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.srcObject = new MediaStream([consumer.track]);
    videoEl.classList.add("video-box");
    document.getElementById("divUsers").appendChild(videoEl);
    consumers[producerId] = consumer;
}

// Recording functions
function startRecording() {
    if (!localStream) return;
    recordedBlobs = [];
    mediaRecorder = new MediaRecorder(localStream, { mimeType: "video/webm;codecs=vp9,opus" });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedBlobs.push(e.data); };
    mediaRecorder.start();
    $("#start-recording").text("Stop Recording").off("click").click(stopRecording);
    $("#download-video").prop("disabled", true);
}

function stopRecording() {
    mediaRecorder.stop();
    $("#start-recording").text("Start Recording").off("click").click(startRecording);
    $("#download-video").prop("disabled", false);
}

function downloadRecording() {
    const blob = new Blob(recordedBlobs, { type: 'video/webm' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'recording.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
}
