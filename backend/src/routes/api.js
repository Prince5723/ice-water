const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validator');
const logger = require('../utils/logger');
const { MIN_PLAYERS_PER_TEAM_ALLOWED, MAX_PLAYERS_PER_TEAM_ALLOWED, DEFAULT_PLAYERS_PER_TEAM } = require('../config/constants');

// Store active rooms in memory (referenced in server.js)
// We need a way to access the global room manager. 
// For this design, we'll attach it to req in server.js

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

router.get('/rooms', (req, res) => {
  const rooms = req.roomManager.listRooms();
  res.json({ success: true, rooms });
});

router.post('/rooms', validate({ name: { required: true } }), (req, res, next) => {
  try {
    const { name, playersPerTeam } = req.body;
    
    // Validate and default playersPerTeam
    let finalPlayersPerTeam = DEFAULT_PLAYERS_PER_TEAM;
    if (playersPerTeam !== undefined) {
      // Check if integer
      if (!Number.isInteger(playersPerTeam)) {
        return res.status(400).json({ success: false, message: 'playersPerTeam must be an integer' });
      }
      // Check range
      if (playersPerTeam < MIN_PLAYERS_PER_TEAM_ALLOWED || playersPerTeam > MAX_PLAYERS_PER_TEAM_ALLOWED) {
        return res.status(400).json({ 
          success: false, 
          message: `playersPerTeam must be between ${MIN_PLAYERS_PER_TEAM_ALLOWED} and ${MAX_PLAYERS_PER_TEAM_ALLOWED}` 
        });
      }
      finalPlayersPerTeam = playersPerTeam;
    }
    
    const roomId = req.roomManager.createRoom(name, finalPlayersPerTeam);
    logger.info(`Room created: ${roomId} with playersPerTeam=${finalPlayersPerTeam}`);
    res.json({ success: true, roomId, playersPerTeam: finalPlayersPerTeam });
  } catch (err) {
    next(err);
  }
});

module.exports = router;