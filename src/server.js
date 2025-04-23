const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { Chess } = require('chess.js');

app.use(express.static('public'));

const rooms = new Map();

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms.set(roomCode, {
            players: [socket.id],
            game: new Chess(),
            currentTurn: socket.id,
            moveHistory: [],
            lastMove: null
        });
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room && room.players.length < 2) {
            room.players.push(socket.id);
            socket.join(roomCode);
            socket.emit('joinedRoom', roomCode);
            io.to(roomCode).emit('gameStart', {
                white: room.players[0],
                black: room.players[1],
                fen: room.game.fen(),
                history: room.moveHistory
            });
        } else {
            socket.emit('roomError', 'Room not found or full');
        }
    });

    socket.on('move', ({ from, to, promotion, roomCode }) => {
        const room = rooms.get(roomCode);
        if (room && socket.id === room.currentTurn) {
            try {
                const moveConfig = { from, to };
                if (promotion) moveConfig.promotion = promotion;
                
                const move = room.game.move(moveConfig);
                if (move) {
                    room.lastMove = move;
                    room.moveHistory.push(move);
                    room.currentTurn = room.players.find(id => id !== socket.id);
                    
                    io.to(roomCode).emit('moveMade', {
                        from,
                        to,
                        fen: room.game.fen(),
                        move: move,
                        history: room.moveHistory
                    });

                    if (room.game.isGameOver()) {
                        let gameResult;
                        if (room.game.isCheckmate()) {
                            gameResult = `${room.game.turn() === 'w' ? 'Black' : 'White'} wins by checkmate!`;
                        } else if (room.game.isDraw()) {
                            if (room.game.isStalemate()) {
                                gameResult = 'Game drawn by stalemate';
                            } else if (room.game.isThreefoldRepetition()) {
                                gameResult = 'Game drawn by threefold repetition';
                            } else if (room.game.isInsufficientMaterial()) {
                                gameResult = 'Game drawn by insufficient material';
                            } else {
                                gameResult = 'Game drawn by fifty-move rule';
                            }
                        }
                        io.to(roomCode).emit('gameOver', gameResult);
                    }
                }
            } catch (error) {
                socket.emit('moveError', 'Invalid move');
            }
        }
    });

    socket.on('resign', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room) {
            const winner = room.players.find(id => id !== socket.id);
            const winnerColor = room.players[0] === winner ? 'White' : 'Black';
            io.to(roomCode).emit('gameOver', `${winnerColor} wins by resignation!`);
        }
    });

    socket.on('newGame', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.game = new Chess();
            room.currentTurn = room.players[0];
            room.moveHistory = [];
            room.lastMove = null;
            io.to(roomCode).emit('gameReset', {
                fen: room.game.fen(),
                turn: room.players[0]
            });
        }
    });

    socket.on('disconnect', () => {
        rooms.forEach((room, roomCode) => {
            if (room.players.includes(socket.id)) {
                io.to(roomCode).emit('playerLeft', {
                    playerId: socket.id,
                    message: 'Opponent disconnected'
                });
                rooms.delete(roomCode);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Chess server running on port ${PORT}`);
});
