const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

let meetings = {};

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Serve the classroom page
app.get('/', (req, res)=>{
    res.render('appHome'); // your modified HBS
});

io.on('connection', socket=>{
    socket.on('joinMeeting', ({meetingID, userID})=>{
        socket.join(meetingID);
        socket.meetingID = meetingID;
        socket.userID = userID;

        // Notify existing participants
        socket.to(meetingID).emit('newParticipant',{id:userID});

        // Send existing participants to new user
        if(!meetings[meetingID]) meetings[meetingID]=[];
        meetings[meetingID].forEach(id=>{
            socket.emit('newParticipant',{id});
        });
        meetings[meetingID].push(userID);
    });

    socket.on('signal', ({targetID, fromID, signal})=>{
        // send to the target user in same room
        const room = io.sockets.adapter.rooms.get(socket.meetingID);
        if(room){
            room.forEach(sid=>{
                const s = io.sockets.sockets.get(sid);
                if(s.userID===targetID){
                    s.emit('signal',{fromID, signal});
                }
            });
        }
    });

    socket.on('sendMessage', ({meetingID, from, text})=>{
        io.to(meetingID).emit('message',{from,text});
    });

    socket.on('disconnect', ()=>{
        const room = meetings[socket.meetingID];
        if(room){
            meetings[socket.meetingID] = room.filter(id=>id!==socket.userID);
            socket.to(socket.meetingID).emit('participantLeft', socket.userID);
        }
    });
});

server.listen(3000, ()=>console.log('Server running on port 3000'));
