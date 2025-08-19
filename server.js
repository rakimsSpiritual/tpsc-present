require("./models/db");

const express = require("express");
const path = require("path");
const { engine } = require("express-handlebars");
const bodyparser = require("body-parser");
const fileUpload = require("express-fileupload");
const fs = require("fs");
const http = require("http");

const employeeController = require("./controllers/employeeController");
const homeController = require("./controllers/homeController");
const loginController = require("./controllers/loginController");

const app = express();

/* ---------- Force HTTPS on Render (so mic/cam work) ---------- */
app.enable("trust proxy");
app.use((req, res, next) => {
  // On Render, http requests arrive with x-forwarded-proto=http
  if (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});
/* ------------------------------------------------------------- */

app.use(
  bodyparser.urlencoded({
    extended: true,
  })
);
app.use(bodyparser.json());

app.set("views", path.join(__dirname, "/views/"));
app.engine(
  "hbs",
  engine({
    extname: "hbs",
    defaultLayout: "mainLayout",
    layoutsDir: __dirname + "/views/layouts/",
  })
);

app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "hbs");

app.use("/employee", employeeController);
app.use("/", homeController);
app.use("/sign", loginController);

const server = http.createServer(app);
const io = require("socket.io")(server, {
  // Defaults are fine on Render; keeping explicit for clarity
  cors: { origin: true, methods: ["GET", "POST"] },
});

/* ===================== WebRTC Signaling ===================== */

let _userConnections = [];

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("userconnect", (data) => {
    // { dsiplayName, meetingid }
    console.log("userconnect", data.dsiplayName, data.meetingid);

    const other_users = _userConnections.filter((p) => p.meeting_id == data.meetingid);

    _userConnections.push({
      connectionId: socket.id,
      user_id: data.dsiplayName,
      meeting_id: data.meetingid,
    });

    const userCount = _userConnections.filter((p) => p.meeting_id == data.meetingid).length;

    // Inform existing users about the newcomer
    other_users.forEach((v) => {
      socket.to(v.connectionId).emit("informAboutNewConnection", {
        other_user_id: data.dsiplayName,
        connId: socket.id,
        userNumber: userCount,
      });
    });

    // Send list of existing users to the newcomer
    socket.emit("userconnected", other_users);
  });

  socket.on("exchangeSDP", (data) => {
    // { message, to_connid }
    socket.to(data.to_connid).emit("exchangeSDP", {
      message: data.message,
      from_connid: socket.id,
    });
  });

  socket.on("reset", () => {
    const userObj = _userConnections.find((p) => p.connectionId == socket.id);
    if (!userObj) return;

    const meetingid = userObj.meeting_id;
    const list = _userConnections.filter((p) => p.meeting_id == meetingid);
    _userConnections = _userConnections.filter((p) => p.meeting_id != meetingid);

    list.forEach((v) => {
      socket.to(v.connectionId).emit("reset");
    });
    socket.emit("reset");
  });

  socket.on("sendMessage", (msg) => {
    const userObj = _userConnections.find((p) => p.connectionId == socket.id);
    if (!userObj) return;

    const meetingid = userObj.meeting_id;
    const from = userObj.user_id;
    const list = _userConnections.filter((p) => p.meeting_id == meetingid);

    list.forEach((v) => {
      socket.to(v.connectionId).emit("showChatMessage", {
        from,
        message: msg,
        time: getCurrDateTime(),
      });
    });

    socket.emit("showChatMessage", {
      from,
      message: msg,
      time: getCurrDateTime(),
    });
  });

  socket.on("fileTransferToOther", (msg) => {
    // { username, meetingid, FileePath, fileeName }
    const userObj = _userConnections.find((p) => p.connectionId == socket.id);
    if (!userObj) return;

    const meetingid = userObj.meeting_id;
    const list = _userConnections.filter((p) => p.meeting_id == meetingid);

    list.forEach((v) => {
      socket.to(v.connectionId).emit("showFileMessage", {
        from: userObj.user_id,
        username: msg.username,
        meetingid: msg.meetingid,
        FileePath: msg.FileePath,
        fileeName: msg.fileeName,
        time: getCurrDateTime(),
      });
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    const userObj = _userConnections.find((p) => p.connectionId == socket.id);
    if (!userObj) return;

    const meetingid = userObj.meeting_id;
    _userConnections = _userConnections.filter((p) => p.connectionId != socket.id);
    const list = _userConnections.filter((p) => p.meeting_id == meetingid);

    list.forEach((v) => {
      const userCou = _userConnections.filter((p) => p.meeting_id == meetingid).length;
      socket.to(v.connectionId).emit("informAboutConnectionEnd", {
        connId: socket.id,
        userCoun: userCou,
      });
    });
  });
});

function getCurrDateTime() {
  let date_ob = new Date();
  let date = ("0" + date_ob.getDate()).slice(-2);
  let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
  let year = date_ob.getFullYear();
  let hours = date_ob.getHours();
  let minutes = date_ob.getMinutes();
  let seconds = date_ob.getSeconds();
  return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
}

/* -------- File upload & Mongo (unchanged) -------- */
app.use(fileUpload());
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

var gameSchema = new mongoose.Schema({
  title: String,
  creator: String,
  width: Number,
  height: Number,
  fileName: String,
  thumbnailFile: String,
  meetingid: String,
  username: String,
});

var Game = mongoose.model("Game", gameSchema);

app.post("/attachimg_other_info", function (req, res) {
  var meeting_idd = req.body.meeting_id;
  res.send(meeting_idd);
});

app.post("/attachimg", function (req, res) {
  var data = req.body;
  var imageFile = req.files?.zipfile;
  if (!imageFile) return res.status(400).send("No file uploaded");

  var dir = "public/attachment/" + data.meeting_id + "/";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  imageFile.mv(dir + imageFile.name, function (error) {
    if (error) {
      console.log("Couldn't upload the image file", error);
    } else {
      console.log("Image file successfully uploaded.");
    }
  });

  Game.create(
    {
      title: data.title,
      creator: data.creator,
      width: data.width,
      height: data.height,
      thumbnailFile: imageFile.name,
      meetingid: data.meeting_id,
      username: data.username,
    },
    function (error, data) {
      if (error) {
        console.log("There was a problem adding this game to the database");
      } else {
        console.log("Game added to database");
        console.log(data);
      }
    }
  );

  res.send(data.creator);
});

/* ---------------- Start server ---------------- */
server.listen(process.env.PORT || 3000, () => {
  console.log("Express/Socket.IO server running on port", process.env.PORT || 3000);
});
