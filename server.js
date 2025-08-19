const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.get("/", (req, res) => res.redirect("/sign"));
app.get("/sign", (req, res) => res.render("signin"));
app.get("/appHome", (req, res) => res.render("appHome"));

const meetings = {}; // { meetingID: { socketID: userID } }

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("joinMeeting", ({ meetingID, userID }) => {
    socket.join(meetingID);
    socket.userID = userID;
    socket.meetingID = meetingID;

    if (!meetings[meetingID]) meetings[meetingID] = {};
    meetings[meetingID][socket.id] = userID;

    // Send updated participant list to all
    io.to(meetingID).emit("newParticipant", {
      participants: Object.values(meetings[meetingID]),
      userID,
      socketID: socket.id
    });
  });

  socket.on("signal", ({ targetID, fromID, signal }) => {
    io.to(targetID).emit("signal", { fromID, signal });
  });

  socket.on("sendMessage", ({ meetingID, userID, msg }) => {
    io.to(meetingID).emit("receiveMessage", { userID, msg });
  });

  socket.on("disconnect", () => {
    const { meetingID, userID } = socket;
    if (meetingID && meetings[meetingID]) {
      delete meetings[meetingID][socket.id];
      io.to(meetingID).emit("participantLeft", { userID, socketID: socket.id });
    }
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
