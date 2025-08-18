// app.js
const socket = io(); // Connect to Socket.IO

let localStream;
let peers = {}; // Store RTCPeerConnections keyed by remote user ID
let userID, meetingID;

// MediaRecorder variables
let mediaRecorder;
let recordedBlobs = [];

// Initialize the app
function MyApp(uid, mid) {
    userID = uid;
    meetingID = mid;

    // Get user media (video + audio)
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            const localVideo = document.getElementById('localVideoCtr');
            localVideo.srcObject = stream;

            // Notify server we joined
            socket.emit('joinMeeting', { userID, meetingID });
        })
        .catch(err => {
            console.error("Error accessing media devices.", err);
            alert("Could not access camera/mic. Check permissions.");
        });
}

// When another user joins, server tells us to create an offer
socket.on('user-joined', ({ remoteID, remoteName }) => {
    console.log('User joined:', remoteID);
    const peerConnection = createPeerConnection(remoteID, remoteName);
    peers[remoteID] = peerConnection;

    // Add local tracks
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Create offer
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            socket.emit('offer', {
                to: remoteID,
                from: userID,
                sdp: peerConnection.localDescription
            });
        });
});

// Handle offer from remote
socket.on('offer', async ({ from, sdp, name }) => {
    const peerConnection = createPeerConnection(from, name);
    peers[from] = peerConnection;

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', { to: from, from: userID, sdp: answer });
});

// Handle answer from remote
socket.on('answer', async ({ from, sdp }) => {
    const peerConnection = peers[from];
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    }
});

// Handle ICE candidates
socket.on('ice-candidate', ({ from, candidate }) => {
    const peerConnection = peers[from];
    if (peerConnection && candidate) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// Handle user leaving
socket.on('user-left', ({ userID: remoteID }) => {
    console.log('User left:', remoteID);
    const videoEl = document.getElementById('remote-' + remoteID);
    if (videoEl) videoEl.parentElement.remove();
    if (peers[remoteID]) {
        peers[remoteID].close();
        delete peers[remoteID];
    }
    updateParticipants();
});

// Chat messages
socket.on('receiveMessage', ({ userID: fromID, message }) => {
    const msgDiv = document.getElementById('messages');
    const div = document.createElement('div');
    div.textContent = `${fromID}: ${message}`;
    msgDiv.appendChild(div);
    msgDiv.scrollTop = msgDiv.scrollHeight;
});

// --- Helper Functions ---

function createPeerConnection(remoteID, remoteName) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    // Send ICE candidates to remote
    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                to: remoteID,
                from: userID,
                candidate: event.candidate
            });
        }
    };

    // When remote stream is added
    pc.ontrack = event => {
        let remoteDiv = document.getElementById('remote-' + remoteID);
        if (!remoteDiv) {
            const template = document.getElementById('remoteTemplate');
            const clone = template.cloneNode(true);
            clone.style.display = 'block';
            clone.id = 'remote-' + remoteID;
            clone.querySelector('h5').textContent = remoteName || remoteID;
            clone.querySelector('video').srcObject = event.streams[0];
            document.getElementById('divUsers').appendChild(clone);
            updateParticipants();
        }
    };

    return pc;
}

// Update participant list
function updateParticipants() {
    const list = document.getElementById('participantsList');
    list.innerHTML = '';

    // Add local user
    const li = document.createElement('li');
    li.textContent = userID + " (You)";
    li.classList.add('list-group-item');
    list.appendChild(li);

    // Add remote users
    Object.keys(peers).forEach(remoteID => {
        const li = document.createElement('li');
        li.textContent = remoteID;
        li.classList.add('list-group-item');
        list.appendChild(li);
    });
}

// --- Recording ---
document.getElementById('start-recording').addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        startRecording();
    } else if (mediaRecorder.state === 'recording') {
        stopRecording();
    }
});

document.getElementById('download-video').addEventListener('click', () => {
    const blob = new Blob(recordedBlobs, { type: 'video/webm' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'recording.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
});

function startRecording() {
    recordedBlobs = [];
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    try {
        mediaRecorder = new MediaRecorder(localStream, options);
    } catch (e) {
        console.error('MediaRecorder creation failed', e);
        return;
    }
    mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
            recordedBlobs.push(event.data);
        }
    };
    mediaRecorder.onstop = () => {
        document.getElementById('download-video').disabled = false;
    };
    mediaRecorder.start();
    document.getElementById('start-recording').textContent = "Stop Recording";
}

function stopRecording() {
    mediaRecorder.stop();
    document.getElementById('start-recording').textContent = "Start Recording";
}
