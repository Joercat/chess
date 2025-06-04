const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');
const path = require('path');

app.use(express.static('public'));

const rooms = new Map();

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms.set(roomCode, {
            players: [socket.id],
            game: new Chess(),
            currentTurn: socket.id
        });
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('roomError', 'Room not found');
            return;
        }
        if (room.players.length >= 2) {
            socket.emit('roomError', 'Room is full');
            return;
        }
        room.players.push(socket.id);
        socket.join(roomCode);
        socket.emit('joinedRoom', roomCode);
        
        if (room.players.length === 2) {
            const white = Math.random() < 0.5 ? room.players[0] : room.players[1];
            const black = room.players.find(id => id !== white);
            room.currentTurn = white;
            io.to(roomCode).emit('gameStart', { white, black });
        }
    });

    socket.on('move', ({ from, to, roomCode }) => {
        // Check if roomCode is provided and valid
        if (!roomCode) {
            socket.emit('moveError', 'Room code is required');
            return;
        }
        
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('moveError', 'Room not found');
            return;
        }
        
        // Check if it's the player's turn
        if (socket.id !== room.currentTurn) {
            socket.emit('moveError', 'Not your turn');
            return;
        }
        
        try {
            // Validate move with chess.js
            const move = room.game.move({ 
                from: from, 
                to: to, 
                promotion: 'q' 
            });
            
            if (move) {
                room.currentTurn = room.players.find(id => id !== socket.id);
                io.to(roomCode).emit('moveMade', {
                    from,
                    to,
                    fen: room.game.fen(),
                    move: move,
                    history: room.game.history()
                });
                
                if (room.game.isGameOver()) {
                    let gameResult;
                    if (room.game.isCheckmate()) {
                        gameResult = `${room.game.turn() === 'w' ? 'Black' : 'White'} wins by checkmate!`;
                    } else if (room.game.isDraw()) {
                        gameResult = 'Game is a draw!';
                    } else {
                        gameResult = 'Game over';
                    }
                    io.to(roomCode).emit('gameOver', gameResult);
                }
            } else {
                // This should not normally happen as chess.js throws on invalid moves
                // But added as an extra safeguard
                socket.emit('moveError', 'Invalid move');
            }
        } catch (error) {
            console.error('Move error:', error);
            socket.emit('moveError', 'Invalid move: ' + error.message);
        }
    });

    socket.on('disconnect', () => {
        for (const [roomCode, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                io.to(roomCode).emit('playerLeft');
                rooms.delete(roomCode);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
