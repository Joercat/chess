const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const sqlite3 = require('sqlite3').verbose();

// --- Database Setup (integrated) ---
const db = new sqlite3.Database('./chess_games.db');

const initializeDB = () => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_code TEXT UNIQUE NOT NULL,
                pgn TEXT,
                status TEXT NOT NULL,
                result TEXT,
                white_player_id TEXT,
                black_player_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    });
    console.log("Database initialized successfully.");
};

// --- Server and Socket.io Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 10000,
    pingTimeout: 5000,
});

const rooms = {};

// Initialize Database on startup
initializeDB();

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    const generateRoomCode = () => {
        let code;
        do {
            code = Math.random().toString(36).substring(2, 8).toUpperCase();
        } while (rooms[code]);
        return code;
    };

    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            players: [socket.id],
            game: new Chess(),
            status: 'waiting'
        };
        socket.join(roomCode);
        
        db.run(
            'INSERT INTO games (room_code, status, white_player_id, pgn) VALUES (?, ?, ?, ?)',
            [roomCode, 'waiting', socket.id, rooms[roomCode].game.pgn()],
            (err) => {
                if (err) return console.error("DB Error:", err.message);
                socket.emit('roomCreated', { roomCode });
            }
        );
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) {
            return socket.emit('roomError', 'Room not found.');
        }
        if (room.players.length >= 2) {
            return socket.emit('roomError', 'Room is full.');
        }

        socket.join(roomCode);
        room.players.push(socket.id);
        room.status = 'active';

        const whitePlayer = room.players[0];
        const blackPlayer = room.players[1];
        
        db.run(
            'UPDATE games SET status = ?, black_player_id = ? WHERE room_code = ?',
            ['active', socket.id, roomCode],
            (err) => {
                if (err) return console.error("DB Error:", err.message);
                io.to(roomCode).emit('gameStart', {
                    white: whitePlayer,
                    black: blackPlayer,
                    fen: room.game.fen(),
                    pgn: room.game.pgn(),
                });
            }
        );
    });

    socket.on('move', (data) => {
        const { roomCode, from, to } = data;
        const room = rooms[roomCode];

        if (!room || room.status !== 'active') return;
        
        const game = room.game;
        const turn = game.turn() === 'w' ? room.players[0] : room.players[1];

        if (socket.id !== turn) {
            return; // Not this player's turn
        }

        const move = game.move({ from, to, promotion: 'q' });

        if (move) {
            const fen = game.fen();
            const pgn = game.pgn();
            let gameOverMessage = null;
            let result = null;

            if (game.isGameOver()) {
                room.status = 'finished';
                if (game.isCheckmate()) {
                    gameOverMessage = `Checkmate! ${move.color === 'w' ? 'White' : 'Black'} wins.`;
                    result = move.color === 'w' ? '1-0' : '0-1';
                } else if (game.isDraw()) {
                    gameOverMessage = 'Draw!';
                    result = '1/2-1/2';
                } else if (game.isStalemate()) {
                    gameOverMessage = 'Stalemate! Draw.';
                    result = '1/2-1/2';
                }
                io.to(roomCode).emit('gameOver', gameOverMessage);
            }
            
            db.run(
                'UPDATE games SET pgn = ?, status = ?, result = ?, updated_at = CURRENT_TIMESTAMP WHERE room_code = ?',
                [pgn, room.status, result, roomCode],
                (err) => {
                     if (err) return console.error("DB Error:", err.message);
                     io.to(roomCode).emit('moveMade', { from, to, fen, move });
                }
            );

        } else {
            // Invalid move attempt
            socket.emit('invalidMove', { from, to });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.indexOf(socket.id);
            if (playerIndex > -1) {
                if (room.status === 'active') {
                    const opponent = room.players[1 - playerIndex];
                    io.to(opponent).emit('playerLeft', 'Your opponent has disconnected.');
                    const result = playerIndex === 0 ? '0-1' : '1-0'; // The disconnected player forfeits
                    db.run('UPDATE games SET status = ?, result = ? WHERE room_code = ?', ['finished', result, roomCode]);
                }
                delete rooms[roomCode];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
