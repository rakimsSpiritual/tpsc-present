const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/signin.hbs')); // Or use your template engine
});

// --- WebRTC signaling via Socket.IO ---
const meetings = {}; // { meetingID: [userIDs] }

io.on('connection', socket => {
    console.log('A user connected:', socket.id);

    // Join meeting
    socket.on('joinMeeting', ({ meetingID, userID }) => {
        socket.join(meetingID);
        socket.userID = userID;
        socket.meetingID = meetingID;

        if (!meetings[meetingID]) meetings[meetingID] = [];
        const participants = meetings[meetingID];

        // Send existing participants to new user
        socket.emit('existingParticipants', participants);

        // Notify others
        socket.to(meetingID).emit('userJoined', { userID });

        // Add user to meeting list
        if (!participants.includes(userID)) participants.push(userID);

        console.log(`User ${userID} joined meeting ${meetingID}`);
    });

    // Signal data
    socket.on('signal', ({ to, from, data }) => {
        // Find socket of the target user in same meeting
        const room = io.sockets.adapter.rooms.get(socket.meetingID);
        if (!room) return;
        room.forEach(sid => {
            const s = io.sockets.sockets.get(sid);
            if (s.userID === to) {
                s.emit('signal', { from, data });
            }
        });
    });

    // Chat messages
    socket.on('sendMessage', ({ meetingID, user, message }) => {
        io.to(meetingID).emit('newMessage', { user, message });
    });

    // Disconnect
    socket.on('disconnect', () => {
        const { meetingID, userID } = socket;
        if (meetingID && userID && meetings[meetingID]) {
            meetings[meetingID] = meetings[meetingID].filter(u => u !== userID);
            // Notify others
            socket.to(meetingID).emit('userLeft', { userID });
        }
        console.log('A user disconnected:', socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
