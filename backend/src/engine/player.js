const { TEAM_A, TEAM_B, COURT_WIDTH, COURT_HEIGHT, PLAYER_SIZE } = require('../config/constants');

class Player {
  constructor(id, socketId, username) {
    this.id = id;
    this.socketId = socketId;
    this.username = username;
    this.team = null;
    this.active = true; // True = in court, False = in Out Zone
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.isReady = false;
  }

  resetPosition(rng) {
    // Spawn points based on team with random positions
    const padding = 100;
    const randomOffset = rng ? rng.nextRange(-150, 150) : 0;
    
    if (this.team === TEAM_A) {
      this.x = COURT_WIDTH / 2 + randomOffset;
      this.y = padding; 
    } else {
      this.x = COURT_WIDTH / 2 + randomOffset;
      this.y = COURT_HEIGHT - padding;
    }
    this.vx = 0;
    this.vy = 0;
  }
}

module.exports = Player;