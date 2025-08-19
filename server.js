// server.js
const express = require("express");
const fs = require("fs");
const https = require("https");
const { Server } = require("socket.io");
const path = require("path");

const app = express();

// --- HTTPS setup ---
const options = {
  key: fs.existsSync("key.pem") ? fs.readFileSync("key.pem") : null,
  cert: fs.existsSync("cert.pem") ? fs.readFileSync("cert.pem") : null,
};

const server = options.key && options.cert
  ? https.createServer(options, app)
  : require("http").createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// HBS setup
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// Routes
app.get("/", (req, res) => res.redirect("/sign"));
app.get("/sign", (req, res) => res.render("signin"));
app.get("/appHome", (req, res) => res.render("appHome"));

// --- Meeting storage ---
const meetings = {}; // { meetingID: { socketID: userID } }

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins a meeting
  socket.on("joinMeeting", ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;

    if (!meetings[meetingID]) meetings[meetingID] = {};

    // Send existing participants to the new user
    const existingParticipants = Object.values(meetings[meetingID]);
    socket.emit("existingParticipants", existingParticipants);

    // Add new user
    meetings[meetingID][socket.id] = userID;

    // Notify everyone else about new participant
    socket.to(meetingID).emit("newParticipant", { userID });
  });

  // Forward WebRTC signaling data
  socket.on("signal", ({ targetID, fromID, signal }) => {
    io.to(targetID).emit("signal", { fromID, signal });
  });

  // Chat messages
  socket.on("sendMessage", ({ meetingID, userID, msg }) => {
    io.to(meetingID).emit("receiveMessage", { userID, msg });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const { meetingID, userID } = socket;
    if (meetingID && meetings[meetingID]) {
      delete meetings[meetingID][socket.id];
      socket.to(meetingID).emit("participantLeft", { userID });
    }
    console.log("User disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
