// app.js
const socket = io(); // Connect to Socket.IO

let localStream;
let peers = {}; // Map of peerID -> RTCPeerConnection
let userID;
let meetingID;

// Get ICE servers (optional: add TURN/STUN if you have)
const iceConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// Initialize MyApp
function MyApp(uid, mID) {
    userID = uid;
    meetingID = mID;

    // Get user media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            const localVideo = document.getElementById("localVideoCtr");
            localVideo.srcObject = stream;

            // Notify server
            socket.emit("joinRoom", { userID, meetingID });
        })
        .catch(err => {
            console.error("Error accessing media devices.", err);
            alert("Cannot access camera/mic.");
        });

    setupSocketEvents();
}

// Socket.IO events
function setupSocketEvents() {
    // When a new user joins the room
    socket.on("newUser", data => {
        const { userID: remoteID } = data;
        if (remoteID === userID) return;

        // Create a new peer connection
        const pc = createPeerConnection(remoteID);
        peers[remoteID] = pc;

        // Add local tracks to peer
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        // Create offer
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit("signal", { to: remoteID, from: userID, description: pc.localDescription });
            });
    });

    // Receive signaling data
    socket.on("signal", async data => {
        const { from, description, candidate } = data;

        // If no peer exists, create it
        if (!peers[from]) {
            peers[from] = createPeerConnection(from);
            localStream.getTracks().forEach(track => peers[from].addTrack(track, localStream));
        }
        const pc = peers[from];

        if (description) {
            if (description.type === "offer") {
                await pc.setRemoteDescription(description);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit("signal", { to: from, from: userID, description: pc.localDescription });
            } else if (description.type === "answer") {
                await pc.setRemoteDescription(description);
            }
        }
        if (candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    // Chat messages
    socket.on("chatMessage", data => {
        const { user, message } = data;
        const msgDiv = document.createElement("div");
        msgDiv.textContent = `${user}: ${message}`;
        document.getElementById("messages").appendChild(msgDiv);
        document.getElementById("messages").scrollTop = document.getElementById("messages").scrollHeight;
    });

    // User disconnected
    socket.on("userDisconnected", remoteID => {
        if (peers[remoteID]) {
            peers[remoteID].close();
            delete peers[remoteID];

            const remoteEl = document.querySelector(`#divUsers .userbox[data-id="${remoteID}"]`);
            if (remoteEl) remoteEl.remove();
        }
        updateParticipantCount();
    });
}

// Create RTCPeerConnection for a remote user
function createPeerConnection(remoteID) {
    const pc = new RTCPeerConnection(iceConfiguration);

    // Handle remote stream
    pc.ontrack = event => {
        let remoteEl = document.querySelector(`#divUsers .userbox[data-id="${remoteID}"]`);
        if (!remoteEl) {
            const template = document.getElementById("remoteTemplate");
            remoteEl = template.cloneNode(true);
            remoteEl.style.display = "block";
            remoteEl.dataset.id = remoteID;
            remoteEl.querySelector("h5.user-name").textContent = remoteID;
            document.getElementById("divUsers").appendChild(remoteEl);
        }
        const video = remoteEl.querySelector("video");
        video.srcObject = event.streams[0];
    };

    // ICE candidates
    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit("signal", { to: remoteID, from: userID, candidate: event.candidate });
        }
    };

    updateParticipantCount();
    return pc;
}

// Update participant count in sidebar
function updateParticipantCount() {
    const count = Object.keys(peers).length + 1;
    document.querySelectorAll(".participant-count").forEach(el => el.textContent = count);
}

// Chat send handler
document.getElementById("btnSendMsg").addEventListener("click", () => {
    const msg = document.getElementById("msgbox").value.trim();
    if (!msg) return;
    socket.emit("sendMessage", { meetingID, user: userID, message: msg });
    document.getElementById("msgbox").value = "";
});

// Recording logic
let mediaRecorder;
let recordedBlobs = [];
document.getElementById("start-recording").addEventListener("click", () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        recordedBlobs = [];
        mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm;codecs=vp9' });
        mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedBlobs.push(e.data); };
        mediaRecorder.start();
        document.getElementById("start-recording").textContent = "Stop Recording";
        document.getElementById("download-video").disabled = true;
    } else {
        mediaRecorder.stop();
        document.getElementById("start-recording").textContent = "Start Recording";
        document.getElementById("download-video").disabled = false;
    }
});

document.getElementById("download-video").addEventListener("click", () => {
    const blob = new Blob(recordedBlobs, { type: 'video/webm' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `recording_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 100);
});
