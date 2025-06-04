const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');
const path = require('path');

app.use(express.static('public'));

const rooms = new Map();
const disconnectionTimeouts = new Map(); // Track pending room deletions

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms.set(roomCode, {
            players: [socket.id],
            game: new Chess(),
            currentTurn: socket.id,
            playerMapping: new Map() // Track which socket ID belongs to which player
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

        // Check if this socket is reconnecting to an existing room
        const existingPlayerIndex = Array.from(room.playerMapping.values()).indexOf(socket.id);
        if (existingPlayerIndex !== -1) {
            // Player is reconnecting
            socket.join(roomCode);
            socket.emit('reconnected', roomCode);
            io.to(roomCode).emit('playerReconnected');
            
            // Cancel any pending room deletion
            if (disconnectionTimeouts.has(roomCode)) {
                clearTimeout(disconnectionTimeouts.get(roomCode));
                disconnectionTimeouts.delete(roomCode);
            }
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
            
            // Map players to colors for reconnection purposes
            room.playerMapping.set('white', white);
            room.playerMapping.set('black', black);
            
            io.to(roomCode).emit('gameStart', { white, black });
        }
    });

    socket.on('move', ({ from, to, roomCode }) => {
        if (!roomCode) {
            socket.emit('moveError', 'Room code is required');
            return;
        }
        
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('moveError', 'Room not found');
            return;
        }

        if (socket.id !== room.currentTurn) {
            socket.emit('moveError', 'Not your turn');
            return;
        }

        try {
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
                // Notify other players that someone left
                socket.to(roomCode).emit('playerDisconnected', {
                    message: 'Your opponent disconnected. They have 5 minutes to reconnect.',
                    timeLeft: 300 // 5 minutes in seconds
                });

                // Remove the disconnected player from the room but keep the room alive
                room.players = room.players.filter(id => id !== socket.id);

                // Set a 5-minute timeout to delete the room if no one reconnects
                const timeoutId = setTimeout(() => {
                    if (rooms.has(roomCode)) {
                        io.to(roomCode).emit('roomClosed', 'Room closed due to inactivity');
                        rooms.delete(roomCode);
                        disconnectionTimeouts.delete(roomCode);
                    }
                }, 5 * 60 * 1000); // 5 minutes

                disconnectionTimeouts.set(roomCode, timeoutId);
                break;
            }
        }
    });

    // Handle manual reconnection attempts
    socket.on('reconnectToRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('roomError', 'Room not found or expired');
            return;
        }

        // Add player back to the room
        if (!room.players.includes(socket.id)) {
            room.players.push(socket.id);
        }
        
        socket.join(roomCode);
        socket.emit('reconnected', roomCode);
        io.to(roomCode).emit('playerReconnected');

        // Cancel the deletion timeout
        if (disconnectionTimeouts.has(roomCode)) {
            clearTimeout(disconnectionTimeouts.get(roomCode));
            disconnectionTimeouts.delete(roomCode);
        }

        // Send current game state to reconnected player
        socket.emit('gameState', {
            fen: room.game.fen(),
            history: room.game.history(),
            currentTurn: room.currentTurn
        });
    });
});

// Clean up expired timeouts on server restart
process.on('SIGINT', () => {
    for (const timeoutId of disconnectionTimeouts.values()) {
        clearTimeout(timeoutId);
    }
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
