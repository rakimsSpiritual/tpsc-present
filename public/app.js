let localStream;
const localVideo = document.getElementById("localVideoCtr");
let peers = {};
let socket;

async function initMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

async function MyApp(user_id, meeting_id) {
  socket = io();
  await initMedia();

  socket.emit("userconnect", { dsiplayName: user_id, meetingid: meeting_id });

  socket.on("informAboutNewConnection", async (data) => {
    const { other_user_id, connId } = data;
    await createPeerConnection(connId, other_user_id, true);
  });

  socket.on("userconnected", (users) => {
    users.forEach((u) => createPeerConnection(u.connectionId, u.userName, false));
  });

  socket.on("exchangeSDP", async (data) => {
    const { from_connid, message } = data;
    const pc = peers[from_connid];
    if (!pc) return;

    if (message.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      if (message.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("exchangeSDP", { to_connid: from_connid, message: { sdp: answer } });
      }
    }

    if (message.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
  });

  socket.on("showChatMessage", (data) => {
    const chat = document.getElementById("messages");
    const el = document.createElement("div");
    el.textContent = `${data.time} - ${data.from}: ${data.message}`;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
  });

  socket.on("userDisconnected", (data) => {
    const el = document.getElementById(data.connId);
    if (el) el.remove();
    delete peers[data.connId];
  });
}

async function createPeerConnection(connId, userName, isOffer) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit("exchangeSDP", { to_connid: connId, message: { candidate: event.candidate } });
  };

  pc.ontrack = (event) => {
    let remoteVideoBox = document.getElementById("remoteTemplate").cloneNode(true);
    remoteVideoBox.id = connId;
    remoteVideoBox.style.display = "block";
    remoteVideoBox.querySelector("video").srcObject = event.streams[0];
    remoteVideoBox.querySelector(".user-name").innerText = userName;
    document.getElementById("divUsers").appendChild(remoteVideoBox);
  };

  peers[connId] = pc;

  if (isOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("exchangeSDP", { to_connid: connId, message: { sdp: offer } });
  }
}


