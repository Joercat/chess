const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const sqlite3 = require('sqlite3');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const pino = require('pino');
const pinoHttp = require('pino-http');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const DATABASE_PATH = process.env.DATABASE_PATH || './chess_games.db';
const PROD_ORIGIN = process.env.CORS_ORIGIN; // e.g., https://your-app-name.onrender.com

const allowedOrigins = ['http://localhost:3000'];
if (PROD_ORIGIN) {
    allowedOrigins.push(PROD_ORIGIN);
}

// --- Constants ---
const GAME_STATUS = { WAITING: 'waiting', ACTIVE: 'active', FINISHED: 'finished' };
const CHESS_SQUARE_REGEX = /^[a-h][1-8]$/;

// --- Database Setup ---
const db = new sqlite3.Database(DATABASE_PATH, (err) => {
    if (err) {
        logger.fatal({ err }, "Fatal: Could not connect to DB.");
        process.exit(1);
    }
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { (err) ? reject(err) : resolve(this); });
});

const initializeDB = async () => { /* ... (Same as before, no changes needed) ... */ };


// --- Server and Middleware Setup ---
const app = express();
app.set('trust proxy', 1); // Crucial for Render
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// --- Serving Your Frontend (No Edits Needed) ---
// This one line serves all files from your 'public' directory.
// Visiting your site's root URL will automatically serve 'public/index.html'.
app.use(express.static('public'));

// --- Health Check for Render ---
app.get('/healthz', (req, res) => res.status(200).send('OK'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins } });
const rooms = {};

const generateRoomCode = () => { /* ... (Same as before, no changes needed) ... */ };

// --- Socket.io Handlers ---
// All socket handlers (connection, createRoom, joinRoom, move, disconnect)
// remain the same as the previous version. They are already secure and robust.
io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, "User connected");

    socket.on('createRoom', async () => {
        try {
            const roomCode = generateRoomCode();
            socket.join(roomCode);
            socket.roomCode = roomCode;

            const game = new Chess();
            rooms[roomCode] = { players: [socket.id], game, status: GAME_STATUS.WAITING };

            await dbRun('INSERT INTO games (room_code, status, white_player_id, pgn) VALUES (?, ?, ?, ?)', [roomCode, GAME_STATUS.WAITING, socket.id, game.pgn()]);
            socket.emit('roomCreated', { roomCode });
            logger.info({ roomCode, socketId: socket.id }, "Room created");
        } catch (err) {
            logger.error({ err, socketId: socket.id }, "Error creating room");
            socket.emit('serverError', 'Could not create a room.');
        }
    });

    socket.on('joinRoom', async (roomCode) => {
        if (typeof roomCode !== 'string' || roomCode.length > 10) {
            return socket.emit('roomError', 'Invalid room code format.');
        }
        const room = rooms[roomCode];
        if (!room) return socket.emit('roomError', 'Room not found.');
        if (room.players.length >= 2) return socket.emit('roomError', 'Room is full.');
        
        try {
            socket.join(roomCode);
            socket.roomCode = roomCode;
            room.players.push(socket.id);
            room.status = GAME_STATUS.ACTIVE;

            const [whitePlayer, blackPlayer] = room.players;
            await dbRun('UPDATE games SET status = ?, black_player_id = ? WHERE room_code = ?', [GAME_STATUS.ACTIVE, socket.id, roomCode]);

            io.to(roomCode).emit('gameStart', { white: whitePlayer, black: blackPlayer, fen: room.game.fen() });
            logger.info({ roomCode, players: room.players }, "Game started");
        } catch (err) {
            logger.error({ err, roomCode, socketId: socket.id }, "Error joining room");
            socket.emit('serverError', 'Could not join the room.');
        }
    });
    
    socket.on('move', async (data) => {
        const { roomCode, from, to } = data || {};
        if (!roomCode || !CHESS_SQUARE_REGEX.test(from) || !CHESS_SQUARE_REGEX.test(to)) {
            return socket.emit('invalidMove', { from, to, reason: "Invalid data format." });
        }

        const room = rooms[roomCode];
        if (!room || room.status !== GAME_STATUS.ACTIVE) return;

        const game = room.game;
        const turn = game.turn() === 'w' ? room.players[0] : room.players[1];
        if (socket.id !== turn) return;

        try {
            const move = game.move({ from, to, promotion: 'q' });
            if (!move) return socket.emit('invalidMove', { from, to, reason: "Illegal move." });
            
            let result = null;
            if (game.isGameOver()) {
                room.status = GAME_STATUS.FINISHED;
                result = game.isCheckmate() ? (move.color === 'w' ? '1-0' : '0-1') : '1/2-1/2';
                io.to(roomCode).emit('gameOver', { result });
            }

            await dbRun('UPDATE games SET pgn = ?, status = ?, result = ?, updated_at = CURRENT_TIMESTAMP WHERE room_code = ?', [game.pgn(), room.status, result, roomCode]);
            socket.to(roomCode).emit('moveMade', { from, to, fen: game.fen() });
        } catch (err) {
            logger.error({ err, roomCode }, "Error processing move");
            socket.emit('serverError', 'An error occurred while processing your move.');
        }
    });

    socket.on('disconnect', async () => {
        logger.info({ socketId: socket.id }, "User disconnected");
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            const room = rooms[roomCode];
            const playerIndex = room.players.indexOf(socket.id);

            if (playerIndex !== -1 && room.status === GAME_STATUS.ACTIVE) {
                const result = playerIndex === 0 ? '0-1' : '1-0';
                io.to(roomCode).emit('playerLeft', { message: 'Your opponent has disconnected. You win!', result });
                try {
                    await dbRun('UPDATE games SET status = ?, result = ? WHERE room_code = ?', [GAME_STATUS.FINISHED, result, roomCode]);
                    logger.info({ roomCode, result }, "Game finished due to disconnect");
                } catch (err) {
                    logger.error({ err, roomCode }, "Error updating game on disconnect");
                }
            }
            delete rooms[roomCode];
            logger.info({ roomCode }, "Cleaned up room");
        }
    });
});


const startServer = async () => { /* ... (Same as before, no changes needed) ... */ };
const gracefulShutdown = () => { /* ... (Same as before, no changes needed) ... */ };

// Kick off the server start process
(async () => {
    await initializeDB();
    server.listen(PORT, () => {
        logger.info({ origins: allowedOrigins }, `Server running on port ${PORT}`);
    });
})();

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
