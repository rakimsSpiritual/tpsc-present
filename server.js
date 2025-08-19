const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- force HTTPS redirect on Render ---
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// static + views
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.get("/", (req, res) => {
  res.render("appHome");
});

// --- socket.io signaling for WebRTC ---
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ userID, meetingID }) => {
    socket.join(meetingID);
    socket.to(meetingID).emit("new-user", { userID, id: socket.id });
  });

  socket.on("signal", ({ target, data }) => {
    io.to(target).emit("signal", { id: socket.id, data });
  });

  socket.on("sendMessage", (msg) => {
    io.emit("receiveMessage", { user: socket.id, msg });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    io.emit("user-disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
