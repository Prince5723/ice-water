const {
  TICK_RATE, COURT_WIDTH, COURT_HEIGHT, SAFE_ZONE_HEIGHT, PLAYER_SPEED,
  TEAM_A, TEAM_B, STATE_WAITING, STATE_PLAYING, STATE_ENDED,
  RAID_IDLE, RAID_ACTIVE, MATCH_DURATION_MS, RAID_DURATION_MS,
  PLAYER_SIZE, DEFAULT_PLAYERS_PER_TEAM
} = require('../config/constants');

const MID_CROSS_EPS = 8;
const SAFE_ZONE_EPS = 10;
const INACTIVE_ROOM_TTL_MS = 10 * 60 * 1000; // Cleanup idle rooms after game end

const PhysicsEngine = require('./physics');
const Player = require('./player');
const Obstacle = require('./obstacle');
const SeededRNG = require('../utils/rng');
const logger = require('../utils/logger');

class GameInstance {
  constructor(roomId, io, playersPerTeam = DEFAULT_PLAYERS_PER_TEAM) {
    this.roomId = roomId;
    this.io = io;
    this.playersPerTeam = playersPerTeam;
    this.state = STATE_WAITING;

    this.players = new Map();
    this.teams = { [TEAM_A]: [], [TEAM_B]: [] };

    this.matchTimer = MATCH_DURATION_MS;
    this.obstacles = [];
    this.rng = new SeededRNG(Date.now());

    this.round = 1;
    this.turn = TEAM_A;

    this.raiderQueues = { [TEAM_A]: [], [TEAM_B]: [] };

    this.currentRaiderId = null;
    this.raidState = RAID_IDLE;
    this.raidTimer = RAID_DURATION_MS;
    this.touchedDefenders = new Set();
    this.hasCrossedMid = false;

    this.raidEnding = false;

    this.scores = { [TEAM_A]: 0, [TEAM_B]: 0 };

    this.tickInterval = null;
    this.tickCount = 0;
    this.lastTime = Date.now();

    this.cleanupTimer = null;
  }

  addPlayer(socketId, username) {
    const maxCapacity = this.playersPerTeam * 2;
    if (this.players.size >= maxCapacity) throw new Error(`Room Full (max ${maxCapacity} players)`);
    if (this.state !== STATE_WAITING) throw new Error('Game in progress');

    const id = socketId;
    const player = new Player(id, socketId, username);
    this.players.set(id, player);

    if (this.teams[TEAM_A].length <= this.teams[TEAM_B].length) {
      player.team = TEAM_A;
      this.teams[TEAM_A].push(id);
    } else {
      player.team = TEAM_B;
      this.teams[TEAM_B].push(id);
    }

    player.resetPosition(this.rng);
    this.broadcastState('player_joined', { id, team: player.team, username });
    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    if (this.state === STATE_PLAYING) {
      player.active = false;
      player.vx = 0;
      player.vy = 0;
    } else {
      this.players.delete(socketId);
      this.teams[player.team] = this.teams[player.team].filter(id => id !== socketId);
    }

    this.broadcastState('player_left', { id: socketId });
    this.checkWinCondition();
  }

  handleInput(socketId, direction) {
    if (this.state !== STATE_PLAYING) return;
    const player = this.players.get(socketId);
    if (!player || !player.active) return;

    const isAttackingTeam = (player.team === this.turn);
    const isRaider = (socketId === this.currentRaiderId);

    if (isAttackingTeam && !isRaider) {
      player.vx = 0;
      player.vy = 0;
      return;
    }

    let vx = 0, vy = 0;
    if (direction.x === 1) vx = PLAYER_SPEED;
    if (direction.x === -1) vx = -PLAYER_SPEED;
    if (direction.y === 1) vy = PLAYER_SPEED;
    if (direction.y === -1) vy = -PLAYER_SPEED;
    if (vx !== 0) vy = 0;

    player.vx = vx;
    player.vy = vy;
  }

  setPlayerReady(socketId) {
    const player = this.players.get(socketId);
    if (player) player.isReady = true;
    this.checkStart();
  }

  checkStart() {
    const allReady = Array.from(this.players.values()).every(p => p.isReady);
    const teamAFull = this.teams[TEAM_A].length === this.playersPerTeam;
    const teamBFull = this.teams[TEAM_B].length === this.playersPerTeam;

    if (allReady && teamAFull && teamBFull) {
      this.startGame();
    }
  }

  startGame() {
    this.cancelCleanupTimer();
    this.state = STATE_PLAYING;
    this.generateObstacles();

    this.raiderQueues[TEAM_A] = [...this.teams[TEAM_A]];
    this.raiderQueues[TEAM_B] = [...this.teams[TEAM_B]];

    this.startRaid();
    this.lastTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);

    logger.info(`Match started in room ${this.roomId}`);
    this.broadcastState('match_started', {});
  }

  restartMatch() {
    if (this.state !== STATE_ENDED) return false;

    // Cancel any pending cleanup
    this.cancelCleanupTimer();

    // Reset core state
    this.state = STATE_PLAYING;
    this.round = 1;
    this.turn = TEAM_A;
    this.matchTimer = MATCH_DURATION_MS;
    this.raidTimer = RAID_DURATION_MS;
    this.touchedDefenders.clear();
    this.hasCrossedMid = false;
    this.raidState = RAID_IDLE;
    this.raidEnding = false;
    this.currentRaiderId = null;
    this.scores = { [TEAM_A]: 0, [TEAM_B]: 0 };
    this.obstacles = [];
    this.tickCount = 0;

    // Reset players
    for (const player of this.players.values()) {
      player.active = true;
      player.vx = 0;
      player.vy = 0;
      player.isReady = true;
      player.resetPosition(this.rng);
    }

    // Rebuild queues from current teams/players
    this.raiderQueues[TEAM_A] = this.teams[TEAM_A].filter(id => this.players.has(id));
    this.raiderQueues[TEAM_B] = this.teams[TEAM_B].filter(id => this.players.has(id));

    this.generateObstacles();
    this.startRaid();
    this.lastTime = Date.now();
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);

    logger.info(`Match restarted in room ${this.roomId}`);
    this.broadcastState('match_started', {});
    return true;
  }

  generateObstacles() {
    // Symmetric obstacle generation: same count per side to avoid bias.
    // Round 1: 1 per side (2 total), Round 2: 2 per side (4 total),
    // Round N: min(N,5) per side (capped at 5), so total = 2 * perSide.
    const perSide = Math.min(Math.max(1, this.round), 5);
    const desiredTotal = perSide * 2;
    const MAX_TRIES = 32;
    const BUFFER = PLAYER_SIZE + 12; // Keep a safe buffer away from players/other obstacles

    this.obstacles = [];

    for (let i = 0; i < perSide; i++) {
      const placed = this.tryPlaceMirroredPair(MAX_TRIES, BUFFER);
      if (!placed) break; // fallback will attempt remaining pairs
    }

    const placedPairs = Math.floor(this.obstacles.length / 2);
    const remainingPairs = perSide - placedPairs;
    if (remainingPairs > 0) {
      this.fallbackPlaceMirroredPairs(remainingPairs, BUFFER);
    }

    // Ensure symmetry is preserved; obstacles are always added in pairs,
    // so total should be even. If fallback couldn't place all, we still
    // maintain equal counts per side by only adding complete pairs.
    if (this.obstacles.length > desiredTotal) {
      this.obstacles = this.obstacles.slice(0, desiredTotal);
    }
  }

  tryPlaceMirroredPair(maxTries, buffer) {
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const w = this.rng.nextRange(40, 100);
      const h = this.rng.nextRange(40, 100);

      const xMin = buffer;
      const xMax = COURT_WIDTH - buffer - w;
      if (xMax <= xMin) continue;

      const yMinTop = SAFE_ZONE_HEIGHT + buffer;
      const yMaxTop = (COURT_HEIGHT / 2) - buffer - h;
      if (yMaxTop <= yMinTop) continue;

      const x = this.rng.nextRange(xMin, xMax);
      const yTop = this.rng.nextRange(yMinTop, yMaxTop);
      const yBottom = COURT_HEIGHT - yTop - h; // mirrored about center

      // Ensure bottom stays outside safe zone
      if (yBottom < (COURT_HEIGHT / 2) + buffer) continue;
      if (yBottom + h > COURT_HEIGHT - SAFE_ZONE_HEIGHT - buffer) continue;

      if (this.obstacleOverlapsPlayer(x, yTop, w, h, buffer)) continue;
      if (this.obstacleOverlapsPlayer(x, yBottom, w, h, buffer)) continue;
      if (this.obstacleOverlapsObstacle(x, yTop, w, h, buffer)) continue;
      if (this.obstacleOverlapsObstacle(x, yBottom, w, h, buffer)) continue;

      const idTop = `obs_${this.round}_${this.obstacles.length}`;
      const idBottom = `obs_${this.round}_${this.obstacles.length + 1}`;
      this.obstacles.push(new Obstacle(idTop, x, yTop, w, h));
      this.obstacles.push(new Obstacle(idBottom, x, yBottom, w, h));
      return true;
    }
    return false;
  }

  fallbackPlaceMirroredPairs(remainingPairs, buffer) {
    // Deterministic, symmetric fallback slots to keep fairness.
    const slotXs = [
      COURT_WIDTH * 0.25,
      COURT_WIDTH * 0.5 - 40,
      COURT_WIDTH * 0.75
    ];
    const slotYTop = SAFE_ZONE_HEIGHT + buffer + 36;
    const slotW = 70;
    const slotH = 60;

    for (const sx of slotXs) {
      if (remainingPairs <= 0) break;
      const top = { x: sx - slotW / 2, y: slotYTop, w: slotW, h: slotH };
      const bottom = { x: sx - slotW / 2, y: COURT_HEIGHT - SAFE_ZONE_HEIGHT - buffer - 36 - slotH, w: slotW, h: slotH };

      if (
        !this.obstacleOverlapsPlayer(top.x, top.y, top.w, top.h, buffer) &&
        !this.obstacleOverlapsObstacle(top.x, top.y, top.w, top.h, buffer) &&
        !this.obstacleOverlapsPlayer(bottom.x, bottom.y, bottom.w, bottom.h, buffer) &&
        !this.obstacleOverlapsObstacle(bottom.x, bottom.y, bottom.w, bottom.h, buffer)
      ) {
        this.obstacles.push(new Obstacle(`obs_${this.round}_${this.obstacles.length}`, top.x, top.y, top.w, top.h));
        this.obstacles.push(new Obstacle(`obs_${this.round}_${this.obstacles.length}`, bottom.x, bottom.y, bottom.w, bottom.h));
        remainingPairs -= 1;
      }
    }
  }

  obstacleOverlapsPlayer(obsX, obsY, w, h, buffer = 0) {
    const half = PLAYER_SIZE / 2 + buffer;
    for (const player of this.players.values()) {
      if (!player.active) continue;
      if (
        player.x + half > obsX &&
        player.x - half < obsX + w &&
        player.y + half > obsY &&
        player.y - half < obsY + h
      ) return true;
    }
    return false;
  }

  obstacleOverlapsObstacle(obsX, obsY, w, h, buffer = 0) {
    for (const obs of this.obstacles) {
      if (
        obs.x - buffer < obsX + w &&
        obs.x + obs.w + buffer > obsX &&
        obs.y - buffer < obsY + h &&
        obs.y + obs.h + buffer > obsY
      ) return true;
    }
    return false;
  }

  cancelCleanupTimer() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  scheduleCleanup() {
    this.cancelCleanupTimer();
    if (!this.roomManager) return;
    this.cleanupTimer = setTimeout(() => {
      if (this.state !== STATE_ENDED) return;
      clearInterval(this.tickInterval);
      this.roomManager.rooms.delete(this.roomId);
      logger.info(`Room ${this.roomId} cleaned up after inactivity`);
    }, INACTIVE_ROOM_TTL_MS);
  }

  startRaid() {
    while (this.raiderQueues[this.turn].length > 0) {
      const candidateId = this.raiderQueues[this.turn][0];
      if (this.players.get(candidateId)) break;
      this.raiderQueues[this.turn].shift();
    }

    if (this.raiderQueues[this.turn].length === 0) {
      this.raiderQueues[this.turn] = this.teams[this.turn].filter(id => this.players.has(id));
    }

    this.currentRaiderId = this.raiderQueues[this.turn][0];
    const raider = this.players.get(this.currentRaiderId);

    if (!raider.active) {
      let found = false;
      for (let i = 0; i < this.raiderQueues[this.turn].length; i++) {
        const rid = this.raiderQueues[this.turn][0];
        if (this.players.get(rid).active) {
          this.currentRaiderId = rid;
          found = true;
          break;
        }
        this.raiderQueues[this.turn].push(this.raiderQueues[this.turn].shift());
      }
      if (!found) {
        this.endGame('ELIMINATION');
        return;
      }
    }

    this.raidState = RAID_IDLE;
    this.raidTimer = RAID_DURATION_MS;
    this.touchedDefenders.clear();
    this.hasCrossedMid = false;
    this.raidEnding = false;

    this.broadcastState('raid_start', {
      team: this.turn,
      raider: this.currentRaiderId
    });
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.tickCount++;

    for (const player of this.players.values()) {
      const isRaider = (player.id === this.currentRaiderId);
      PhysicsEngine.updatePosition(player, dt, this.obstacles, isRaider);
    }

    this.updateGameLogic(dt);
    this.sendSnapshot();
  }

  updateGameLogic(dt) {
    if (this.state !== STATE_PLAYING) return;
    if (this.raidEnding) return;

    this.matchTimer -= dt * 1000;
    if (this.matchTimer <= 0) {
      this.endGame('TIME_UP');
      return;
    }

    const raider = this.players.get(this.currentRaiderId);
    if (!raider || !raider.active) {
      if (this.raidState === RAID_ACTIVE) {
        this.endRaid(false, 'Raider eliminated');
      }
      return;
    }

    const isTeamA = raider.team === TEAM_A;
    const centerLineY = COURT_HEIGHT / 2;

    if (this.raidState === RAID_IDLE) {
      const crossed = isTeamA
        ? raider.y > centerLineY + MID_CROSS_EPS
        : raider.y < centerLineY - MID_CROSS_EPS;

      if (crossed && !this.hasCrossedMid) {
        this.hasCrossedMid = true;
        this.raidState = RAID_ACTIVE;
      }
    }

    if (this.raidState === RAID_ACTIVE) {
      this.raidTimer -= dt * 1000;

      if (this.raidTimer <= 0) {
        this.endRaid(false, 'Time Expired');
        return;
      }

      const defenders = isTeamA ? this.teams[TEAM_B] : this.teams[TEAM_A];
      for (const defId of defenders) {
        const def = this.players.get(defId);
        if (def && def.active && !this.touchedDefenders.has(defId)) {
          const dx = raider.x - def.x;
          const dy = raider.y - def.y;
          if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE) {
            this.touchedDefenders.add(defId);
            def.active = false;
            def.vx = 0;
            def.vy = 0;
          }
        }
      }

      if (this.hasCrossedMid) {
        const inSafeZone = isTeamA
          ? raider.y < SAFE_ZONE_HEIGHT - SAFE_ZONE_EPS
          : raider.y > COURT_HEIGHT - SAFE_ZONE_HEIGHT + SAFE_ZONE_EPS;

        if (inSafeZone) {
          this.endRaid(true, 'Safe Return');
          return;
        }
      }
    }
  }

  endRaid(safeReturn, reason) {
    if (this.raidEnding) return;
    this.raidEnding = true;
    this.raidState = RAID_IDLE;

    const raider = this.players.get(this.currentRaiderId);
    let successful = false;
    let points = 0;

    // FIX: Undo defender freezes if raid failed due to timeout
    if (!safeReturn && reason === 'Time Expired') {
      for (const defId of this.touchedDefenders) {
        const def = this.players.get(defId);
        if (def) {
          def.active = true;
          def.vx = 0;
          def.vy = 0;
          def.resetPosition(this.rng);
        }
      }
      this.touchedDefenders.clear();
    }

    if (safeReturn) {
      successful = true;

      const touchCount = this.touchedDefenders.size;
      points = touchCount * 5;   // ✅ 5 points per defender touched

      if (touchCount > 0) {
        let revivesNeeded = touchCount;
        const teamMates = this.teams[raider.team];

        for (const tmId of teamMates) {
          if (revivesNeeded <= 0) break;
          const tm = this.players.get(tmId);
          if (!tm.active) {
            tm.active = true;
            tm.resetPosition(this.rng);
            revivesNeeded--;
          }
        }
      }

      this.scores[raider.team] += points;
    }
    else {
      successful = false;
      if (raider && raider.active) {
        if (reason === 'Time Expired') {
          const isTeamA = raider.team === TEAM_A;
          const safeY = isTeamA
            ? SAFE_ZONE_HEIGHT / 2
            : COURT_HEIGHT - SAFE_ZONE_HEIGHT / 2;

          raider.x = COURT_WIDTH / 2;
          raider.y = safeY;
        }

        raider.active = false;
        raider.vx = 0;
        raider.vy = 0;
      }
    }

    const finishedRaider = this.raiderQueues[this.turn].shift();
    if (finishedRaider) {
      this.raiderQueues[this.turn].push(finishedRaider);
    }

    this.broadcastState('raid_result', {
      success: successful,
      points,
      reason,
      raiderTeam: this.turn,
      touches: this.touchedDefenders.size,
      hasCrossedMid: this.hasCrossedMid
    });

    if (this.checkWinCondition()) return;

    this.turn = this.turn === TEAM_A ? TEAM_B : TEAM_A;

    if (this.turn === TEAM_A) {
      this.round++;
      this.generateObstacles();
    }

    setTimeout(() => {
      if (this.state === STATE_PLAYING) this.startRaid();
    }, 2000);
  }

  checkWinCondition() {
    const activeA = this.teams[TEAM_A].filter(id => this.players.get(id).active).length;
    const activeB = this.teams[TEAM_B].filter(id => this.players.get(id).active).length;
    if (activeA === 0 || activeB === 0) {
      this.endGame('ELIMINATION');
      return true;
    }
    return false;
  }

  endGame(reason) {
    clearInterval(this.tickInterval);
    this.state = STATE_ENDED;

    let winner = null;
    const scoreA = this.scores[TEAM_A];
    const scoreB = this.scores[TEAM_B];
    const activeA = this.teams[TEAM_A].filter(id => this.players.get(id).active).length;
    const activeB = this.teams[TEAM_B].filter(id => this.players.get(id).active).length;

    if (scoreA > scoreB) winner = TEAM_A;
    else if (scoreB > scoreA) winner = TEAM_B;
    else if (activeA > activeB) winner = TEAM_A;
    else if (activeB > activeA) winner = TEAM_B;
    else winner = 'DRAW';

    this.broadcastState('game_ended', { reason, winner, scores: this.scores });

    // Schedule room cleanup if it stays inactive
    this.scheduleCleanup();
  }

  broadcastState(event, data) {
    this.io.to(this.roomId).emit(event, data);
  }

  sendSnapshot() {
    const activeA = this.teams[TEAM_A].filter(id => this.players.get(id).active).length;
    const activeB = this.teams[TEAM_B].filter(id => this.players.get(id).active).length;

    const snapshot = {
      t: Date.now(),
      tick: this.tickCount,
      timer: Math.ceil(this.matchTimer / 1000),
      raidTimer: Math.ceil(this.raidTimer / 1000),
      raidState: this.raidState,
      hasCrossedMid: this.hasCrossedMid,
      scores: this.scores,
      activePlayers: { [TEAM_A]: activeA, [TEAM_B]: activeB },
      turn: this.turn,
      round: this.round,
      raider: this.currentRaiderId,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        username: p.username,
        x: Math.round(p.x),
        y: Math.round(p.y),
        act: p.active ? 1 : 0,
        team: p.team
      })),
      obstacles: this.obstacles
    };

    this.io.to(this.roomId).emit('snapshot', snapshot);
  }
}

module.exports = GameInstance;
