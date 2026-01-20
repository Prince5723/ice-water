module.exports = {
  // Game dimensions (Virtual Units)
  COURT_WIDTH: 800,
  COURT_HEIGHT: 600,
  PLAYER_SIZE: 20, // Radius or square size
  SAFE_ZONE_HEIGHT: 60, // Distance from top/bottom
  
  // Timings
  MATCH_DURATION_MS: 30 * 60 * 1000, // 30 minutes
  RAID_DURATION_MS: 20 * 1000, // 20 seconds
  TICK_RATE: 30, // Updates per second
  
  // Teams
  TEAM_A: 'TEAM_A',
  TEAM_B: 'TEAM_B',
  // Deprecated: Use room-specific playersPerTeam instead
  // MIN_PLAYERS_PER_TEAM: 2,
  // MAX_PLAYERS_PER_TEAM: 5,
  
  // Room Configuration Limits
  MIN_PLAYERS_PER_TEAM_ALLOWED: 1,
  MAX_PLAYERS_PER_TEAM_ALLOWED: 10,
  DEFAULT_PLAYERS_PER_TEAM: 2,
  
  // Physics
  PLAYER_SPEED: 250, // Units per second
  
  // Game States
  STATE_WAITING: 'WAITING',
  STATE_PLAYING: 'PLAYING',
  STATE_ENDED: 'ENDED',

  // Raid States
  RAID_IDLE: 'IDLE',      // Before crossing center
  RAID_ACTIVE: 'ACTIVE',  // Timer running
  RAID_RETURN: 'RETURN',  // Logic processing return
};