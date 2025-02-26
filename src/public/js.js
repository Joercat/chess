const BOARD_COLORS = {
    light: '#f0d9b5',
    dark: '#b58863',
    selected: '#646f40',
    highlight: '#baca44',
    check: '#ff6b6b',
    lastMove: '#afd1ff'
};

const PIECE_COLORS = {
    white: '#ffffff',
    black: '#000000'
};

const PIECE_VALUES = {
    pawn: 100,
    knight: 320,
    bishop: 330,
    rook: 500,
    queen: 900,
    king: 20000
};

let board = initializeBoard();
let selectedPiece = null;
let isWhiteTurn = true;
let gameMode = 'local';
let ws = null;
let aiLevel = 0;
let aiThinking = false;
let playerColor = 'white';
let gameActive = true;
let lastMove = null;
let roomCode = null;
let capturedPieces = { white: [], black: [] };

function startLocalPvP() {
    gameMode = 'local';
    document.getElementById('connectionScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    resetGame();
    document.getElementById('status').textContent = 'Local PvP Mode: White to move';
}

function startOnlinePvP() {
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('connectionScreen').style.display = 'block';
}

function startAI(level) {
    gameMode = 'ai';
    aiLevel = level;
    document.getElementById('connectionScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    resetGame();
    document.getElementById('status').textContent = `Playing against AI Level ${level}`;
}

function showConnectionScreen() {
    document.getElementById('gameScreen').style.display = 'none';
    document.getElementById('connectionScreen').style.display = 'block';
}

function createOnlineGame() {
    ws = new WebSocket(`wss://chess-0unh.onrender.com`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({type: 'create'}));
        document.getElementById('connectionStatus').textContent = 'Connected! Waiting for opponent...';
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        document.getElementById('connectionStatus').textContent = 'Connection closed';
    };
}

function joinOnlineGame() {
    const code = document.getElementById('roomCodeInput').value.trim();
    if (!code) return;
    
    ws = new WebSocket(`wss://chess-0unh.onrender.com`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({type: 'join', roomId: code}));
        document.getElementById('connectionStatus').textContent = 'Connecting to game...';
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    closeModal('joinModal');
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'roomCreated':
            roomCode = data.roomId;
            document.getElementById('roomInfo').textContent = `Room Code: ${roomCode}`;
            playerColor = 'white';
            break;
            
        case 'joinedRoom':
            playerColor = 'black';
            document.getElementById('connectionStatus').textContent = 'Connected as Black';
            startOnlineGame();
            break;
            
        case 'playerJoined':
            document.getElementById('connectionStatus').textContent = 'Opponent joined! Game starting...';
            startOnlineGame();
            break;
            
        case 'move':
            makeMove(data.move.from, data.move.to, true);
            break;
            
        case 'opponentLeft':
            document.getElementById('status').textContent = 'Opponent disconnected';
            gameActive = false;
            break;
    }
}

function startOnlineGame() {
    document.getElementById('connectionScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    gameMode = 'online';
    resetGame();
}

function updateGameStatus() {
    const currentColor = isWhiteTurn ? 'White' : 'Black';
    const nextColor = isWhiteTurn ? 'Black' : 'White';
    
    if (isCheckmate(currentColor)) {
        document.getElementById('status').textContent = `Checkmate! ${nextColor} wins!`;
        gameActive = false;
    } else if (isStalemate(currentColor)) {
        document.getElementById('status').textContent = 'Stalemate! Game is a draw.';
        gameActive = false;
    } else if (isKingInCheck(currentColor)) {
        document.getElementById('status').textContent = `${currentColor} is in check! ${currentColor} to move`;
    } else {
        if (gameMode === 'ai') {
            document.getElementById('status').textContent = `Playing AI Level ${aiLevel} - ${currentColor} to move`;
        } else if (gameMode === 'local') {
            document.getElementById('status').textContent = `${currentColor} to move`;
        } else if (gameMode === 'online') {
            document.getElementById('status').textContent = `Online Game - ${currentColor} to move`;
        }
    }
}
function initializeBoard() {
    const board = new Array(8).fill(null).map(() => new Array(8).fill(null));
    const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
    
    for(let i = 0; i < 8; i++) {
        board[1][i] = {type: 'pawn', color: 'black', moved: false};
        board[6][i] = {type: 'pawn', color: 'white', moved: false};
        board[0][i] = {type: backRow[i], color: 'black', moved: false};
        board[7][i] = {type: backRow[i], color: 'white', moved: false};
    }
    return board;
}

function generateLegalMoves(x, y, ignoreCheck = false) {
    const piece = board[x][y];
    const moves = [];
    if (!piece) return moves;
    
    function addMove(newX, newY) {
        if (newX >= 0 && newX < 8 && newY >= 0 && newY < 8) {
            if (!board[newX][newY] || board[newX][newY].color !== piece.color) {
                if (ignoreCheck) {
                    moves.push({x: newX, y: newY});
                } else {
                    const tempBoard = JSON.parse(JSON.stringify(board));
                    const tempPiece = tempBoard[x][y];
                    tempBoard[newX][newY] = tempPiece;
                    tempBoard[x][y] = null;
                    if (!isKingInCheck(piece.color, tempBoard)) {
                        moves.push({x: newX, y: newY});
                    }
                }
            }
        }
    }

    function addSlidingMoves(directions) {
        for (const [dx, dy] of directions) {
            let newX = x + dx;
            let newY = y + dy;
            while (newX >= 0 && newX < 8 && newY >= 0 && newY < 8) {
                if (!board[newX][newY]) {
                    addMove(newX, newY);
                } else {
                    if (board[newX][newY].color !== piece.color) {
                        addMove(newX, newY);
                    }
                    break;
                }
                newX += dx;
                newY += dy;
            }
        }
    }

    switch(piece.type) {
        case 'pawn':
            const direction = piece.color === 'white' ? -1 : 1;
            // Forward move
            if (!board[x + direction]?.[y]) {
                addMove(x + direction, y);
                // Initial two-square move
                if (!piece.moved && !board[x + 2 * direction]?.[y]) {
                    addMove(x + 2 * direction, y);
                }
            }
            // Captures
            for (const dy of [-1, 1]) {
                const newX = x + direction;
                const newY = y + dy;
                if (board[newX]?.[newY]?.color !== piece.color) {
                    addMove(newX, newY);
                }
            }
            break;

        case 'knight':
            const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
            for (const [dx, dy] of knightMoves) {
                addMove(x + dx, y + dy);
            }
            break;

        case 'bishop':
            addSlidingMoves([[1,1],[1,-1],[-1,1],[-1,-1]]);
            break;

        case 'rook':
            addSlidingMoves([[0,1],[0,-1],[1,0],[-1,0]]);
            break;

        case 'queen':
            addSlidingMoves([[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]);
            break;

        case 'king':
            const kingMoves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
            for (const [dx, dy] of kingMoves) {
                addMove(x + dx, y + dy);
            }
            break;
    }
    return moves;
}

function makeMove(from, to, isSimulation = false) {
    if (!board[from.x][from.y]) return false;
    
    if (!isSimulation) {
        if (gameMode === 'online' && board[from.x][from.y].color !== playerColor) return false;
        if (board[from.x][from.y].color === 'white' !== isWhiteTurn) return false;
    }

    const piece = board[from.x][from.y];
    const moves = generateLegalMoves(from.x, from.y);
    const isValidMove = moves.some(move => move.x === to.x && move.y === to.y);

    if (!isValidMove) return false;

    if (board[to.x][to.y]) {
        capturedPieces[board[to.x][to.y].color].push(board[to.x][to.y]);
        updateCaptureDisplay();
    }

    board[to.x][to.y] = piece;
    board[from.x][from.y] = null;
    piece.moved = true;
    
    if (!isSimulation) {
        lastMove = {from, to};
        isWhiteTurn = !isWhiteTurn;
        
        updateGameStatus();

        if (gameMode === 'online' && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'move',
                roomId: roomCode,
                move: {from, to}
            }));
        }

        drawBoard();

        if (gameMode === 'ai' && !isWhiteTurn && !aiThinking && gameActive) {
            aiThinking = true;
            document.getElementById('status').textContent = 'AI is thinking...';
            setTimeout(() => {
                const aiMove = generateAIMove(aiLevel);
                if (aiMove) {
                    makeMove(aiMove.from, aiMove.to);
                }
                aiThinking = false;
            }, 500);
        }
    }
    return true;
}
function isKingInCheck(color, testBoard = board) {
    let kingPos = null;
    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(testBoard[i][j] && testBoard[i][j].type === 'king' && testBoard[i][j].color === color) {
                kingPos = {x: i, y: j};
                break;
            }
        }
        if(kingPos) break;
    }

    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(testBoard[i][j] && testBoard[i][j].color !== color) {
                const moves = generateLegalMoves(i, j, true);
                if(moves.some(move => move.x === kingPos.x && move.y === kingPos.y)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function isCheckmate(color) {
    if(!isKingInCheck(color)) return false;
    
    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(board[i][j] && board[i][j].color === color) {
                const moves = generateLegalMoves(i, j);
                if(moves.length > 0) return false;
            }
        }
    }
    return true;
}

function isStalemate(color) {
    if(isKingInCheck(color)) return false;
    
    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(board[i][j] && board[i][j].color === color) {
                const moves = generateLegalMoves(i, j);
                if(moves.length > 0) return false;
            }
        }
    }
    return true;
}

function evaluatePosition() {
    let score = 0;
    const pawnStructureWeight = 0.3;
    const centerControlWeight = 0.2;
    const mobilityWeight = 0.1;
    const kingSafetyWeight = 0.4;

    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(board[i][j]) {
                const piece = board[i][j];
                const baseValue = PIECE_VALUES[piece.type];
                const color = piece.color === 'black' ? 1 : -1;
                
                score += baseValue * color;
                
                if(piece.type === 'pawn') {
                    if(i > 0 && board[i-1][j] && board[i-1][j].type === 'pawn' 
                       && board[i-1][j].color === piece.color) {
                        score += 10 * color * pawnStructureWeight;
                    }
                    score += (piece.color === 'black' ? i : 7-i) * 10 * color * pawnStructureWeight;
                }
                
                if([3,4].includes(i) && [3,4].includes(j)) {
                    score += 20 * color * centerControlWeight;
                }
                
                const moves = generateLegalMoves(i, j, true);
                score += moves.length * 5 * color * mobilityWeight;
                
                if(piece.type === 'king') {
                    if(!isEndgame()) {
                        if([3,4].includes(i) || [3,4].includes(j)) {
                            score -= 30 * color * kingSafetyWeight;
                        }
                    }
                }
            }
        }
    }
    return score;
}

function generateAIMove(level) {
    const depth = level + 1;
    let bestMove = null;
    let bestScore = -Infinity;
    
    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(board[i][j]?.color === 'black') {
                const moves = generateLegalMoves(i, j);
                for(const move of moves) {
                    const tempBoard = JSON.parse(JSON.stringify(board));
                    makeMove({x: i, y: j}, move, true);
                    const score = minimax(depth - 1, false, -Infinity, Infinity);
                    board = tempBoard;
                    
                    if(score > bestScore) {
                        bestScore = score;
                        bestMove = {from: {x: i, y: j}, to: move};
                    }
                }
            }
        }
    }
    return bestMove;
}

function minimax(depth, isMaximizing, alpha, beta) {
    if(depth === 0) return evaluatePosition();
    
    if(isMaximizing) {
        let maxScore = -Infinity;
        for(let i = 0; i < 8; i++) {
            for(let j = 0; j < 8; j++) {
                if(board[i][j]?.color === 'black') {
                    const moves = generateLegalMoves(i, j);
                    for(const move of moves) {
                        const tempBoard = JSON.parse(JSON.stringify(board));
                        makeMove({x: i, y: j}, move, true);
                        const score = minimax(depth - 1, false, alpha, beta);
                        board = tempBoard;
                        maxScore = Math.max(maxScore, score);
                        alpha = Math.max(alpha, score);
                        if(beta <= alpha) break;
                    }
                }
            }
        }
        return maxScore;
    } else {
        let minScore = Infinity;
        for(let i = 0; i < 8; i++) {
            for(let j = 0; j < 8; j++) {
                if(board[i][j]?.color === 'white') {
                    const moves = generateLegalMoves(i, j);
                    for(const move of moves) {
                        const tempBoard = JSON.parse(JSON.stringify(board));
                        makeMove({x: i, y: j}, move, true);
                        const score = minimax(depth - 1, true, alpha, beta);
                        board = tempBoard;
                        minScore = Math.min(minScore, score);
                        beta = Math.min(beta, score);
                        if(beta <= alpha) break;
                    }
                }
            }
        }
        return minScore;
    }
}

function drawBoard() {
    const canvas = document.getElementById('chessboard');
    const ctx = canvas.getContext('2d');
    const squareSize = canvas.width / 8;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            ctx.fillStyle = (i + j) % 2 === 0 ? BOARD_COLORS.light : BOARD_COLORS.dark;

            if(selectedPiece && selectedPiece.x === i && selectedPiece.y === j) {
                ctx.fillStyle = BOARD_COLORS.selected;
            }

            if(lastMove && ((lastMove.from.x === i && lastMove.from.y === j) || 
                           (lastMove.to.x === i && lastMove.to.y === j))) {
                ctx.fillStyle = BOARD_COLORS.lastMove;
            }

            ctx.fillRect(j * squareSize, i * squareSize, squareSize, squareSize);

            if(board[i][j]) {
                ctx.fillStyle = board[i][j].color === 'white' ? PIECE_COLORS.white : PIECE_COLORS.black;
                ctx.strokeStyle = board[i][j].color === 'white' ? PIECE_COLORS.black : PIECE_COLORS.white;
                ctx.font = '45px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                const symbol = getPieceSymbol(board[i][j].type, board[i][j].color);
                const x = j * squareSize + squareSize/2;
                const y = i * squareSize + squareSize/2;
                
                ctx.fillText(symbol, x, y);
                ctx.lineWidth = 1;
                ctx.strokeText(symbol, x, y);
            }
        }
    }

    if(selectedPiece) {
        const moves = generateLegalMoves(selectedPiece.x, selectedPiece.y);
        moves.forEach(move => {
            ctx.beginPath();
            ctx.arc(
                move.y * squareSize + squareSize/2,
                move.x * squareSize + squareSize/2,
                10,
                0,
                2 * Math.PI
            );
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.fill();
        });
    }
}

function updateCaptureDisplay() {
    document.getElementById('white-captures').textContent = 'White Captures: ' + 
        capturedPieces.white.map(p => getPieceSymbol(p.type, p.color)).join(' ');
    document.getElementById('black-captures').textContent = 'Black Captures: ' + 
        capturedPieces.black.map(p => getPieceSymbol(p.type, p.color)).join(' ');
}

function isEndgame() {
    let pieceCount = 0;
    for(let i = 0; i < 8; i++) {
        for(let j = 0; j < 8; j++) {
            if(board[i][j] && board[i][j].type !== 'pawn' && board[i][j].type !== 'king') {
                pieceCount++;
            }
        }
    }
    return pieceCount <= 6;
}

function resetGame() {
    board = initializeBoard();
    selectedPiece = null;
    isWhiteTurn = true;
    gameActive = true;
    lastMove = null;
    capturedPieces = {white: [], black: []};
    updateCaptureDisplay();
    document.getElementById('status').textContent = 'Game Status: New Game Started';
    drawBoard();
}

// Event Listeners
document.getElementById('chessboard').addEventListener('click', (e) => {
    if(!gameActive || aiThinking) return;
    
    const canvas = document.getElementById('chessboard');
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientY - rect.top) / (canvas.height / 8));
    const y = Math.floor((e.clientX - rect.left) / (canvas.width / 8));
    
    if(!selectedPiece) {
        if(board[x][y] && board[x][y].color === (isWhiteTurn ? 'white' : 'black')) {
            selectedPiece = {x, y};
            drawBoard();
        }
    } else {
        const moves = generateLegalMoves(selectedPiece.x, selectedPiece.y);
        if(moves.some(move => move.x === x && move.y === y)) {
            makeMove(selectedPiece, {x, y});
        }
        selectedPiece = null;
        drawBoard();
    }
});

// Initialize the game
document.getElementById('connectionScreen').style.display = 'block';
document.getElementById('gameScreen').style.display = 'none';
drawBoard();
updateCaptureDisplay();

