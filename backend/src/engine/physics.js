const { COURT_WIDTH, COURT_HEIGHT, PLAYER_SIZE, TEAM_A, COURT_HEIGHT: CH } = require('../config/constants');
const { clamp } = require('../utils/vector');

class PhysicsEngine {
  static updatePosition(player, dt, obstacles, isRaider = false) {
    if (!player.active) return;

    // Calculate intended position
    let nextX = player.x + (player.vx * dt);
    let nextY = player.y + (player.vy * dt);

    // 1. Boundary Checks
    // Assuming player x,y is center. 
    const halfSize = PLAYER_SIZE / 2;
    
    nextX = clamp(nextX, halfSize, COURT_WIDTH - halfSize);
    
    // Defenders cannot cross center line
    const centerLineY = COURT_HEIGHT / 2;
    if (!isRaider) {
      if (player.team === TEAM_A) {
        // Team A defends top half, cannot go past center
        nextY = clamp(nextY, halfSize, centerLineY);
      } else {
        // Team B defends bottom half, cannot go past center
        nextY = clamp(nextY, centerLineY, COURT_HEIGHT - halfSize);
      }
    } else {
      nextY = clamp(nextY, halfSize, COURT_HEIGHT - halfSize);
    }

    // 2. Obstacle Collision (AABB)
    // We revert to previous axis position if collision occurs
    for (const obs of obstacles) {
      if (PhysicsEngine.checkAABB(nextX, nextY, halfSize, obs)) {
        // Simple resolution: if we hit an obstacle, we stop movement.
        // For a better feel, we check axes independently.
        
        // Check X only
        if (PhysicsEngine.checkAABB(nextX, player.y, halfSize, obs)) {
           nextX = player.x; // Block X
        }
        
        // Check Y only
        if (PhysicsEngine.checkAABB(nextX, nextY, halfSize, obs)) {
           nextY = player.y; // Block Y
        }
      }
    }

    player.x = nextX;
    player.y = nextY;
  }

  static checkAABB(px, py, pHalf, obs) {
    // Player box
    const pLeft = px - pHalf;
    const pRight = px + pHalf;
    const pTop = py - pHalf;
    const pBottom = py + pHalf;

    // Obstacle box
    const oLeft = obs.x;
    const oRight = obs.x + obs.width;
    const oTop = obs.y;
    const oBottom = obs.y + obs.height;

    return (pLeft < oRight && pRight > oLeft && pTop < oBottom && pBottom > oTop);
  }

  static checkPlayerOverlap(p1, p2) {
    if (!p1.active || !p2.active) return false;
    const distSq = (p1.x - p2.x)**2 + (p1.y - p2.y)**2;
    // Overlap if distance < sum of radii (assuming circular) OR strict box overlap
    // Game rules say "Collision overlap". Using circle for cleaner gameplay feel.
    return distSq < (PLAYER_SIZE * PLAYER_SIZE);
  }
}

module.exports = PhysicsEngine;