const socket = io();
let localStream, peers = {}, userID, meetingID;
let mediaRecorder, recordedBlobs = [];

function addRemoteVideo(peerID, stream) {
    if (document.getElementById('remote_' + peerID)) return;

    const divUsers = document.getElementById('divUsers');
    const div = document.createElement('div');
    div.className = 'userbox';
    div.id = 'remote_' + peerID;

    const h5 = document.createElement('h5');
    h5.textContent = peerID;
    div.appendChild(h5);

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    div.appendChild(video);

    divUsers.appendChild(div);
    updateParticipants();
}

function removeRemoteVideo(peerID) {
    const el = document.getElementById('remote_' + peerID);
    if (el) el.remove();
    delete peers[peerID];
    updateParticipants();
}

function updateParticipants() {
    const list = document.getElementById('participantsList');
    list.innerHTML = '';
    const liMe = document.createElement('li');
    liMe.className = 'list-group-item';
    liMe.textContent = userID + ' (Me)';
    list.appendChild(liMe);
    Object.keys(peers).forEach(pid => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.textContent = pid;
        list.appendChild(li);
    });
}

function sendMessage() {
    const msg = $('#msgbox').val().trim();
    if (!msg) return;
    socket.emit('sendMessage', { meetingID, userID, msg });
    $('#msgbox').val('');
    $('#messages').scrollTop($('#messages')[0].scrollHeight);
}

$(document).ready(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    meetingID = urlParams.get('meetingID') || prompt('Enter Meeting ID');
    userID = urlParams.get('uid') || crypto.randomUUID();

    if (!meetingID || !userID) return alert('Missing meeting or user ID');

    $("#meetingContainer").show();
    $(".g-right-details-wrap").show();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideoCtr').srcObject = localStream;
    } catch (err) {
        alert('Cannot access camera/mic: ' + err.message);
        return;
    }

    socket.emit('joinMeeting', { meetingID, userID });

    socket.on('newParticipant', ({ participants }) => {
        participants.forEach(pid => {
            if (pid === userID || peers[pid]) return;
            const pc = new SimplePeer({ initiator: true, trickle: false, stream: localStream });
            pc.on('signal', data => socket.emit('signal', { targetID: pid, fromID: userID, signal: data }));
            pc.on('stream', stream => addRemoteVideo(pid, stream));
            pc.on('close', () => removeRemoteVideo(pid));
            peers[pid] = pc;
        });
    });

    socket.on('signal', ({ fromID, signal }) => {
        if (!peers[fromID]) {
            const pc = new SimplePeer({ initiator: false, trickle: false, stream: localStream });
            pc.on('signal', data => socket.emit('signal', { targetID: fromID, fromID: userID, signal: data }));
            pc.on('stream', stream => addRemoteVideo(fromID, stream));
            pc.on('close', () => removeRemoteVideo(fromID));
            peers[fromID] = pc;
            pc.signal(signal);
        } else {
            peers[fromID].signal(signal);
        }
    });

    socket.on('participantLeft', ({ userID: leftID }) => removeRemoteVideo(leftID));

    socket.on('receiveMessage', ({ userID: from, msg }) => {
        const div = document.createElement('div');
        div.textContent = `${from}: ${msg}`;
        document.getElementById('messages').appendChild(div);
        $('#messages').scrollTop($('#messages')[0].scrollHeight);
    });

    $('#btnSendMsg').on('click', sendMessage);
    $('#msgbox').on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Recording
    $("#start-recording").on('click', () => {
        recordedBlobs = [];
        const combinedStream = new MediaStream([...localStream.getTracks()]);
        Object.values(peers).forEach(p => {
            if (p.streams) p.streams.forEach(s => s.getTracks().forEach(t => combinedStream.addTrack(t)));
        });
        mediaRecorder = new MediaRecorder(combinedStream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedBlobs.push(e.data); };
        mediaRecorder.start();
        $("#start-recording").prop("disabled", true);
        $("#download-video").prop("disabled", false);
    });

    $("#download-video").on('click', () => {
        if (mediaRecorder) mediaRecorder.stop();
        const blob = new Blob(recordedBlobs, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recording.webm';
        a.click();
        $("#start-recording").prop("disabled", false);
    });
});
