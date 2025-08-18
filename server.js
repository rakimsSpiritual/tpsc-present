// server.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// Serve static files (css, js, assets)
app.use(express.static(path.join(__dirname, 'public')));

// Serve hbs views if you use Express-Handlebars
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Example route
app.get('/', (req, res) => {
    res.render('appHome');
});

// Store meeting participants
let meetings = {}; // { meetingID: [userID1, userID2...] }

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('joinMeeting', ({ meetingID, userID }) => {
        socket.join(meetingID);
        socket.meetingID = meetingID;
        socket.userID = userID;

        // Notify existing participants
        socket.to(meetingID).emit('newParticipant', { id: userID });

        // Send existing participants to new user
        if (!meetings[meetingID]) meetings[meetingID] = [];
        meetings[meetingID].forEach(id => {
            socket.emit('newParticipant', { id });
        });
        meetings[meetingID].push(userID);
        console.log(`${userID} joined meeting ${meetingID}`);
    });

    socket.on('signal', ({ targetID, fromID, signal }) => {
        // send to the target user in the same room
        const room = io.sockets.adapter.rooms.get(socket.meetingID);
        if (room) {
            room.forEach(sid => {
                const s = io.sockets.sockets.get(sid);
                if (s.userID === targetID) {
                    s.emit('signal', { fromID, signal });
                }
            });
        }
    });

    socket.on('sendMessage', ({ meetingID, from, text }) => {
        io.to(meetingID).emit('message', { from, text });
    });

    socket.on('disconnect', () => {
        const room = meetings[socket.meetingID];
        if (room) {
            meetings[socket.meetingID] = room.filter(id => id !== socket.userID);
            socket.to(socket.meetingID).emit('participantLeft', socket.userID);
            console.log(`${socket.userID} left meeting ${socket.meetingID}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
