const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 10000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// WebSocket server setup
const wss = new WebSocket.Server({ server });

// Game state management
const rooms = new Map();
const connections = new Set();

// WebSocket connection handling
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
                    gameState: {
                        board: null,
                        currentTurn: 'white',
                        moves: []
                    }
                });
                ws.roomId = roomId;
                ws.send(JSON.stringify({
                    type: 'roomCreated',
                    roomId,
                    color: 'white'
                }));
                break;

            case 'join':
                const room = rooms.get(data.roomId);
                if (room && room.players.length < 2) {
                    room.players.push(ws);
                    ws.roomId = data.roomId;
                    
                    ws.send(JSON.stringify({
                        type: 'joinedRoom',
                        color: 'black',
                        gameState: room.gameState
                    }));
                    
                    room.host.send(JSON.stringify({
                        type: 'playerJoined'
                    }));
                }
                break;

            case 'move':
                const gameRoom = rooms.get(data.roomId);
                if (gameRoom) {
                    gameRoom.gameState.moves.push(data.move);
                    gameRoom.gameState.currentTurn = data.move.color === 'white' ? 'black' : 'white';
                    
                    // Broadcast move to other player
                    gameRoom.players.forEach(player => {
                        if (player !== ws) {
                            player.send(JSON.stringify({
                                type: 'move',
                                move: data.move
                            }));
                        }
                    });
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
                room.players[0].send(JSON.stringify({
                    type: 'opponentLeft'
                }));
            }
        }
        console.log('Client disconnected');
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        connections: connections.size,
        rooms: rooms.size
    });
});

// Serve the main game page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
