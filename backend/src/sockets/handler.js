const logger = require('../utils/logger');

module.exports = (io, roomManager) => {
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // --- Join Room ---
    socket.on('join_room', ({ roomId, username }) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) {
          return socket.emit('error', { message: 'Room not found' });
        }
        
        socket.join(roomId);
        const player = room.addPlayer(socket.id, username || 'Player');
        
        // Send initial state
        socket.emit('joined_room', {
          roomId,
          playerId: socket.id,
          team: player.team,
          playersPerTeam: room.playersPerTeam,
          config: {
            court: { w: 800, h: 600 },
            safeZone: 60
          }
        });
        
        logger.info(`Player ${username} joined room ${roomId}`);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // --- Player Ready ---
    socket.on('player_ready', ({ roomId }) => {
      const room = roomManager.getRoom(roomId);
      if (room) room.setPlayerReady(socket.id);
    });

    // --- Input ---
    socket.on('input', ({ roomId, dir }) => {
      // dir expects { x: -1|0|1, y: -1|0|1 }
      const room = roomManager.getRoom(roomId);
      if (room) room.handleInput(socket.id, dir);
    });

    // --- Ping ---
    socket.on('ping', () => {
      socket.emit('pong', { t: Date.now() });
    });

    // --- Restart Match ---
    socket.on('restart_match', ({ roomId }) => {
      const room = roomManager.getRoom(roomId);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (!room.players.has(socket.id)) return socket.emit('error', { message: 'Not in room' });
      if (room.state !== 'ENDED') return socket.emit('error', { message: 'Match not finished yet' });

      const restarted = room.restartMatch();
      if (!restarted) {
        socket.emit('error', { message: 'Unable to restart match' });
      }
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
      // Find room user was in
      roomManager.handleDisconnect(socket.id);
    });
  });
};