// Connect to server
const socket = io();

// Global variables
let localStream;
let peers = {};
let userID;
let meetingID;
let mediaRecorder;
let recordedBlobs = [];

// Initialize after DOM loaded
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  meetingID = urlParams.get('meetingID');
  userID = urlParams.get('uid') || prompt('Enter your nickname');

  if (!meetingID || !userID) {
    alert('Meeting ID or nickname missing!');
    return;
  }

  // Show meeting container
  document.getElementById('meetingContainer').style.display = 'flex';
  document.querySelector('.g-right-details-wrap').style.display = 'block';

  // Get local media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideoCtr').srcObject = localStream;
  } catch (err) {
    alert('Camera/mic access denied: ' + err.message);
    return;
  }

  // Join server
  socket.emit('joinMeeting', { meetingID, userID });

  // Handle new participants
  socket.on('newParticipant', participants => {
    participants.forEach(peerID => {
      if (peerID !== userID && !peers[peerID]) {
        createPeerConnection(peerID, true);
      }
    });
    updateParticipantsList();
  });

  // WebRTC signaling
  socket.on('signal', async ({ from, data }) => {
    if (!peers[from]) {
      await createPeerConnection(from, false);
    }
    peers[from].peer.signal(data);
  });

  // Participant left
  socket.on('participantLeft', ({ userID: leftID }) => {
    removeRemoteVideo(leftID);
  });

  // Chat
  socket.on('receiveMessage', ({ userID: from, msg }) => {
    const div = document.createElement('div');
    div.textContent = `${from}: ${msg}`;
    const messages = document.getElementById('messages');
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  });

  // --- Chat: send button + enter key ---
  const sendMessage = () => {
    const msgInput = document.getElementById('msgbox');
    const msg = msgInput.value.trim();
    if (!msg) return;
    socket.emit('sendMessage', { meetingID, userID, msg });
    msgInput.value = '';
    const messages = document.getElementById('messages');
    messages.scrollTop = messages.scrollHeight;
  };

  document.getElementById('btnSendMsg').addEventListener('click', sendMessage);
  document.getElementById('msgbox').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Recording buttons
  document.getElementById('start-recording').addEventListener('click', startRecording);
  document.getElementById('download-video').addEventListener('click', downloadRecording);
});

// --- WebRTC functions ---
async function createPeerConnection(peerID, initiator) {
  const peer = new SimplePeer({ initiator, trickle: false, stream: localStream });

  peer.on('signal', data => {
    socket.emit('signal', { from: userID, to: peerID, data });
  });

  peer.on('stream', remoteStream => {
    addRemoteVideo(peerID, remoteStream);
  });

  peer.on('close', () => removeRemoteVideo(peerID));

  peers[peerID] = { peer };
}

// Add remote video element
function addRemoteVideo(peerID, stream) {
  if (document.getElementById('remote_' + peerID)) return;

  const divUsers = document.getElementById('divUsers');
  const template = document.createElement('div');
  template.id = 'remote_' + peerID;
  template.className = 'userbox';
  template.innerHTML = `<h5 class="user-name">${peerID}</h5><video autoplay playsinline class="video-box"></video>`;
  template.querySelector('video').srcObject = stream;
  divUsers.appendChild(template);
  updateParticipantsList();
}

// Remove remote video element
function removeRemoteVideo(peerID) {
  const el = document.getElementById('remote_' + peerID);
  if (el) el.remove();
  delete peers[peerID];
  updateParticipantsList();
}

// Update participant list sidebar
function updateParticipantsList() {
  const list = document.getElementById('participantsList');
  list.innerHTML = '';
  const liSelf = document.createElement('li');
  liSelf.className = 'list-group-item';
  liSelf.textContent = userID + ' (You)';
  list.appendChild(liSelf);

  Object.keys(peers).forEach(pid => {
    const li = document.createElement('li');
    li.className = 'list-group-item';
    li.textContent = pid;
    list.appendChild(li);
  });
}

// --- Recording ---
function startRecording() {
  if (!localStream) return alert('No local stream to record');
  recordedBlobs = [];
  const combinedStream = new MediaStream();
  localStream.getTracks().forEach(t => combinedStream.addTrack(t));
  Object.values(peers).forEach(p => {
    const remoteVideo = document.getElementById('remote_' + p.peer._id)?.querySelector('video');
    if (remoteVideo && remoteVideo.srcObject) remoteVideo.srcObject.getTracks().forEach(t => combinedStream.addTrack(t));
  });

  try {
    mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9,opus' });
  } catch {
    mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
  }

  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedBlobs.push(e.data); };
  mediaRecorder.start();
  document.getElementById('start-recording').textContent = 'Stop Recording';
  document.getElementById('start-recording').onclick = stopRecording;
  document.getElementById('download-video').disabled = true;
}

function stopRecording() {
  mediaRecorder.stop();
  document.getElementById('start-recording').textContent = 'Start Recording';
  document.getElementById('start-recording').onclick = startRecording;
  document.getElementById('download-video').disabled = false;
}

function downloadRecording() {
  const blob = new Blob(recordedBlobs, { type: 'video/webm' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  a.download = 'recording.webm';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}
