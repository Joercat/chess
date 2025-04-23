const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const rooms = new Map();

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms.set(roomCode, { players: [socket.id], game: new Chess() });
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room && room.players.length < 2) {
            room.players.push(socket.id);
            socket.join(roomCode);
            socket.emit('joinedRoom', roomCode);
            io.to(roomCode).emit('gameStart', { white: room.players[0], black: room.players[1] });
        } else {
            socket.emit('roomError', 'Room not found or full');
        }
    });

    socket.on('move', ({ from, to, roomCode }) => {
        const room = rooms.get(roomCode);
        if (room) {
            const move = room.game.move({ from, to });
            if (move) {
                io.to(roomCode).emit('moveMade', { 
                    from, 
                    to, 
                    fen: room.game.fen(),
                    move: move
                });
            }
        }
    });

    socket.on('disconnect', () => {
        rooms.forEach((room, roomCode) => {
            if (room.players.includes(socket.id)) {
                io.to(roomCode).emit('playerLeft');
                rooms.delete(roomCode);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
