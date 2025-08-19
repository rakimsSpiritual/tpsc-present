// public/app.js
// Industrial-grade Mediasoup + Socket.IO client for appHome.hbs
// Requirements: mediasoup-client loaded in page, socket.io loaded.
// Expects server socket handlers:
// - "getRouterRtpCapabilities" -> callback(routerRtpCapabilities)
// - "createTransport" -> callback(transportOptions)
// - "connectTransport" ({ transportId, dtlsParameters })
// - "produce" ({ transportId, kind, rtpParameters }) -> callback({ id })
// - "consume" ({ transportId, producerId, rtpCapabilities }) -> callback(consumerParams)
// - server emits "newProducer" when someone produces, and optionally "existingProducers" on join.

(async () => {
  // ensure libs available
  if (typeof io === 'undefined') throw new Error('socket.io client not found. Include /socket.io/socket.io.js');
  if (typeof mediasoupClient === 'undefined' && typeof mediasoup === 'undefined') {
    // mediasoup-client usually available as `mediasoupClient` or global `mediasoupClient`
    console.warn('mediasoup-client not found as global. Ensure <script src="https://unpkg.com/mediasoup-client@3/lib/index.js"></script> is loaded.');
  }

  const socket = io();

  // DOM helpers
  const $ = window.jQuery || (sel => document.querySelector(sel));
  function el(selector) { return document.querySelector(selector); }

  // Query params
  const urlParams = new URLSearchParams(window.location.search);
  const MEETING_ID = urlParams.get('meetingID');
  const UID = urlParams.get('uid') || prompt('Enter your nickname');

  if (!MEETING_ID || !UID) {
    alert('Missing meetingID or uid in URL.');
    throw new Error('Missing meetingID or uid.');
  }

  // UI elements
  const localVideoEl = document.getElementById('localVideoCtr');
  const usersContainer = document.getElementById('divUsers'); // where remote templates are appended
  const remoteTemplate = document.getElementById('remoteTemplate');
  const participantsListEl = document.getElementById('participantsList');
  const messagesEl = document.getElementById('messages');
  const msgBoxEl = document.getElementById('msgbox');
  const sendBtnEl = document.getElementById('btnSendMsg');
  const startRecordingBtn = document.getElementById('start-recording');
  const downloadBtn = document.getElementById('download-video');

  // mediasoup client objects
  let device;
  let sendTransport;   // for producing local tracks
  let recvTransport;   // for consuming remote producers
  let localStream = null;
  const consumers = {};      // producerId -> consumer
  const consumerStreams = {}; // producerId -> MediaStream (used for video srcObject)
  const producerId2peer = {}; // map producerId -> socketId (owner)

  // utility: add remote video element from template
  function addRemoteElementForProducer(producerId, ownerSocketId, ownerLabel) {
    // if already exists, reuse
    if (document.getElementById('remote_' + producerId)) return document.getElementById('remote_' + producerId);

    const clone = remoteTemplate.cloneNode(true);
    clone.style.display = 'flex';
    clone.id = 'remote_' + producerId;
    clone.querySelector('.user-name').textContent = ownerLabel || ownerSocketId;
    const vid = clone.querySelector('video');
    vid.autoplay = true;
    vid.playsInline = true;
    usersContainer.appendChild(clone);
    updateParticipants();
    return clone;
  }

  function removeRemoteProducerElement(producerId) {
    const el = document.getElementById('remote_' + producerId);
    if (el) el.remove();
    delete consumers[producerId];
    delete consumerStreams[producerId];
    delete producerId2peer[producerId];
    updateParticipants();
  }

  function updateParticipants() {
    // shows UID + owners of remote producers (no strict user list but useful)
    participantsListEl.innerHTML = '';
    const liYou = document.createElement('li');
    liYou.className = 'list-group-item';
    liYou.textContent = UID + ' (You)';
    participantsListEl.appendChild(liYou);

    // Unique owners
    const owners = {};
    for (const pid in producerId2peer) {
      owners[producerId2peer[pid]] = true;
    }
    Object.keys(owners).forEach(ownerSocketId => {
      const li = document.createElement('li');
      li.className = 'list-group-item';
      li.textContent = ownerSocketId;
      participantsListEl.appendChild(li);
    });
  }

  // Chat: append message to messages area
  function appendMessage(user, message) {
    const d = document.createElement('div');
    d.textContent = `${user}: ${message}`;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Recording helpers
  let mediaRecorder = null;
  let recordedChunks = [];
  function startRecording() {
    if (!localStream) return alert('Local stream not ready.');
    recordedChunks = [];

    // build combined stream: local + all consumer tracks
    const combined = new MediaStream();
    localStream.getTracks().forEach(t => combined.addTrack(t));

    for (const pid in consumerStreams) {
      const ms = consumerStreams[pid];
      if (!ms) continue;
      ms.getTracks().forEach(t => combined.addTrack(t));
    }

    const mime = (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) ? 'video/webm;codecs=vp9,opus' :
                 (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) ? 'video/webm;codecs=vp8,opus' :
                 'video/webm';

    try {
      mediaRecorder = new MediaRecorder(combined, { mimeType: mime });
    } catch (e) {
      console.warn('MediaRecorder ctor failed with mime:', mime, e);
      mediaRecorder = new MediaRecorder(combined);
    }

    mediaRecorder.ondataavailable = ev => {
      if (ev.data && ev.data.size) recordedChunks.push(ev.data);
    };
    mediaRecorder.onstop = () => {
      // enable download
      downloadBtn.disabled = false;
    };
    mediaRecorder.start(1000);
    startRecordingBtn.textContent = 'Stop Recording';
    startRecordingBtn.onclick = stopRecording;
    downloadBtn.disabled = true;
  }
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    startRecordingBtn.textContent = 'Start Recording';
    startRecordingBtn.onclick = startRecording;
  }
  function downloadRecording() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000 * 10);
  }

  // Core mediasoup flows

  // 1) get local media
  async function getLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideoEl.srcObject = localStream;
    } catch (err) {
      console.error('getUserMedia error', err);
      alert('Error accessing camera/microphone: ' + (err.message || err));
      throw err;
    }
  }

  // 2) load device (router rtp capabilities)
  async function loadDevice() {
    return new Promise((resolve, reject) => {
      socket.emit('getRouterRtpCapabilities', null, async (rtpCapabilities) => {
        try {
          device = new mediasoupClient.Device();
          await device.load({ routerRtpCapabilities: rtpCapabilities });
          resolve();
        } catch (err) {
          console.error('Device load failed', err);
          reject(err);
        }
      });
    });
  }

  // 3) create send transport and recv transport (we'll create recvTransport once and reuse)
  async function createSendTransport() {
    return new Promise((resolve, reject) => {
      socket.emit('createTransport', null, async (transportOptions) => {
        try {
          sendTransport = device.createSendTransport(transportOptions);

          // sendTransport events
          sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            socket.emit('connectTransport', { transportId: sendTransport.id, dtlsParameters }, (res) => {
              callback(); // success
            });
          });

          sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            // ask server to produce, attach transport id
            socket.emit('produce', { transportId: sendTransport.id, kind, rtpParameters }, ({ id }) => {
              callback({ id });
            });
          });

          sendTransport.on('connectionstatechange', (state) => {
            console.log('sendTransport connection state:', state);
            if (state === 'failed') sendTransport.close();
          });

          resolve();
        } catch (err) {
          console.error('createSendTransport error', err);
          reject(err);
        }
      });
    });
  }

  async function createRecvTransport() {
    return new Promise((resolve, reject) => {
      socket.emit('createTransport', null, async (transportOptions) => {
        try {
          recvTransport = device.createRecvTransport(transportOptions);

          recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            socket.emit('connectTransport', { transportId: recvTransport.id, dtlsParameters }, (res) => {
              callback();
            });
          });

          recvTransport.on('connectionstatechange', (state) => {
            console.log('recvTransport connection state:', state);
            if (state === 'failed') recvTransport.close();
          });

          resolve();
        } catch (err) {
          console.error('createRecvTransport error', err);
          reject(err);
        }
      });
    });
  }

  // produce all local tracks
  async function produceLocalTracks() {
    if (!sendTransport || !localStream) return;
    try {
      for (const track of localStream.getTracks()) {
        // set encodings for video if desired (optional)
        const params = { track };
        await sendTransport.produce(params);
      }
    } catch (err) {
      console.error('produceLocalTracks error', err);
    }
  }

  // consume given producerId
  async function consumeProducer(producerId, producerSocketId) {
    if (!recvTransport) {
      await createRecvTransport();
    }

    // avoid double-consume
    if (consumers[producerId]) {
      return;
    }

    // ask server for consumer params
    socket.emit('consume', { transportId: recvTransport.id, producerId, rtpCapabilities: device.rtpCapabilities }, async (consumerParams) => {
      if (!consumerParams || !consumerParams.id) {
        console.warn('Invalid consumerParams', consumerParams);
        return;
      }

      try {
        // consumerParams includes id, producerId, kind, rtpParameters
        const consumer = await recvTransport.consume({
          id: consumerParams.id,
          producerId: consumerParams.producerId,
          kind: consumerParams.kind,
          rtpParameters: consumerParams.rtpParameters
        });

        // create stream for this consumer
        const ms = new MediaStream();
        ms.addTrack(consumer.track);
        consumerStreams[producerId] = ms;
        producerId2peer[producerId] = producerSocketId || consumerParams.producerSocketId || producerSocketId;

        // attach to DOM
        const container = addRemoteElementForProducer(producerId, producerSocketId, producerSocketId);
        const vid = container.querySelector('video');
        vid.srcObject = ms;

        // store consumer
        consumers[producerId] = consumer;

        // resume if necessary
        if (consumer.paused) {
          await socket.emit('resume', { consumerId: consumer.id }); // optional resume on server if implemented
          try { await consumer.resume(); } catch (e) { console.warn('consumer.resume failed', e); }
        }

        updateParticipants();
      } catch (err) {
        console.error('Error consuming', err);
      }
    });
  }

  // ask server for existing producers (if server provides)
  function requestExistingProducers() {
    socket.emit('getProducers', { meetingID: MEETING_ID }, (producerList) => {
      // server may respond with array of { producerId, producerSocketId }
      if (!producerList || !producerList.length) return;
      for (const p of producerList) {
        consumeProducer(p.producerId, p.producerSocketId);
      }
    });
  }

  // wiring up socket events
  socket.on('connect', async () => {
    console.log('socket connected');

    // join meeting room (server should keep meeting separation)
    socket.emit('joinMeeting', { meetingID: MEETING_ID, userID: UID });

    try {
      await getLocalMedia();
      await loadDevice();
      await createSendTransport();
      await createRecvTransport();
      await produceLocalTracks();

      // optionally request existing producers list (server may implement)
      requestExistingProducers();

    } catch (err) {
      console.error('init flow error', err);
      alert('Initialization error: ' + (err.message || err));
    }
  });

  // server tells us about a new producer
  socket.on('newProducer', ({ producerId, producerSocketId, kind }) => {
    console.log('newProducer event', producerId, producerSocketId, kind);
    // consume it
    consumeProducer(producerId, producerSocketId);
  });

  // server may emit existing producers on join
  socket.on('existingProducers', (prods) => {
    if (!Array.isArray(prods)) return;
    for (const p of prods) {
      consumeProducer(p.producerId, p.producerSocketId);
    }
  });

  // server may inform about a producer closed (owner left)
  socket.on('producerClosed', ({ producerId }) => {
    removeRemoteProducerElement(producerId);
  });

  // Chat handlers
  sendBtnEl.addEventListener('click', () => {
    const v = msgBoxEl.value.trim();
    if (!v) return;
    socket.emit('sendMessage', { meetingID: MEETING_ID, user: UID, message: v });
    appendMessage('You', v);
    msgBoxEl.value = '';
  });
  msgBoxEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtnEl.click();
    }
  });
  socket.on('receiveMessage', ({ user, message }) => {
    appendMessage(user, message);
  });

  // participantLeft (server should emit with socketID or userID)
  socket.on('participantLeft', ({ userID, socketID }) => {
    // remove any producers owned by that socket
    for (const pid in producerId2peer) {
      if (producerId2peer[pid] === socketID || producerId2peer[pid] === userID) {
        removeRemoteProducerElement(pid);
      }
    }
    updateParticipants();
  });

  // Recording wiring
  startRecordingBtn.addEventListener('click', startRecording);
  downloadBtn.addEventListener('click', downloadRecording);

  // expose some debug on window
  window._telemetry = {
    consumers,
    consumerStreams,
    producerId2peer,
    localStream,
    device
  };

})();
