// Connect to server
const socket = io();

// Global variables
let localStream;
let peers = {};
let userIDGlobal;
let meetingIDGlobal;
let mediaRecorder;
let recordedBlobs = [];

// Generate random UUID if not provided
function generateUUID() {
    return 'xxxxxx'.replace(/[x]/g, function() {
        return Math.floor(Math.random() * 10);
    });
}

// Initialize App
function MyApp(userID, meetingID) {
    userIDGlobal = userID || generateUUID();
    meetingIDGlobal = meetingID;

    $('#meetingContainer, .g-right-details-wrap').show();

    // Get local media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        localStream = stream;
        const localVideo = document.getElementById('localVideoCtr');
        localVideo.srcObject = stream;

        // Notify server
        socket.emit('joinMeeting', { meetingID: meetingIDGlobal, userID: userIDGlobal });

        // Receive list of existing participants
        socket.on('existingParticipants', participants => {
            participants.forEach(pid => {
                if(pid !== userIDGlobal && !peers[pid]) {
                    createPeerConnection(pid, true);
                }
            });
        });

        // New participant joined
        socket.on('newParticipant', ({ userID: newUserID }) => {
            if(newUserID !== userIDGlobal && !peers[newUserID]) {
                createPeerConnection(newUserID, true);
            }
            updateParticipantsList();
        });

        // Handle incoming signal
        socket.on('signal', async ({ fromID, signal }) => {
            if(!peers[fromID]) {
                await createPeerConnection(fromID, false);
            }
            peers[fromID].pc.signal(signal);
        });

        // Handle participant leaving
        socket.on('participantLeft', ({ userID }) => {
            removeRemoteVideo(userID);
        });

        // Chat messages
        socket.on('receiveMessage', ({ userID, msg }) => {
            const msgDiv = document.createElement('div');
            msgDiv.textContent = `${userID}: ${msg}`;
            document.getElementById('messages').appendChild(msgDiv);
            document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        });

    })
    .catch(err => {
        console.error('Error accessing media devices:', err);
        alert("Cannot access camera/mic. Please allow permissions.");
    });
}

// --- WebRTC helpers using SimplePeer ---
async function createPeerConnection(peerID, initiator) {
    const pc = new SimplePeer({
        initiator,
        trickle: false,
        stream: localStream
    });

    pc.on('signal', data => {
        socket.emit('signal', { targetID: peerID, fromID: userIDGlobal, signal: data });
    });

    pc.on('stream', stream => {
        addRemoteVideo(peerID, stream);
    });

    pc.on('close', () => removeRemoteVideo(peerID));

    peers[peerID] = { pc };
    return pc;
}

// Add remote video
function addRemoteVideo(peerID, stream) {
    if(document.getElementById('remote_' + peerID)) return;

    const divUsers = document.getElementById('divUsers');
    const userBox = document.createElement('div');
    userBox.className = 'userbox';
    userBox.id = 'remote_' + peerID;

    const h5 = document.createElement('h5');
    h5.textContent = peerID;
    h5.className = 'user-name';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    userBox.appendChild(h5);
    userBox.appendChild(video);
    divUsers.appendChild(userBox);

    updateParticipantsList();
}

// Remove remote video
function removeRemoteVideo(peerID) {
    const el = document.getElementById('remote_' + peerID);
    if(el) el.remove();
    delete peers[peerID];
    updateParticipantsList();
}

// Update participants list
function updateParticipantsList() {
    const list = document.getElementById('participantsList');
    list.innerHTML = '';
    list.appendChild(createParticipantLi(userIDGlobal));
    Object.keys(peers).forEach(pid => list.appendChild(createParticipantLi(pid)));
}

function createParticipantLi(userID) {
    const li = document.createElement('li');
    li.className = 'list-group-item';
    li.textContent = userID;
    return li;
}

// --- Chat ---
$(document).ready(function(){
    const sendMessage = () => {
        const msg = $('#msgbox').val().trim();
        if(msg) {
            socket.emit('sendMessage', { meetingID: meetingIDGlobal, userID: userIDGlobal, msg });
            $('#msgbox').val('');
            $('#messages').scrollTop($('#messages')[0].scrollHeight);
        }
    };

    $('#btnSendMsg').on('click', sendMessage);

    $('#msgbox').on('keydown', function(e){
        if(e.key === 'Enter' && !e.shiftKey){
            e.preventDefault();
            sendMessage();
        }
    });
});

// --- Recording ---
$('#start-recording').on('click', startRecording);
$('#download-video').on('click', downloadRecording);

function startRecording() {
    if(!localStream) return alert("No local stream to record");
    recordedBlobs = [];
    try {
        mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm;codecs=vp9,opus' });
    } catch(e) {
        mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm' });
    }
    mediaRecorder.ondataavailable = e => { if(e.data && e.data.size>0) recordedBlobs.push(e.data); };
    mediaRecorder.start();
    $('#start-recording').text('Stop Recording').off('click').on('click', stopRecording);
    $('#download-video').prop('disabled', true);
}

function stopRecording() {
    mediaRecorder.stop();
    $('#start-recording').text('Start Recording').off('click').on('click', startRecording);
    $('#download-video').prop('disabled', false);
}

function downloadRecording() {
    const blob = new Blob(recordedBlobs, { type: 'video/webm' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display='none';
    a.href = url;
    a.download = 'recording.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ document.body.removeChild(a); window.URL.revokeObjectURL(url); },100);
}
