const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 10000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// WebSocket server
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const connections = new Set();

wss.on('connection', (ws) => {
    connections.add(ws);
    console.log('New client connected');

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'create':
                const roomId = crypto.randomBytes(3).toString('hex');
                rooms.set(roomId, {
                    host: ws,
                    players: [ws],
                    moves: [],
                    gameState: 'waiting'
                });
                ws.roomId = roomId;
                ws.send(JSON.stringify({
                    type: 'roomCreated',
                    roomId,
                    color: 'white'
                }));
                break;
                
            case 'join':
                if (rooms.has(data.roomId)) {
                    const room = rooms.get(data.roomId);
                    if (room.players.length < 2) {
                        room.players.push(ws);
                        room.guest = ws;
                        ws.roomId = data.roomId;
                        room.gameState = 'playing';
                        
                        ws.send(JSON.stringify({
                            type: 'joinedRoom',
                            color: 'black',
                            roomId: data.roomId
                        }));
                        
                        room.host.send(JSON.stringify({
                            type: 'playerJoined',
                            gameState: 'playing'
                        }));
                    }
                }
                break;
                
            case 'move':
                if (rooms.has(data.roomId)) {
                    const room = rooms.get(data.roomId);
                    const opponent = ws === room.host ? room.guest : room.host;
                    if (opponent) {
                        room.moves.push(data.move);
                        opponent.send(JSON.stringify({
                            type: 'move',
                            move: data.move
                        }));
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        connections.delete(ws);
        if (ws.roomId && rooms.has(ws.roomId)) {
            const room = rooms.get(ws.roomId);
            room.players = room.players.filter(player => player !== ws);
            
            if (room.players.length === 0) {
                rooms.delete(ws.roomId);
            } else {
                room.players.forEach(player => {
                    player.send(JSON.stringify({
                        type: 'opponentLeft',
                        message: 'Opponent disconnected'
                    }));
                });
            }
        }
        console.log('Client disconnected');
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', connections: connections.size, rooms: rooms.size });
});

// Serve the game client
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
