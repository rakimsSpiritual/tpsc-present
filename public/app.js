const socket = io("/");

// Store peer connections
const peerConnections = {};
let localStream = null;
let iceConfiguration = { iceServers: [] };

// ===== Load ICE Servers from server (Twilio TURN + STUN) =====
async function loadIceServers() {
  try {
    const res = await fetch("/get-turn-credentials");
    const servers = await res.json();

    // Always include Google STUN too
    iceConfiguration.iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      ...servers
    ];

    console.log("✅ ICE Servers loaded:", iceConfiguration);
  } catch (err) {
    console.error("❌ Failed to load ICE servers:", err);
  }
}

// ===== Initialize Local Stream =====
async function initLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    const localVideo = document.getElementById("localVideo");
    localVideo.srcObject = localStream;
  } catch (err) {
    console.error("Error accessing media devices:", err);
  }
}

// ===== Create RTCPeerConnection for new peers =====
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(iceConfiguration);

  // Add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Remote track handler
  pc.ontrack = (event) => {
    let remoteVideo = document.getElementById(`video-${peerId}`);
    if (!remoteVideo) {
      remoteVideo = document.createElement("video");
      remoteVideo.id = `video-${peerId}`;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      document.getElementById("remoteVideos").appendChild(remoteVideo);
    }
    remoteVideo.srcObject = event.streams[0];
  };

  // ICE Candidate handler
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("message", {
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  return pc;
}

// ===== Handle socket.io messages =====
socket.on("message", async (data) => {
  let pc = peerConnections[data.from];

  if (data.description) {
    if (!pc) {
      pc = createPeerConnection(data.from);
      peerConnections[data.from] = pc;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data.description));

    if (data.description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("message", {
        to: data.from,
        description: pc.localDescription
      });
    }
  } else if (data.candidate) {
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    }
  }
});

// ===== When a new peer joins =====
socket.on("new-peer", async (peerId) => {
  const pc = createPeerConnection(peerId);
  peerConnections[peerId] = pc;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("message", {
    to: peerId,
    description: pc.localDescription
  });
});

// ===== Main startup =====
(async () => {
  await loadIceServers();   // Load ICE config before anything
  await initLocalStream();  // Start camera & mic
  socket.emit("join-room"); // Tell server we joined
})();
