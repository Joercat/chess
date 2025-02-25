const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'create':
                const roomId = crypto.randomBytes(3).toString('hex');
                rooms.set(roomId, {
                    host: ws,
                    players: [ws]
                });
                ws.send(JSON.stringify({type: 'roomCreated', roomId}));
                break;
                
            case 'join':
                if (rooms.has(data.roomId)) {
                    const room = rooms.get(data.roomId);
                    room.players.push(ws);
                    room.guest = ws;
                    
                    room.host.send(JSON.stringify({type: 'playerJoined'}));
                    ws.send(JSON.stringify({type: 'joinedRoom'}));
                }
                break;
                
            case 'move':
                if (rooms.has(data.roomId)) {
                    const room = rooms.get(data.roomId);
                    const opponent = ws === room.host ? room.guest : room.host;
                    opponent.send(JSON.stringify({
                        type: 'move',
                        move: data.move
                    }));
                }
                break;
        }
    });
});

server.listen(3000);
