const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');
const socketHandler = require('./sockets/handler');
const GameInstance = require('./engine/game');


// --- Room Manager ---
class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> GameInstance
  }

  createRoom(name, playersPerTeam) {
    if (this.rooms.size >= config.MAX_ROOMS) throw new Error('Max rooms reached');
    const id = `room_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const game = new GameInstance(id, this.io, playersPerTeam);
    game.roomManager = this; // allow self-destruction/cleanup
    // Bind metadata
    game.name = name;
    this.rooms.set(id, game);
    return id;
  }

  getRoom(id) {
    return this.rooms.get(id);
  }

  listRooms() {
    return Array.from(this.rooms.values()).map(r => ({
      id: r.roomId,
      name: r.name,
      players: r.players.size,
      state: r.state,
      playersPerTeam: r.playersPerTeam
    }));
  }

  handleDisconnect(socketId) {
    // Inefficient for massive scale, but fine for node limit
    for (const room of this.rooms.values()) {
      if (room.players.has(socketId)) {
        room.removePlayer(socketId);
        // If empty, cleanup
        if (room.players.size === 0) {
          clearInterval(room.tickInterval);
          this.rooms.delete(room.roomId);
          logger.info(`Room ${room.roomId} destroyed`);
        }
        break;
      }
    }
  }
}

// --- App Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.CORS_ORIGIN, methods: ["GET", "POST"] },
  transports: ['websocket']
});

// Middleware
app.use(express.json());
app.use(express.static('../frontend/'));

// Inject RoomManager into req
const roomManager = new RoomManager(io);
app.use((req, res, next) => {
  req.roomManager = roomManager;
  next();
});

// Routes
app.use('/api', apiRoutes);
app.use(errorHandler);

// Sockets
socketHandler(io, roomManager);

// Start
server.listen(config.PORT, () => {
  logger.info(`Server running on port ${config.PORT}`);
  logger.info(`Tick Rate: ${config.TICK_RATE} Hz`);
});

// Global Error Catcher
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { message: err.message, stack: err.stack });
});
