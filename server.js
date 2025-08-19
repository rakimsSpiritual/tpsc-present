// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files (CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// HBS setup
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Render the main classroom page
app.get("/", (req, res) => {
  res.redirect("/sign"); // Redirect to signin page if no meetingID
});

app.get("/appHome", (req, res) => {
  res.render("appHome");
});

app.get("/sign", (req, res) => {
  res.render("signin");
});

// Store participants per meeting
const meetings = {}; // { meetingID: [userID1, userID2, ...] }

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("joinMeeting", ({ meetingID, userID }) => {
    socket.join(meetingID);

    // Initialize meeting participants
    if (!meetings[meetingID]) meetings[meetingID] = [];
    meetings[meetingID].push(userID);

    // Attach userID to socket for easy removal on disconnect
    socket.userID = userID;
    socket.meetingID = meetingID;

    // Notify everyone in the meeting
    io.to(meetingID).emit("newParticipant", {
      participants: meetings[meetingID],
      userID,
    });
  });

  socket.on("signal", (data) => {
    // Forward signaling data to the specific user
    io.to(data.to).emit("signal", {
      userID: socket.userID,
      sdp: data.sdp,
      candidate: data.candidate,
    });
  });

  socket.on("sendMessage", ({ meetingID, userID, msg }) => {
    io.to(meetingID).emit("receiveMessage", { userID, msg });
  });

  socket.on("disconnect", () => {
    const { meetingID, userID } = socket;
    if (meetingID && userID && meetings[meetingID]) {
      // Remove user from participants
      meetings[meetingID] = meetings[meetingID].filter((u) => u !== userID);

      // Notify remaining participants
      io.to(meetingID).emit("participantLeft", {
        participants: meetings[meetingID],
        userID,
      });
    }
    console.log("A user disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
