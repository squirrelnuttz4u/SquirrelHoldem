// Main server for Squirrel Hold'em

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const os = require('os');
const PokerGame = require('./game');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

// Initialize game
const game = new PokerGame();

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// API Routes
app.get('/api/config', (req, res) => {
  res.json(game.config);
});

app.post('/api/config', (req, res) => {
  game.updateConfig(req.body);
  io.emit('configUpdated', game.config);
  res.json({ success: true, config: game.config });
});

app.get('/api/game-state', (req, res) => {
  res.json(game.getGameState());
});

app.get('/api/server-info', (req, res) => {
  res.json({
    ip: LOCAL_IP,
    port: PORT,
    clientUrl: `http://${LOCAL_IP}:${PORT}/client.html`,
    displayUrl: `http://${LOCAL_IP}:${PORT}/display.html`,
    adminUrl: `http://${LOCAL_IP}:${PORT}/admin.html`
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current game state to new connection
  socket.emit('gameState', game.getGameState());

  // Player joins game
  socket.on('joinGame', (data) => {
    const playerName = typeof data === 'string' ? data : data.name;
    const sessionId = typeof data === 'object' ? data.sessionId : null;

    const result = game.addPlayer(socket.id, playerName, sessionId);

    if (result.success) {
      socket.emit('joinedGame', {
        success: true,
        player: result.player,
        playerState: game.getPlayerState(socket.id),
        sessionId: result.sessionId,
        isReconnect: result.isReconnect
      });
      io.emit('gameState', game.getGameState());

      if (result.isReconnect) {
        io.emit('playerReconnected', { name: result.player.name });
      } else {
        io.emit('playerJoined', { name: playerName });
      }
    } else {
      socket.emit('joinedGame', { success: false, message: result.message });
    }
  });

  // Start game (admin only)
  socket.on('startGame', () => {
    const result = game.startGame();

    if (result.success) {
      io.emit('gameStarted');
      io.emit('gameState', game.getGameState());

      // Send private cards to each player
      game.players.forEach(player => {
        io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
      });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // Player actions
  socket.on('playerAction', ({ action, amount }) => {
    const result = game.playerAction(socket.id, action, amount);

    if (result.success) {
      io.emit('gameState', game.getGameState());

      // Update all players' private state
      game.players.forEach(player => {
        io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
      });

      // Check if hand ended
      if (game.gameState === 'showdown') {
        const results = game.showdown();
        io.emit('showdown', results);

        // Auto-start next hand after showing results
        setTimeout(() => {
          io.emit('gameState', game.getGameState());

          // Start next hand automatically if enabled and enough players
          if (game.config.autoNextHand && game.players.length >= game.config.minPlayers) {
            setTimeout(() => {
              const nextHandResult = game.startGame();
              if (nextHandResult.success) {
                io.emit('gameStarted');
                io.emit('gameState', game.getGameState());

                // Send private cards to each player
                game.players.forEach(player => {
                  io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
                });
              }
            }, 3000); // Wait 3 more seconds before starting next hand
          }
        }, 5000);
      } else if (game.gameState === 'waiting' && game.lastHandResults) {
        // Hand ended via fold - emit winner info
        io.emit('showdown', game.lastHandResults);

        // Auto-start next hand
        setTimeout(() => {
          io.emit('gameState', game.getGameState());

          // Start next hand automatically if enabled and enough players
          if (game.config.autoNextHand && game.players.length >= game.config.minPlayers) {
            setTimeout(() => {
              const nextHandResult = game.startGame();
              if (nextHandResult.success) {
                io.emit('gameStarted');
                io.emit('gameState', game.getGameState());

                // Send private cards to each player
                game.players.forEach(player => {
                  io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
                });
              }
            }, 3000);
          }
        }, 5000); // Same delay as showdown for consistency
      }
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // Get player's private state
  socket.on('getPlayerState', () => {
    const playerState = game.getPlayerState(socket.id);
    socket.emit('playerState', playerState);
  });

  // Skip current player (admin action)
  socket.on('skipPlayer', () => {
    const result = game.skipCurrentPlayer();

    if (result.success) {
      io.emit('playerSkipped', { playerName: result.playerName });
      io.emit('gameState', game.getGameState());

      // Update all players' private state
      game.players.forEach(player => {
        io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
      });

      // Check if hand ended due to skip
      if (game.gameState === 'showdown') {
        const results = game.showdown();
        io.emit('showdown', results);

        setTimeout(() => {
          io.emit('gameState', game.getGameState());

          if (game.config.autoNextHand && game.players.length >= game.config.minPlayers) {
            setTimeout(() => {
              const nextHandResult = game.startGame();
              if (nextHandResult.success) {
                io.emit('gameStarted');
                io.emit('gameState', game.getGameState());

                game.players.forEach(player => {
                  io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
                });
              }
            }, 3000);
          }
        }, 5000);
      } else if (game.gameState === 'waiting' && game.lastHandResults) {
        io.emit('showdown', game.lastHandResults);

        setTimeout(() => {
          io.emit('gameState', game.getGameState());

          if (game.config.autoNextHand && game.players.length >= game.config.minPlayers) {
            setTimeout(() => {
              const nextHandResult = game.startGame();
              if (nextHandResult.success) {
                io.emit('gameStarted');
                io.emit('gameState', game.getGameState());

                game.players.forEach(player => {
                  io.to(player.socketId).emit('playerState', game.getPlayerState(player.socketId));
                });
              }
            }, 3000);
          }
        }, 5000);
      }
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) {
      console.log('Client disconnected:', socket.id, '-', player.name);
      game.handleDisconnect(socket.id);
      io.emit('playerDisconnected', { name: player.name, sessionId: player.sessionId });
      io.emit('gameState', game.getGameState());
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🃏 Squirrel Hold'em server running on port ${PORT}`);
  console.log(`🌐 Server IP: ${LOCAL_IP}`);
  console.log(`📺 Display: http://${LOCAL_IP}:${PORT}/display.html`);
  console.log(`📱 Client: http://${LOCAL_IP}:${PORT}/client.html`);
  console.log(`⚙️  Admin: http://${LOCAL_IP}:${PORT}/admin.html`);
});
