/**
 * Ice and Water - Frontend Logic
 */

const CONFIG = {
    SERVER_URL: 'http://localhost:3000',
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 600,
    SAFE_ZONE_HEIGHT: 60,
    INTERPOLATION_OFFSET: 100,
    DEBUG_MODE: true,  // Set to false in production to hide diagnostics
    COLORS: {
        TEAM_A: '#0ea5e9', // Ice Blue
        TEAM_B: '#1e3a8a', // Dark Water Blue (Distinct)
        OBSTACLE: '#334155',
        SAFE_ZONE: 'rgba(255, 255, 255, 0.03)',
        CENTER_LINE: 'rgba(255, 255, 255, 0.1)',
        CENTER_LINE_CROSSED: 'rgba(244, 63, 94, 0.3)',  // Red highlight when crossed
        RAIDER_GLOW: '#f43f5e',
        TEXT: '#ffffff',
        FROZEN_ICE: '#7dd3fc', // Frozen ice crystal
        FROZEN_ICE_DARK: '#0284c7' // Dark accent for ice
    }
};

const state = {
    screen: 'lobby',
    socket: null,
    connected: false,
    username: '',
    roomId: null,
    playerId: null,
    team: null,
    playersPerTeam: 2,
    active: false,
    snapshots: [],
    obstacles: [],
    input: { x: 0, y: 0 },
    lastSentInput: { x: 0, y: 0 },
    currentRaiderId: null,
    raidTimerVal: 20,
    raidState: 'IDLE',          // Track raid state for display
    hasCrossedMid: false,       // Track if midline has been crossed this raid
    turn: null,                 // Which team is attacking (TEAM_A or TEAM_B)
    centerLineY: 300,           // Center of court (CANVAS_HEIGHT / 2)
    teleportEffects: []         // Array of active teleport animations
};

const screens = {
    lobby: document.getElementById('screen-lobby'),
    waiting: document.getElementById('screen-waiting'),
    game: document.getElementById('screen-game'),
    result: document.getElementById('screen-result')
};

const ui = {
    status: document.getElementById('connection-status'),
    roomList: document.getElementById('room-list'),
    username: document.getElementById('username-input'),
    playersPerTeamInput: document.getElementById('players-per-team-input'),
    newRoomName: document.getElementById('new-room-name'),
    waitRoom: document.getElementById('wait-room-name'),
    waitMsg: document.getElementById('wait-message'),
    canvas: document.getElementById('game-canvas'),
    ctx: document.getElementById('game-canvas').getContext('2d'),
    scoreA: document.getElementById('score-a'),
    scoreB: document.getElementById('score-b'),
    playersA: document.getElementById('players-a'),
    playersB: document.getElementById('players-b'),
    timer: document.getElementById('match-timer'),
    raidBar: document.getElementById('raid-bar'),
    statusText: document.getElementById('game-status-text'),
    overlay: document.getElementById('canvas-overlay'),
    overlayText: document.getElementById('overlay-text'),
    winner: document.getElementById('winner-text'),
    reason: document.getElementById('end-reason'),
    finalA: document.getElementById('final-score-a'),
    finalB: document.getElementById('final-score-b')
};

const api = {
    async getRooms() {
        try {
            const res = await fetch(`${CONFIG.SERVER_URL}/api/rooms`);
            const data = await res.json();
            return data.success ? data.rooms : [];
        } catch (e) { console.error(e); return []; }
    },
    async createRoom(name, playersPerTeam) {
        try {
            const res = await fetch(`${CONFIG.SERVER_URL}/api/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, playersPerTeam })
            });
            const data = await res.json();
            if(!data.success) throw new Error(data.message);
            return { roomId: data.roomId, playersPerTeam: data.playersPerTeam };
        } catch (e) { showToast(e.message, 'error'); return null; }
    }
};

function init() {
    setupEventListeners();
    refreshRooms();
    state.socket = io(CONFIG.SERVER_URL, { reconnection: true, transports: ['websocket'] });
    setupSocketEvents();
    requestAnimationFrame(gameLoop);
}

function setupEventListeners() {
    document.getElementById('btn-create-room').onclick = async () => {
        const name = ui.newRoomName.value.trim();
        const user = ui.username.value.trim();
        const playersPerTeam = parseInt(ui.playersPerTeamInput.value, 10);
        
        if (!name || !user) return showToast('Name and Room required', 'error');
        if (isNaN(playersPerTeam) || playersPerTeam < 1 || playersPerTeam > 10) {
            return showToast('Players per team must be between 1 and 10', 'error');
        }
        
        state.username = user;
        const result = await api.createRoom(name, playersPerTeam);
        if (result) {
            state.playersPerTeam = result.playersPerTeam;
            joinRoom(result.roomId);
        }
    };
    document.getElementById('btn-refresh-rooms').onclick = refreshRooms;
    document.getElementById('btn-ready').onclick = () => {
        if (!state.socket) return;
        state.socket.emit('player_ready', { roomId: state.roomId });
        document.getElementById('btn-ready').innerText = "Waiting for others...";
        document.getElementById('btn-ready').disabled = true;
    };
    document.getElementById('btn-lobby-return').onclick = () => location.reload();
  document.getElementById('btn-play-again').onclick = () => {
    if (!state.socket || !state.roomId) return;
    document.getElementById('btn-play-again').disabled = true;
    state.socket.emit('restart_match', { roomId: state.roomId });
  };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKey);
}

function setupSocketEvents() {
    const s = state.socket;
    s.on('connect', () => {
        ui.status.innerText = "Connected";
        ui.status.classList.add('connected');
        state.connected = true;
    });
    s.on('disconnect', () => {
        ui.status.innerText = "Disconnected";
        ui.status.classList.remove('connected');
        state.connected = false;
    });
    s.on('error', (err) => showToast(err.message, 'error'));

    s.on('joined_room', (data) => {
        state.roomId = data.roomId;
        state.playerId = data.playerId;
        state.team = data.team;
        state.playersPerTeam = data.playersPerTeam;
        ui.waitRoom.innerText = `(${data.playersPerTeam}v${data.playersPerTeam})`;
        showScreen('waiting');
    });

    s.on('player_joined', (p) => {
        ui.waitMsg.innerText = `${p.username} joined Team ${p.team === 'TEAM_A' ? 'Ice' : 'Water'}`;
    });

    s.on('match_started', () => {
        state.active = true;
        state.snapshots = [];
        showScreen('game');
        showOverlay("MATCH START!", 2000);
    });

    s.on('snapshot', (snap) => {
        if (!state.active) return;
        state.snapshots.push(snap);
        if (state.snapshots.length > 10) state.snapshots.shift();
        
        // FIX: Track raid state and crossing info for UI display
        state.raidState = snap.raidState;
        state.hasCrossedMid = snap.hasCrossedMid;
        state.turn = snap.turn;
        
        // Log diagnostics in dev mode
        if (CONFIG.DEBUG_MODE && state.currentRaiderId === state.playerId) {
            console.log(`[RAID DEBUG] State: ${snap.raidState}, Crossed: ${snap.hasCrossedMid}, Timer: ${snap.raidTimer}s`);
        }
        
        updateHUD(snap);
        state.obstacles = snap.obstacles;
    });

    s.on('raid_start', (data) => {
        // FIX: Enhanced raid start feedback
        state.hasCrossedMid = false;  // Reset crossing state for new raid
        const myTeamRaid = data.team === state.team;
        const msg = myTeamRaid ? "YOUR TEAM ATTACKS!" : "DEFEND!";
        ui.statusText.innerText = msg;
        if (data.raider === state.playerId) {
            showOverlay("🎯 YOU ARE THE RAIDER!", 1500);
            if (CONFIG.DEBUG_MODE) console.log('[RAID] You are the raider - cross the midline and return safely!');
        } else {
            showOverlay(msg, 1000);
        }
    });

    // FIX: Enhanced raid result with detailed feedback and diagnostics
    s.on('raid_result', (data) => {
        let text = '';
        if (data.success) {
            const emoji = data.touches > 0 ? '🎉' : '✅';
            text = `${emoji} RAID SUCCESS! +${data.points} pts`;
        } else {
            text = `❌ RAID FAILED (${data.reason})`;
            if (CONFIG.DEBUG_MODE) {
                console.log(`[RAID FAIL DEBUG] Reason: ${data.reason}, Crossed: ${data.hasCrossedMid}, Touches: ${data.touches}`);
            }
            
            // STEP 3: Detect teleport event and trigger visual effect
            if (data.reason === 'Time Expired' && data.raiderTeam === state.team) {
                // Get the raider from latest snapshot
                const snap = state.snapshots[state.snapshots.length - 1];
                if (snap) {
                    const raider = snap.players.find(p => p.id === data.currentRaiderId || state.currentRaiderId === p.id);
                    if (raider) {
                        // STEP 4: Store teleport animation state
                        state.teleportEffects.push({
                            x: raider.x,
                            y: raider.y,
                            startTime: Date.now()
                        });
                    }
                }
            }
        }
        showOverlay(text, 2500);
    });

    s.on('game_ended', (data) => {
        state.active = false;
        ui.winner.innerText = data.winner === 'DRAW' ? "IT'S A DRAW" : `${data.winner === 'TEAM_A' ? 'ICE' : 'WATER'} WINS!`;
        ui.reason.innerText = data.reason;
        ui.finalA.innerText = data.scores['TEAM_A'];
        ui.finalB.innerText = data.scores['TEAM_B'];
        showScreen('result');
    document.getElementById('btn-play-again').disabled = false;
    });
}

async function refreshRooms() {
    ui.roomList.innerHTML = '<div class="empty-state">Loading...</div>';
    const rooms = await api.getRooms();
    ui.roomList.innerHTML = '';
    if (rooms.length === 0) {
        ui.roomList.innerHTML = '<div class="empty-state">No rooms found.</div>';
        return;
    }
    rooms.forEach(r => {
        const div = document.createElement('div');
        div.className = 'room-card';
        const teamSize = r.playersPerTeam || 2;
        const playerCount = `${r.players}/${teamSize * 2}`;
        div.innerHTML = `<div><h4>${r.name}</h4><p>${playerCount} players (${teamSize}v${teamSize})</p></div>`;
        div.onclick = () => {
            if (!ui.username.value) return showToast('Enter username first', 'error');
            state.username = ui.username.value;
            joinRoom(r.id);
        };
        ui.roomList.appendChild(div);
    });
}

function joinRoom(roomId) {
    state.socket.emit('join_room', { roomId, username: state.username });
}

function handleKey(e) {
    if (!state.active) return;
    const isDown = e.type === 'keydown';
    switch(e.code) {
        case 'KeyW': case 'ArrowUp': state.input.y = isDown ? -1 : 0; break;
        case 'KeyS': case 'ArrowDown': state.input.y = isDown ? 1 : 0; break;
        case 'KeyA': case 'ArrowLeft': state.input.x = isDown ? -1 : 0; break;
        case 'KeyD': case 'ArrowRight': state.input.x = isDown ? 1 : 0; break;
    }
    if (state.input.x !== state.lastSentInput.x || state.input.y !== state.lastSentInput.y) {
        state.lastSentInput = { ...state.input };
        state.socket.emit('input', { roomId: state.roomId, dir: state.input });
    }
}

function gameLoop() {
    if (state.active) render();
    requestAnimationFrame(gameLoop);
}

function render() {
    const ctx = ui.ctx;
    const width = CONFIG.CANVAS_WIDTH;
    const height = CONFIG.CANVAS_HEIGHT;

    // Clear
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    // Safe Zones - with enhanced visibility for raid state
    if (state.raidState === 'ACTIVE') {
        // Highlight safe zones more prominently during active raid
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';  // Green glow during raid
        ctx.fillRect(0, 0, width, CONFIG.SAFE_ZONE_HEIGHT);
        ctx.fillRect(0, height - CONFIG.SAFE_ZONE_HEIGHT, width, CONFIG.SAFE_ZONE_HEIGHT);
        
        // Draw border for safe zones
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, width, CONFIG.SAFE_ZONE_HEIGHT);
        ctx.strokeRect(0, height - CONFIG.SAFE_ZONE_HEIGHT, width, CONFIG.SAFE_ZONE_HEIGHT);
    } else {
        // Normal display
        ctx.fillStyle = CONFIG.COLORS.SAFE_ZONE;
        ctx.fillRect(0, 0, width, CONFIG.SAFE_ZONE_HEIGHT);
        ctx.fillRect(0, height - CONFIG.SAFE_ZONE_HEIGHT, width, CONFIG.SAFE_ZONE_HEIGHT);
    }

    // Center Line - highlight if crossed
    ctx.strokeStyle = state.hasCrossedMid ? CONFIG.COLORS.CENTER_LINE_CROSSED : CONFIG.COLORS.CENTER_LINE;
    ctx.lineWidth = state.hasCrossedMid ? 4 : 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // FIX: Add midline crossing label when in raid
    if (state.raidState === 'ACTIVE' && state.hasCrossedMid) {
        ctx.fillStyle = 'rgba(244, 63, 94, 0.8)';
        ctx.font = 'bold 14px Inter';
        ctx.fillText('🚩 MID CROSSED', width / 2 - 50, height / 2 - 15);
    }

    // Obstacles
    ctx.fillStyle = CONFIG.COLORS.OBSTACLE;
    state.obstacles.forEach(obs => {
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
        ctx.strokeStyle = '#475569';
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
    });

    // STEP 5: Render teleport animation
    renderTeleportEffects(ctx, width, height);

    // Players
    const playersToRender = getInterpolatedState();

    playersToRender.forEach(p => {
        const drawX = p.x;
        const drawY = p.y;
        const isActive = (p.act === 1);

        if (isActive) {
            // Active player - regular circle
            ctx.beginPath();
            ctx.arc(drawX, drawY, 10, 0, Math.PI * 2);
            ctx.fillStyle = (p.team === 'TEAM_A') ? CONFIG.COLORS.TEAM_A : CONFIG.COLORS.TEAM_B;
            
            // Raider Glow
            if (state.currentRaiderId === p.id) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = CONFIG.COLORS.RAIDER_GLOW;
            } else {
                ctx.shadowBlur = 0;
            }

            ctx.fill();
            ctx.shadowBlur = 0; // Reset

            // Ring for Me
            if (p.id === state.playerId) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        } else {
            // Frozen/Eliminated player - ice crystal
            drawFrozenIcePlayer(ctx, drawX, drawY, p.id === state.playerId);
        }

        // Player name tag (always visible)
        drawPlayerNameTag(ctx, p, drawX, drawY);
    });
}

function getInterpolatedState() {
    const now = Date.now();
    const renderTime = now - CONFIG.INTERPOLATION_OFFSET;
    const buffer = state.snapshots;
    if (buffer.length < 2) return buffer[0] ? buffer[0].players : [];

    let t1 = buffer[0], t2 = buffer[1];
    for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i].t <= renderTime && buffer[i+1].t >= renderTime) {
            t1 = buffer[i]; t2 = buffer[i+1]; break;
        }
    }
    if (renderTime > t2.t) t1 = t2;

    const total = t2.t - t1.t;
    const portion = renderTime - t1.t;
    const alpha = total > 0 ? portion / total : 0;

    return t2.players.map(p2 => {
        const p1 = t1.players.find(p => p.id === p2.id);
        if (!p1 || Math.abs(p2.x - p1.x) > 50 || Math.abs(p2.y - p1.y) > 50) return p2;
        return {
            id: p2.id,
            username: p2.username,
            x: lerp(p1.x, p2.x, alpha),
            y: lerp(p1.y, p2.y, alpha),
            act: p2.act,
            team: p2.team // Ensure team is carried over
        };
    });
}

function drawPlayerNameTag(ctx, p, x, y) {
    const name = (p && p.username) ? String(p.username) : '';
    if (!name) return;

    const isMe = p.id === state.playerId;
    const radius = 10;
    const gap = 8;          // space between player head and arrow tip
    const arrowH = 6;
    const arrowW = 12;
    const fontSize = 12;

    ctx.save();
    ctx.font = `600 ${fontSize}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textW = ctx.measureText(name).width;
    const padX = 8;
    const padY = 5;
    const boxW = Math.min(CONFIG.CANVAS_WIDTH - 10, textW + padX * 2);
    const boxH = fontSize + padY * 2;
    const r = 8;
    const arrowTipY = y - radius - gap;
    const boxBottom = arrowTipY - arrowH;
    let bx = Math.max(5, Math.min(CONFIG.CANVAS_WIDTH - 5 - boxW, x - boxW / 2));
    let by = boxBottom - boxH;
    if (by < 5) {
        const delta = 5 - by;
        by = 5;
        // Move tip up as needed to keep separation from player
        const adjustedBoxBottom = by + boxH;
        const adjustedArrowTip = Math.min(arrowTipY - delta, adjustedBoxBottom - 4);
        const tipToHeadGap = (y - radius) - adjustedArrowTip;
        if (tipToHeadGap < gap) {
            // ensure arrow tip still above player head
            by -= (gap - tipToHeadGap);
        }
    }

    const pointerBaseY = by + boxH;
    const clampMin = bx + r + arrowW / 2;
    const clampMax = bx + boxW - r - arrowW / 2;
    const pointerX = Math.max(clampMin, Math.min(clampMax, x));
    const pointerTipY = arrowTipY;

    // background
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = isMe ? 'rgba(255,255,255,0.16)' : 'rgba(2,6,23,0.55)';
    roundRect(ctx, bx, by, boxW, boxH, r);
    ctx.fill();

    // pointer (arrow)
    ctx.beginPath();
    ctx.moveTo(pointerX - arrowW / 2, pointerBaseY);
    ctx.lineTo(pointerX + arrowW / 2, pointerBaseY);
    ctx.lineTo(pointerX, pointerTipY);
    ctx.closePath();
    ctx.fill();

    // outline
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.55)' : 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRect(ctx, bx, by, boxW, boxH, r);
    ctx.moveTo(pointerX - arrowW / 2, pointerBaseY);
    ctx.lineTo(pointerX + arrowW / 2, pointerBaseY);
    ctx.lineTo(pointerX, pointerTipY);
    ctx.closePath();
    ctx.stroke();

    // text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, bx + boxW / 2, by + boxH / 2);

    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/**
 * Draw a frozen ice crystal player
 * Eliminated players are rendered as ice crystals at their last position
 */
function drawFrozenIcePlayer(ctx, x, y, isMe) {
    ctx.save();
    
    // Draw a simple but visible ice crystal
    // Outer 8-pointed star shape for crystal effect
    ctx.beginPath();
    const radius = 10;
    const innerRadius = 6;
    
    for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8 - Math.PI / 2; // Start from top
        const r = i % 2 === 0 ? radius : innerRadius;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        
        if (i === 0) {
            ctx.moveTo(px, py);
        } else {
            ctx.lineTo(px, py);
        }
    }
    ctx.closePath();
    
    // Create gradient for ice effect
    const gradient = ctx.createLinearGradient(x - 15, y - 15, x + 15, y + 15);
    gradient.addColorStop(0, '#a5f3fc');      // Very light cyan
    gradient.addColorStop(0.5, '#7dd3fc');    // Cyan
    gradient.addColorStop(1, '#0284c7');      // Dark blue
    
    // Fill with bright gradient
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 1.0;  // Fully opaque
    ctx.fill();
    
    // Strong white outline for visibility
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 1.0;
    ctx.stroke();
    
    // Ring for Me indicator
    if (isMe) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    ctx.restore();
}

/**
 * Render all active teleport effects
 * Draws expanding rings with fade out animation
 */
function renderTeleportEffects(ctx, width, height) {
    const now = Date.now();
    const DURATION = 400; // Animation duration in ms
    
    // STEP 5: Draw expanding ring or glow pulse at teleport position
    for (let i = state.teleportEffects.length - 1; i >= 0; i--) {
        const effect = state.teleportEffects[i];
        const elapsed = now - effect.startTime;
        
        // Remove effect when animation completes
        if (elapsed >= DURATION) {
            state.teleportEffects.splice(i, 1);
            continue;
        }
        
        // Calculate progress (0 to 1) and fade out
        const progress = elapsed / DURATION;
        const maxRadius = 50;
        const currentRadius = maxRadius * progress;
        
        // Fade out: starts opaque, becomes transparent
        const opacity = 1 - progress;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        
        // Draw expanding ring (bright cyan/teleport color)
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, currentRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Draw a secondary pulsing glow ring
        const secondaryRadius = currentRadius * 0.6;
        ctx.strokeStyle = '#0099ff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = opacity * 0.6;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, secondaryRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.restore();
    }
}

function updateHUD(snap) {
    // Update scores
    if (snap.scores) {
        ui.scoreA.innerText = snap.scores['TEAM_A'] || 0;
        ui.scoreB.innerText = snap.scores['TEAM_B'] || 0;
    }
    
    // Update active players
    if (snap.activePlayers) {
        ui.playersA.innerText = snap.activePlayers['TEAM_A'] || 0;
        ui.playersB.innerText = snap.activePlayers['TEAM_B'] || 0;
    }
    
    // Update timer
    if (snap.timer !== undefined) {
        const m = Math.floor(snap.timer / 60);
        const s = snap.timer % 60;
        ui.timer.innerText = `${m}:${s.toString().padStart(2, '0')}`;
    }

    // FIX: Update raid timer and show state
    if (snap.raidTimer !== undefined) {
        state.raidTimerVal = snap.raidTimer;
        const pct = (snap.raidTimer / 20) * 100;
        ui.raidBar.style.width = `${pct}%`;
        
        // Color bar based on urgency
        if (snap.raidTimer < 5) {
            ui.raidBar.style.backgroundColor = '#ef4444';  // Red: critical
        } else if (snap.raidTimer < 10) {
            ui.raidBar.style.backgroundColor = '#f97316';  // Orange: warning
        } else {
            ui.raidBar.style.backgroundColor = '#f43f5e';  // Normal
        }
    }
    
    // FIX: Display raid state and crossing status in HUD
    if (snap.raidState) {
        let stateDisplay = snap.raidState;
        if (snap.raidState === 'ACTIVE' && snap.hasCrossedMid) {
            stateDisplay = 'ACTIVE (🚩 Crossed)';
        }
        ui.statusText.innerText = stateDisplay;
    }
    
    if (snap.raider) {
        state.currentRaiderId = snap.raider;
    }
}

function lerp(start, end, t) { return start + (end - start) * t; }
function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.remove('active'));
    screens[name].classList.add('active');
    state.screen = name;

    // Layout mode hook (used for hiding header only during gameplay)
    document.body.classList.toggle('in-game', name === 'game');
}
function showOverlay(text, duration) {
    ui.overlayText.innerText = text;
    ui.overlay.classList.remove('hidden');
    setTimeout(() => ui.overlay.classList.add('hidden'), duration);
}
function showToast(msg, type='info') {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.innerText = msg;
    document.getElementById('toast-container').appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

init();