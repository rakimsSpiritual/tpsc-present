 var WrtcHelper = (function () {
  const iceConfiguration = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "stun:stun1.l.google.com:19302",
      },
      {
        urls: "stun:stun2.l.google.com:19302",
      },
      {
        urls: "stun:stun3.l.google.com:19302",
      },
      {
        urls: "stun:stun4.l.google.com:19302",
      },
      // ADDED TURN SERVERS for reliability
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ],
    iceTransportPolicy: 'all' // Added for better reliability
  };

  var _audioTrack;

  var peers_conns = [];
  var peers_con_ids = [];

  var _remoteVideoStreams = [];
  var _remoteAudioStreams = [];

  var _localVideoPlayer;

  var _rtpVideoSenders = [];
  var _rtpAudioSenders = [];

  var _serverFn;

  var VideoStates = {
    None: 0,
    Camera: 1,
    ScreenShare: 2,
  };
  var _videoState = VideoStates.None;
  var _videoCamSSTrack;
  var _isAudioMute = true;
  var _my_connid = "";

  async function _init(serFn, myconnid) {
    _my_connid = myconnid;
    _serverFn = serFn;
    _localVideoPlayer = document.getElementById("localVideoCtr");

    eventBinding();
  }

  function eventBinding() {
    $("#btnMuteUnmute").on("click", async function () {
      if (!_audioTrack) {
        await startwithAudio();
      }

      if (!_audioTrack) {
        alert("problem with audio permission");
        return;
      }

      if (_isAudioMute) {
        _audioTrack.enabled = true;
        $(this).html('<span class="material-icons">mic</span>');
        AddUpdateAudioVideoSenders(_audioTrack, _rtpAudioSenders);
      } else {
        _audioTrack.enabled = false;
        $(this).html('<span class="material-icons">mic_off</span>');

        RemoveAudioVideoSenders(_rtpAudioSenders);
      }
      _isAudioMute = !_isAudioMute;

      console.log("Audio track state:", _audioTrack.enabled ? "unmuted" : "muted");
    });
    $("#btnStartStopCam").on("click", async function () {
      if (_videoState == VideoStates.Camera) {
        //Stop case
        await ManageVideo(VideoStates.None);
      } else {
        await ManageVideo(VideoStates.Camera);
      }
    });
    $("#btnStartStopScreenshare").on("click", async function () {
      if (_videoState == VideoStates.ScreenShare) {
        //Stop case
        await ManageVideo(VideoStates.None);
      } else {
        await ManageVideo(VideoStates.ScreenShare);
      }
    });
  }
  //Camera or Screen Share or None
  async function ManageVideo(_newVideoState) {
    if (_newVideoState == VideoStates.None) {
      $("#btnStartStopCam").html(
        '<span class="material-icons">videocam_off</span>'
      );
      $("#btnStartStopScreenshare").html(
        '<div class="present-now-wrap d-flex justify-content-center flex-column align-items-center  mr-5 cursor-pointer" id="btnStartStopScreenshare" style="height:10vh;"><div class="present-now-icon"><span class="material-icons">present_to_all</span></div><div>Present Now</div></div>'
      );
      _videoState = _newVideoState;

      ClearCurrentVideoCamStream(_rtpVideoSenders);
      return;
    }

    try {
      var vstream = null;

      if (_newVideoState == VideoStates.Camera) {
        vstream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: false,
        }).catch(error => {
          console.error("Camera access error:", error);
          throw error;
        });
      } else if (_newVideoState == VideoStates.ScreenShare) {
        vstream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          },
          audio: false,
        }).catch(error => {
          console.error("Screen share error:", error);
          throw error;
        });

        vstream.oninactive = (e) => {
          console.log("Screen share ended");
          ClearCurrentVideoCamStream(_rtpVideoSenders);
          $("#btnStartStopScreenshare").html(
            '<div class="present-now-wrap d-flex justify-content-center flex-column align-items-center  mr-5 cursor-pointer" id="btnStartStopScreenshare" style="height:10vh;"><div class="present-now-icon"><span class="material-icons">present_to_all</span></div><div>Present Now</div></div>'
          );
        };
      }

      ClearCurrentVideoCamStream(_rtpVideoSenders);

      _videoState = _newVideoState;

      if (_newVideoState == VideoStates.Camera) {
        $("#btnStartStopCam").html(
          '<span class="material-icons">videocam</span>'
        );
        $("#btnStartStopScreenshare").text("Screen Share");
      } else if (_newVideoState == VideoStates.ScreenShare) {
        $("#btnStartStopCam").html(
          '<span class="material-icons">videocam_off</span>'
        );
        $("#btnStartStopScreenshare").html(
          '<div class="present-now-wrap d-flex justify-content-center flex-column align-items-center  mr-5 cursor-pointer" id="btnStartStopScreenshare" style="height:10vh;"><div class="present-now-icon"><span class="material-icons">present_to_all</span></div><div>Stop Present Now</div></div>'
        );
      }

      if (vstream && vstream.getVideoTracks().length > 0) {
        _videoCamSSTrack = vstream.getVideoTracks()[0];

        if (_videoCamSSTrack) {
          _localVideoPlayer.srcObject = new MediaStream([_videoCamSSTrack]);
          _localVideoPlayer.play().catch(e => console.error("Local video play error:", e));

          // Add track event handlers
          _videoCamSSTrack.onended = () => {
            console.log("Local video track ended");
            ClearCurrentVideoCamStream(_rtpVideoSenders);
          };
          
          _videoCamSSTrack.onmute = () => console.log("Local video track muted");
          _videoCamSSTrack.onunmute = () => console.log("Local video track unmuted");

          AddUpdateAudioVideoSenders(_videoCamSSTrack, _rtpVideoSenders);
        }
      }
    } catch (e) {
      console.error("Video management error:", e);
      alert("Failed to access camera/screen: " + e.message);
      return;
    }
  }

  function ClearCurrentVideoCamStream(rtpVideoSenders) {
    if (_videoCamSSTrack) {
      _videoCamSSTrack.stop();
      _videoCamSSTrack = null;
      _localVideoPlayer.srcObject = null;

      RemoveAudioVideoSenders(rtpVideoSenders);
    }
  }

  async function RemoveAudioVideoSenders(rtpSenders) {
    for (var con_id in peers_con_ids) {
      if (rtpSenders[con_id] && IsConnectionAvailable(peers_conns[con_id])) {
        try {
          peers_conns[con_id].removeTrack(rtpSenders[con_id]);
          rtpSenders[con_id] = null;
        } catch (e) {
          console.error("Error removing track:", e);
        }
      }
    }
  }

  async function AddUpdateAudioVideoSenders(track, rtpSenders) {
    for (var con_id in peers_con_ids) {
      if (IsConnectionAvailable(peers_conns[con_id])) {
        try {
          if (rtpSenders[con_id] && rtpSenders[con_id].track) {
            await rtpSenders[con_id].replaceTrack(track);
          } else {
            rtpSenders[con_id] = peers_conns[con_id].addTrack(track);
          }
          console.log(`Track ${track.kind} added/updated for connection ${con_id}`);
        } catch (e) {
          console.error(`Error adding/updating track for ${con_id}:`, e);
        }
      }
    }
  }

  async function startwithAudio() {
    try {
      var astream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
      }).catch(error => {
        console.error("Microphone access error:", error);
        throw error;
      });

      if (!astream.getAudioTracks().length) {
        throw new Error("No audio tracks available");
      }

      _audioTrack = astream.getAudioTracks()[0];

      _audioTrack.onmute = function (e) {
        console.log("Audio muted", e);
      };
      _audioTrack.onunmute = function (e) {
        console.log("Audio unmuted", e);
      };
      _audioTrack.onended = function () {
        console.log("Audio track ended");
        _audioTrack = null;
      };

      _audioTrack.enabled = false;
      console.log("Audio track acquired successfully");
    } catch (e) {
      console.error("Audio acquisition failed:", e);
      alert("Microphone access is required. Please check permissions and try again.");
      return;
    }
  }

  async function createConnection(connid) {
    console.log(`Creating connection for: ${connid}`);
    var connection = new RTCPeerConnection(iceConfiguration);
    
    connection.onicecandidate = function (event) {
      console.log("onicecandidate", event.candidate);
      if (event.candidate) {
        _serverFn(
          JSON.stringify({
            iceCandidate: event.candidate,
          }),
          connid
        );
      }
    };
    
    connection.onicecandidateerror = function (event) {
      console.error("onicecandidateerror", event);
    };
    
    connection.onicegatheringstatechange = function (event) {
      console.log("onicegatheringstatechange", connection.iceGatheringState);
    };
    
    connection.onnegotiationneeded = async function (event) {
      console.log("onnegotiationneeded", event);
      await _createOffer(connid);
    };
    
    connection.onconnectionstatechange = function (event) {
      const state = event.currentTarget.connectionState;
      console.log(`onconnectionstatechange for ${connid}:`, state);
      
      if (state === "connected") {
        console.log(`Connected to ${connid}`);
      } else if (state === "disconnected" || state === "failed") {
        console.log(`Connection ${connid} ${state}, attempting reconnection...`);
        // Attempt reconnection after delay
        setTimeout(() => {
          if (peers_conns[connid] && peers_conns[connid].connectionState === "disconnected") {
            _createOffer(connid);
          }
        }, 2000);
      }
    };
    
    // New remote media stream was added
    connection.ontrack = function (event) {
      console.log(`Track received from ${connid}:`, event.track.kind);
      
      if (!_remoteVideoStreams[connid]) {
        _remoteVideoStreams[connid] = new MediaStream();
      }

      if (!_remoteAudioStreams[connid])
        _remoteAudioStreams[connid] = new MediaStream();

      if (event.track.kind == "video") {
        _remoteVideoStreams[connid]
          .getVideoTracks()
          .forEach((t) => _remoteVideoStreams[connid].removeTrack(t));
        _remoteVideoStreams[connid].addTrack(event.track);

        var _remoteVideoPlayer = document.getElementById("v_" + connid);
        if (_remoteVideoPlayer) {
          _remoteVideoPlayer.srcObject = null;
          _remoteVideoPlayer.srcObject = _remoteVideoStreams[connid];
          _remoteVideoPlayer.load();
          _remoteVideoPlayer.play().catch(e => console.error("Remote video play error:", e));
        }

        // Add track event handlers
        event.track.onended = () => {
          console.log(`Remote video track ended from ${connid}`);
          if (_remoteVideoPlayer) _remoteVideoPlayer.srcObject = null;
        };
        event.track.onmute = () => console.log(`Remote video muted from ${connid}`);
        event.track.onunmute = () => console.log(`Remote video unmuted from ${connid}`);

      } else if (event.track.kind == "audio") {
        var _remoteAudioPlayer = document.getElementById("a_" + connid);
        _remoteAudioStreams[connid]
          .getAudioTracks()
          .forEach((t) => _remoteAudioStreams[connid].removeTrack(t));
        _remoteAudioStreams[connid].addTrack(event.track);
        
        if (_remoteAudioPlayer) {
          _remoteAudioPlayer.srcObject = null;
          _remoteAudioPlayer.srcObject = _remoteAudioStreams[connid];
          _remoteAudioPlayer.load();
        }

        // Add track event handlers
        event.track.onended = () => console.log(`Remote audio track ended from ${connid}`);
        event.track.onmute = () => console.log(`Remote audio muted from ${connid}`);
        event.track.onunmute = () => console.log(`Remote audio unmuted from ${connid}`);
      }
    };

    connection.onsignalingstatechange = function() {
      console.log(`Signaling state for ${connid}:`, connection.signalingState);
    };

    peers_con_ids[connid] = connid;
    peers_conns[connid] = connection;

    if (
      _videoState == VideoStates.Camera ||
      _videoState == VideoStates.ScreenShare
    ) {
      if (_videoCamSSTrack) {
        AddUpdateAudioVideoSenders(_videoCamSSTrack, _rtpVideoSenders);
      }
    }

    if (_audioTrack) {
      AddUpdateAudioVideoSenders(_audioTrack, _rtpAudioSenders);
    }

    return connection;
  }

  async function _createOffer(connid) {
    if (!peers_conns[connid]) {
      console.error(`No connection found for ${connid} when creating offer`);
      return;
    }

    var connection = peers_conns[connid];
    console.log("connection.signalingState:" + connection.signalingState);
    
    try {
      var offer = await connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await connection.setLocalDescription(offer);
      
      //Send offer to Server
      _serverFn(
        JSON.stringify({
          offer: connection.localDescription,
        }),
        connid
      );
    } catch (e) {
      console.error("Error creating offer:", e);
    }
  }

  async function exchangeSDP(message, from_connid) {
    console.log("Received SDP message from:", from_connid);
    try {
      message = JSON.parse(message);

      if (message.answer) {
        console.log("Processing answer from:", from_connid);
        if (!peers_conns[from_connid]) {
          console.error("No connection found for answer");
          return;
        }
        
        await peers_conns[from_connid].setRemoteDescription(
          new RTCSessionDescription(message.answer)
        );
        console.log("Answer processed successfully");

      } else if (message.offer) {
        console.log("Processing offer from:", from_connid);

        if (!peers_conns[from_connid]) {
          await createConnection(from_connid);
        }

        await peers_conns[from_connid].setRemoteDescription(
          new RTCSessionDescription(message.offer)
        );
        var answer = await peers_conns[from_connid].createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await peers_conns[from_connid].setLocalDescription(answer);
        
        _serverFn(
          JSON.stringify({
            answer: answer,
          }),
          from_connid,
          _my_connid
        );
        console.log("Answer sent successfully");

      } else if (message.iceCandidate) {
        console.log("Processing ICE candidate from:", from_connid);
        if (!peers_conns[from_connid]) {
          await createConnection(from_connid);
        }

        try {
          await peers_conns[from_connid].addIceCandidate(message.iceCandidate);
          console.log("ICE candidate added successfully");
        } catch (e) {
          console.error("Error adding ICE candidate:", e);
        }
      }
    } catch (e) {
      console.error("Error processing SDP message:", e);
    }
  }

  function IsConnectionAvailable(connection) {
    if (!connection) {
      console.log("Connection is null");
      return false;
    }
    
    const state = connection.connectionState;
    console.log(`Connection state check: ${state}`);
    
    return state === "new" || state === "connecting" || state === "connected";
  }

  function closeConnection(connid) {
    console.log(`Closing connection: ${connid}`);
    peers_con_ids[connid] = null;

    if (peers_conns[connid]) {
      try {
        peers_conns[connid].close();
      } catch (e) {
        console.error("Error closing connection:", e);
      }
      peers_conns[connid] = null;
    }
    
    if (_remoteAudioStreams[connid]) {
      _remoteAudioStreams[connid].getTracks().forEach((t) => {
        try {
          if (t.stop) t.stop();
        } catch (e) {
          console.error("Error stopping audio track:", e);
        }
      });
      _remoteAudioStreams[connid] = null;
    }

    if (_remoteVideoStreams[connid]) {
      _remoteVideoStreams[connid].getTracks().forEach((t) => {
        try {
          if (t.stop) t.stop();
        } catch (e) {
          console.error("Error stopping video track:", e);
        }
      });
      _remoteVideoStreams[connid] = null;
    }
  }
  
  return {
    init: async function (serverFn, my_connid) {
      await _init(serverFn, my_connid);
    },
    ExecuteClientFn: async function (data, from_connid) {
      await exchangeSDP(data, from_connid);
    },
    createNewConnection: async function (connid) {
      await createConnection(connid);
    },
    closeExistingConnection: function (connid) {
      closeConnection(connid);
    },
    getConnectionState: function(connid) {
      return peers_conns[connid] ? peers_conns[connid].connectionState : 'none';
    }
  };
})();

var MyApp = (function () {
  var socket = null;
  var socket_url = "https://tpsc-final.onrender.com";
  var meeting_id = "";
  var user_id = "";
  
  // Mediasoup variables
  var device = null;
  var sendTransport = null;
  var recvTransport = null;
  var producers = new Map();
  var consumers = new Map();
  var useMediasoup = true;

  async function init(uid, mid) {
    user_id = uid;
    meeting_id = mid;

    $("#me h2").text(user_id + "(Me)");
    document.title = user_id;

    // Check if we're on HTTPS (required for media devices)
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      alert("Warning: This app requires HTTPS for media devices to work properly. Some features may not work.");
    }

    // Initialize mediasoup device if available
    try {
      if (typeof mediasoupClient !== 'undefined') {
        device = new mediasoupClient.Device();
        await SignalServerEventBinding();
        EventBinding();
      } else {
        throw new Error('Mediasoup client not available');
      }
    } catch (error) {
      console.error('Error initializing mediasoup device:', error);
      useMediasoup = false;
      // Fallback to original WebRTC implementation
      await OriginalWebRTCFallback();
    }
  }

  async function SignalServerEventBinding() {
    console.log("Connecting to server:", socket_url);
    socket = io.connect(socket_url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log("Socket connected successfully");
      if (socket.connected) {
        if (user_id != "" && meeting_id != "") {
          socket.emit("userconnect", {
            dsiplayName: user_id,
            meetingid: meeting_id,
          });
          console.log("Sent userconnect event");
        }
      }
    });

    socket.on('connect_error', (error) => {
      console.error("Socket connection error:", error);
    });

    socket.on('disconnect', (reason) => {
      console.log("Socket disconnected:", reason);
    });

    // Request router RTP capabilities for mediasoup
    if (useMediasoup) {
      try {
        socket.emit('getRouterRtpCapabilities', (data) => {
          if (data.error) {
            console.error('Error getting router capabilities:', data.error);
            useMediasoup = false;
            OriginalWebRTCFallback();
            return;
          }

          device.load({ routerRtpCapabilities: data.rtpCapabilities })
            .then(() => {
              createSendTransport();
            })
            .catch(error => {
              console.error('Error loading device:', error);
              useMediasoup = false;
              OriginalWebRTCFallback();
            });
        });
      } catch (error) {
        console.error('Error setting up mediasoup:', error);
        useMediasoup = false;
        OriginalWebRTCFallback();
      }
    }

    // Handle new producers from other users (mediasoup)
    socket.on('newProducer', async ({ producerId, kind, socketId }) => {
      if (!useMediasoup || socketId === socket.id) return;
      
      if (!recvTransport) {
        createRecvTransport().then(() => {
          consumeProducer(producerId, kind);
        });
      } else {
        consumeProducer(producerId, kind);
      }
    });

    // Handle existing producers when joining (mediasoup)
    socket.on('existingProducers', async (producerList) => {
      if (!useMediasoup) return;
      
      for (const { producerId, kind, socketId } of producerList) {
        if (socketId !== socket.id) {
          if (!recvTransport) {
            await createRecvTransport();
          }
          await consumeProducer(producerId, kind);
        }
      }
    });

    // Handle producer closure (mediasoup)
    socket.on('producerClosed', ({ producerId }) => {
      if (!useMediasoup) return;
      
      const consumer = consumers.get(producerId);
      if (consumer) {
        consumer.close();
        consumers.delete(producerId);
        $(`#remote_${producerId}`).remove();
      }
    });

    // Original socket event handlers (for fallback)
    socket.on("reset", function () {
      location.reload();
    });

    socket.on("exchangeSDP", async function (data) {
      console.log("Received SDP exchange request");
      if (!useMediasoup) {
        await WrtcHelper.ExecuteClientFn(data.message, data.from_connid);
      }
    });

    socket.on("informAboutNewConnection", function (data) {
      console.log("New connection from:", data.other_user_id);
      if (!useMediasoup) {
        AddNewUser(data.other_user_id, data.connId, data.userNumber);
        WrtcHelper.createNewConnection(data.connId);
      }
    });

    socket.on("informAboutConnectionEnd", function (data) {
      console.log("Connection ended:", data.connId);
      if (!useMediasoup) {
        $("#" + data.connId).remove();
        $(".participant-count").text(data.userCoun);
        $("#participant_" + data.connId).remove();
        WrtcHelper.closeExistingConnection(data.connId);
      }
    });

    socket.on("showChatMessage", function (data) {
      var time = new Date();
      var lTime = time.toLocaleString("en-US", {
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });

      var div = $("<div>").html(
        "<span class='font-weight-bold mr-3' style='color:black'>" +
          data.from +
          "</span> " +
          lTime +
          "</br>" +
          data.message
      );
      $("#messages").append(div);
    });

    socket.on("showFileMessage", function (data) {
      var attachFileArea = document.querySelector(".show-attach-file");
      attachFileArea.innerHTML +=
        "<div class='left-align' style='display:flex;align-items:center;'><img src='assets/images/other.jpg' style='height:40px;width:40px;' class='caller-image circle'><div style='font-weight:600;margin:0 5px;'>" +
        data.username +
        "</div>: <div><a style='color:#007bff;' href='" +
        data.FileePath +
        "' download>" +
        data.fileeName +
        "</a></div></div><br/>";
    });

    socket.on("userconnected", function (other_users) {
      console.log("Users connected:", other_users);
      if (useMediasoup) {
        // For mediasoup, we handle connections differently
        return;
      }
      
      var userNumber = other_users.length;
      var userNumb = userNumber + 1;
      $("#divUsers .other").remove();
      if (other_users) {
        for (var i = 0; i < other_users.length; i++) {
          AddNewUser(
            other_users[i].user_id,
            other_users[i].connectionId,
            userNumb
          );
          WrtcHelper.createNewConnection(other_users[i].connectionId);
        }
      }
      $(".toolbox").show();
      $("#messages").show();
      $("#divUsers").show();
    });

    // Handle mediasoup-specific connection event
    socket.on('userConnectedMediasoup', (data) => {
      if (useMediasoup) {
        $(".participant-count").text(data.participantCount);
        
        // If we're the new user, request existing producers
        if (data.isNewUser) {
          socket.emit('getProducers');
        }
      }
    });

    return new Promise((resolve) => {
      socket.on('connected', resolve);
    });
  }

  async function createSendTransport() {
    try {
      socket.emit('createWebRtcTransport', { consuming: false }, (data) => {
        if (data.error) {
          console.error('Error creating send transport:', data.error);
          useMediasoup = false;
          OriginalWebRTCFallback();
          return;
        }

        sendTransport = device.createSendTransport(data);
        
        sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          socket.emit('connectTransport', {
            transportId: sendTransport.id,
            dtlsParameters
          }, (response) => {
            if (response.error) {
              errback(response.error);
            } else {
              callback();
            }
          });
        });

        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          socket.emit('produce', {
            transportId: sendTransport.id,
            kind,
            rtpParameters
          }, (response) => {
            if (response.error) {
              errback(response.error);
            } else {
              callback({ id: response.id });
            }
          });
        });

        // Start producing audio and video
        startMediaProduction();
      });
    } catch (error) {
      console.error('Error creating send transport:', error);
      useMediasoup = false;
      OriginalWebRTCFallback();
    }
  }

  async function createRecvTransport() {
    return new Promise((resolve, reject) => {
      socket.emit('createWebRtcTransport', { consuming: true }, (data) => {
        if (data.error) {
          console.error('Error creating recv transport:', data.error);
          reject(data.error);
          return;
        }

        recvTransport = device.createRecvTransport(data);
        
        recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          socket.emit('connectTransport', {
            transportId: recvTransport.id,
            dtlsParameters
          }, (response) => {
            if (response.error) {
              errback(response.error);
            } else {
              callback();
            }
          });
        });

        resolve();
      });
    });
  }

  async function startMediaProduction() {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).catch(error => {
        console.error('Media access error:', error);
        throw error;
      });

      // Produce video
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const videoProducer = await sendTransport.produce({ track: videoTrack });
        producers.set('video', videoProducer);
        
        // Show local video
        const localVideo = document.getElementById("localVideoCtr");
        if (localVideo) {
          localVideo.srcObject = new MediaStream([videoTrack]);
          localVideo.play().catch(e => console.error('Local video play error:', e));
        }
      }

      // Produce audio
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const audioProducer = await sendTransport.produce({ track: audioTrack });
        producers.set('audio', audioProducer);
        
        // Handle audio mute/unmute
        $("#btnMuteUnmute").off('click').on("click", function () {
          if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            $(this).html(
              audioTrack.enabled 
                ? '<span class="material-icons">mic</span>'
                : '<span class="material-icons">mic_off</span>'
            );
            console.log('Audio', audioTrack.enabled ? 'unmuted' : 'muted');
          }
        });
      }

    } catch (error) {
      console.error('Error starting media production:', error);
      alert('Failed to access camera/microphone. Please check permissions.');
    }
  }

  async function consumeProducer(producerId, kind) {
    try {
      // Check if we already have a consumer for this producer
      if (consumers.has(producerId)) return;

      // Consume the producer
      const { rtpCapabilities } = device;
      const consumer = await recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true
      });

      consumers.set(producerId, consumer);

      // Resume the consumer
      socket.emit('resumeConsumer', { consumerId: consumer.id }, (response) => {
        if (!response.error) {
          consumer.resume();
        }
      });

      // Get the track from the consumer
      const { track } = consumer;

      // Create a new video element for remote video
      if (kind === 'video') {
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remote_video_${producerId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.muted = false;
        remoteVideo.srcObject = new MediaStream([track]);
        
        // Add to DOM
        const remoteVideoContainer = document.createElement('div');
        remoteVideoContainer.className = 'userbox div-center-column other';
        remoteVideoContainer.id = `remote_${producerId}`;
        remoteVideoContainer.style.display = 'block';
        
        const usernameHeader = document.createElement('h2');
        usernameHeader.className = 'display-center';
        usernameHeader.style.fontSize = '14px';
        usernameHeader.textContent = `Remote User`;
        
        const videoContainer = document.createElement('div');
        videoContainer.className = 'display-center';
        videoContainer.appendChild(remoteVideo);
        
        remoteVideoContainer.appendChild(usernameHeader);
        remoteVideoContainer.appendChild(videoContainer);
        
        document.getElementById('divUsers').appendChild(remoteVideoContainer);
        
        // Also add to participants list
        $(".in-call-wrap-up").append(
          `<div class="in-call-wrap d-flex justify-content-between align-items-center mb-3" id="participant_${producerId}">
            <div class="participant-img-name-wrap display-center cursor-pointer">
              <div class="participant-img">
                <img src="images/me2.png" alt="" class="border border-secondary" style="height: 40px;width: 40px;border-radius: 50%;">
              </div>
              <div class="participant-name ml-2">Remote User</div>
            </div>
            <div class="participant-action-wrap display-center">
              <div class="participant-action-dot display-center mr-2 cursor-pointer">
                <span class="material-icons">more_vert</span>
              </div>
              <div class="participant-action-pin display-center cursor-pointer">
                <span class="material-icons">push_pin</span>
              </div>
            </div>
          </div>`
        );
      }

    } catch (error) {
      console.error('Error consuming producer:', error);
    }
  }

  async function OriginalWebRTCFallback() {
    // Fallback to the original WebRTC implementation
    console.log("Falling back to standard WebRTC");
    WrtcHelper.init(function(data, to_connid) {
      socket.emit("exchangeSDP", {
        message: data,
        to_connid: to_connid,
      });
    }, socket.id);
  }

  function EventBinding() {
    $("#btnResetMeeting").on("click", function () {
      socket.emit("reset");
    });

    $("#btnsend").on("click", function () {
      const message = $("#msgbox").val().trim();
      if (message) {
        socket.emit("sendMessage", message);
        $("#msgbox").val("");
      }
    });

    // Add Enter key support for chat
    $("#msgbox").on("keypress", function(e) {
      if (e.which === 13) {
        e.preventDefault();
        $("#btnsend").click();
      }
    });

    $("#divUsers").on("dblclick", "video", function () {
      this.requestFullscreen();
    });

    // Add connection status monitoring
    setInterval(() => {
      if (!useMediasoup) {
        for (const connid in peers_conns) {
          const state = WrtcHelper.getConnectionState(connid);
          console.log(`Connection ${connid} state: ${state}`);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  function AddNewUser(other_user_id, connId, userNum) {
    var $newDiv = $("#otherTemplate").clone();

                </div>
            </div>
          </div>`
        );

      } else if (kind === 'audio') {
        const remoteAudio = document.createElement('audio');
        remoteAudio.id = `remote_audio_${producerId}`;
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.srcObject = new MediaStream([track]);
        document.body.appendChild(remoteAudio);
      }

      consumer.on('transportclose', () => {
        console.log('Consumer transport closed');
        consumer.close();
        consumers.delete(producerId);
        $(`#remote_${producerId}`).remove();
        $(`#participant_${producerId}`).remove();
      });

      consumer.on('producerclose', () => {
        console.log('Producer closed');
        consumer.close();
        consumers.delete(producerId);
        $(`#remote_${producerId}`).remove();
        $(`#participant_${producerId}`).remove();
      });

    } catch (error) {
      console.error('Error consuming producer:', error);
    }
  }

  async function OriginalWebRTCFallback() {
    console.log('Falling back to original WebRTC implementation');
    try {
      await WrtcHelper.init(function (data, to_connid) {
        socket.emit("exchangeSDP", { message: data, to_connid });
      }, user_id);

      EventBinding();
    } catch (error) {
      console.error('Error initializing WebRTC fallback:', error);
    }
  }

  function EventBinding() {
    $("#btnsend").on("click", function () {
      var msgData = $("#msgbox").val();
      socket.emit("sendMessage", msgData);
      $("#msgbox").val("");
    });

    $("#msgbox").on("keypress", function (e) {
      if (e.which === 13 && !e.shiftKey) {
        e.preventDefault();
        $("#btnsend").click();
      }
    });

    $("#btnAttachment").on("change", function () {
      var file = this.files[0];
      if (!file) return;
      var formData = new FormData();
      formData.append("file", file);
      formData.append("meeting_id", meeting_id);
      formData.append("username", user_id);
      $.ajax({
        url: socket_url + "/upload",
        type: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function () {
          console.log("File uploaded successfully");
        },
        error: function (err) {
          console.error("File upload error:", err);
        },
      });
    });
  }

  function AddNewUser(other_user_id, connId, userNumber) {
    var newDivId = $("#otherTemplate").clone();
    newDivId = newDivId.attr("id", connId).addClass("other");
    newDivId.find("h2").text(other_user_id);
    newDivId.find("video").attr("id", "v_" + connId);
    newDivId.find("audio").attr("id", "a_" + connId);
    newDivId.show();
    $("#divUsers").append(newDivId);

    $(".in-call-wrap-up").append(
      `<div class="in-call-wrap d-flex justify-content-between align-items-center mb-3" id="participant_${connId}">
        <div class="participant-img-name-wrap display-center cursor-pointer">
          <div class="participant-img">
            <img src="images/me2.png" alt="" class="border border-secondary" style="height: 40px;width: 40px;border-radius: 50%;">
          </div>
          <div class="participant-name ml-2">${other_user_id}</div>
        </div>
        <div class="participant-action-wrap display-center">
          <div class="participant-action-dot display-center mr-2 cursor-pointer">
            <span class="material-icons">more_vert</span>
          </div>
        </div>
      </div>`
    );
    $(".participant-count").text(userNumber);
  }

  return {
    init: init,
  };
})();
