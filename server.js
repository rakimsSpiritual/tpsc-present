const express = require("express");
const path = require("path");
const { engine } = require("express-handlebars");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const app = express();

require("./models/db");

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(fileUpload());

app.set("views", path.join(__dirname, "/views"));
app.engine(
  "hbs",
  engine({
    extname: "hbs",
    defaultLayout: "mainLayout",
    layoutsDir: path.join(__dirname, "/views/layouts"),
  })
);
app.set("view engine", "hbs");
app.use(express.static(path.join(__dirname, "public")));

// Controllers
const homeController = require("./controllers/homeController");
const loginController = require("./controllers/loginController");
app.use("/", homeController);
app.use("/sign", loginController);

const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Server started on port 3000");
});

// WebRTC Socket.IO signaling
const io = require("socket.io")(server);
let users = [];

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  socket.on("userconnect", (data) => {
    const { dsiplayName, meetingid } = data;
    socket.meetingId = meetingid;
    socket.userName = dsiplayName;
    users.push({ connectionId: socket.id, meetingId: meetingid, userName: dsiplayName });

    const otherUsers = users.filter((u) => u.meetingId === meetingid && u.connectionId !== socket.id);
    socket.emit("userconnected", otherUsers);

    otherUsers.forEach((u) => {
      io.to(u.connectionId).emit("informAboutNewConnection", { other_user_id: dsiplayName, connId: socket.id });
    });
  });

  socket.on("exchangeSDP", (data) => {
    io.to(data.to_connid).emit("exchangeSDP", { from_connid: socket.id, message: data.message });
  });

  socket.on("sendMessage", (msg) => {
    const meetingUsers = users.filter((u) => u.meetingId === socket.meetingId);
    meetingUsers.forEach((u) => io.to(u.connectionId).emit("showChatMessage", { from: socket.userName, message: msg, time: new Date().toLocaleTimeString() }));
  });

  socket.on("disconnect", () => {
    const meetingId = socket.meetingId;
    users = users.filter((u) => u.connectionId !== socket.id);
    const meetingUsers = users.filter((u) => u.meetingId === meetingId);
    meetingUsers.forEach((u) => io.to(u.connectionId).emit("userDisconnected", { connId: socket.id }));
  });
});
