// Grid Thief Authoritative Game Engine
// Handles grid state, movement, dashes, power-ups, scoring, and bot AI.

export const GRID_W = 16;
export const GRID_H = 12;
export const TOTAL_TILES = GRID_W * GRID_H; // 192
export const MATCH_DURATION = 60000; // 60 seconds
export const DROP_INTERVAL = 7500; // 7.5 seconds
export const DASH_COOLDOWN = 3600; // 3.6 seconds
export const FREEZE_DURATION = 2400; // 2.4 seconds

export const PLAYER_COLORS = [
  "#ff3366", // Player 1 - Crimson Red
  "#00d4ff", // Player 2 - Cyber Cyan
  "#ffd166", // Player 3 - Solar Gold
  "#00f5a0"  // Player 4 - Neon Mint
];

export const SPAWN_POINTS = [
  { x: 1, y: 1 },
  { x: GRID_W - 2, y: GRID_H - 2 },
  { x: GRID_W - 2, y: 1 },
  { x: 1, y: GRID_H - 2 }
];

export const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0]
};

export function getCellIndex(x, y) {
  return y * GRID_W + x;
}

export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class GameEngine {
  constructor(roomCode = generateRoomCode()) {
    this.roomCode = roomCode;
    this.status = "lobby"; // lobby | playing | finished
    this.grid = new Uint8Array(TOTAL_TILES);
    this.players = [];
    this.powerups = [];
    this.endsAt = 0;
    this.lastDrop = 0;
    this.freeze = 0;
    this.freezeBy = null;
    this.winner = null;
    this.event = { text: "Assembling crew", kind: "quiet", at: Date.now() };
    this.onStateChange = null;
  }

  addPlayer(id, name, isBot = false) {
    if (this.players.length >= 4 || this.status === "playing") return null;
    const cleanName = String(name || "Thief").trim().slice(0, 14) || "Thief";
    const playerIndex = this.players.length;
    const player = {
      id,
      name: cleanName,
      color: PLAYER_COLORS[playerIndex],
      isBot,
      x: 0,
      y: 0,
      chain: 0,
      lastMove: 0,
      lastCapture: 0,
      dashReadyAt: 0,
      direction: "right"
    };
    this.players.push(player);
    this.emitEvent(`${cleanName} entered the room`, "quiet");
    return player;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;
    const removed = this.players.splice(idx, 1)[0];
    // Re-assign colors to remaining players
    this.players.forEach((p, i) => {
      p.color = PLAYER_COLORS[i];
    });
    this.emitEvent(`${removed.name} left the room`, "quiet");
    if (this.status === "playing" && this.players.length < 2 && !this.players.some(p => p.isBot)) {
      this.endMatch();
    }
  }

  startMatch() {
    if (this.status === "playing" || this.players.length < 1) return false;
    this.status = "playing";
    this.endsAt = Date.now() + MATCH_DURATION;
    this.lastDrop = Date.now();
    this.grid.fill(0);
    this.powerups = [];
    this.freeze = 0;
    this.freezeBy = null;
    this.winner = null;

    this.players.forEach((p, i) => {
      const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
      p.x = spawn.x;
      p.y = spawn.y;
      p.chain = 0;
      p.lastMove = 0;
      p.lastCapture = 0;
      p.dashReadyAt = Date.now() + 1000;
      this.grid[getCellIndex(p.x, p.y)] = i + 1;
    });

    this.emitEvent("The grid is live. Claim everything.", "start");
    return true;
  }

  endMatch() {
    if (this.status !== "playing") return;
    this.status = "finished";
    const scores = this.getScores();
    if (scores.length > 0 && (scores.length === 1 || scores[0].tiles > (scores[1]?.tiles || 0))) {
      this.winner = scores[0].id;
      this.emitEvent(`${scores[0].name} secured the grid`, "finish");
    } else {
      this.winner = null;
      this.emitEvent("Deadlock. The city remains divided.", "finish");
    }
  }

  emitEvent(text, kind = "quiet") {
    this.event = { text, kind, at: Date.now() };
  }

  getOpenTile() {
    const occupied = new Set(this.players.map(p => getCellIndex(p.x, p.y)));
    this.powerups.forEach(p => occupied.add(getCellIndex(p.x, p.y)));
    const openTiles = [];
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        const idx = getCellIndex(x, y);
        if (!occupied.has(idx)) {
          openTiles.push({ x, y });
        }
      }
    }
    if (openTiles.length === 0) return { x: 4, y: 4 };
    return openTiles[Math.floor(Math.random() * openTiles.length)];
  }

  spawnPowerup() {
    const types = ["freeze", "steal", "dash"];
    const type = types[Math.floor(Math.random() * types.length)];
    const tile = this.getOpenTile();
    this.powerups = [{ x: tile.x, y: tile.y, type }];
    const label = type === "freeze" ? "Cryo Freeze dropped" : (type === "steal" ? "Block Heist dropped" : "Turbo Dash dropped");
    this.emitEvent(label, "drop");
  }

  movePlayer(id, input) {
    const now = Date.now();
    const p = this.players.find(x => x.id === id);
    if (!p || this.status !== "playing") return false;

    const dir = typeof input === "string" ? input : input?.dir;
    const dash = Boolean(input?.dash);
    const v = DIRECTIONS[dir];
    if (!v) return false;

    // Movement debounce (95ms for regular, allows quick navigation)
    if (now - p.lastMove < 95) return false;

    // Freeze check
    const isFrozen = this.freeze > now && this.freezeBy !== p.id;
    if (isFrozen) return false;

    // Dash cooldown check
    if (dash && now < p.dashReadyAt) return false;

    const stepsCount = dash ? 2 : 1;
    const steps = [];
    for (let i = 1; i <= stepsCount; i++) {
      steps.push({ x: p.x + v[0] * i, y: p.y + v[1] * i });
    }

    // Collision check against walls and other players
    for (const step of steps) {
      if (step.x < 0 || step.x >= GRID_W || step.y < 0 || step.y >= GRID_H) {
        return false;
      }
      if (this.players.some(other => other !== p && other.x === step.x && other.y === step.y)) {
        return false;
      }
    }

    p.lastMove = now;
    p.direction = dir;
    const target = steps[steps.length - 1];
    p.x = target.x;
    p.y = target.y;

    if (dash) {
      p.dashReadyAt = now + DASH_COOLDOWN;
      this.emitEvent(`${p.name} dashed across the grid`, "dash");
    }

    const playerNumber = this.players.indexOf(p) + 1;
    for (const s of steps) {
      const idx = getCellIndex(s.x, s.y);
      const isNeutral = this.grid[idx] === 0;
      this.grid[idx] = playerNumber;
      if (isNeutral) {
        p.chain = now - p.lastCapture < 1200 ? p.chain + 1 : 1;
      }
      p.lastCapture = now;
    }

    // Powerup pickup
    const powerIdx = this.powerups.findIndex(q => q.x === p.x && q.y === p.y);
    if (powerIdx !== -1) {
      const power = this.powerups.splice(powerIdx, 1)[0];
      if (power.type === "freeze") {
        this.freeze = now + FREEZE_DURATION;
        this.freezeBy = p.id;
        this.emitEvent(`${p.name} froze rival systems`, "freeze");
      } else if (power.type === "steal") {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
              this.grid[getCellIndex(nx, ny)] = playerNumber;
            }
          }
        }
        this.emitEvent(`${p.name} stole a 3x3 territory block`, "steal");
      } else if (power.type === "dash") {
        p.dashReadyAt = now;
        this.emitEvent(`${p.name} fully restored Dash`, "dash");
      }
    } else if (p.chain >= 5 && p.chain % 5 === 0) {
      this.emitEvent(`${p.name} is on a ${p.chain} tile streak`, "chain");
    }

    return true;
  }

  stepTick() {
    if (this.status !== "playing") return;
    const now = Date.now();

    if (now >= this.endsAt) {
      this.endMatch();
      return;
    }

    if (now - this.lastDrop >= DROP_INTERVAL) {
      this.lastDrop = now;
      this.spawnPowerup();
    }

    // Execute Bot AI moves
    this.stepBots(now);
  }

  stepBots(now) {
    for (const bot of this.players) {
      if (!bot.isBot) continue;
      if (now - bot.lastMove < 210) continue;
      if (this.freeze > now && this.freezeBy !== bot.id) continue;

      const botNum = this.players.indexOf(bot) + 1;
      const validMoves = [];

      for (const [dir, v] of Object.entries(DIRECTIONS)) {
        const nx = bot.x + v[0];
        const ny = bot.y + v[1];
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
        if (this.players.some(o => o !== bot && o.x === nx && o.y === ny)) continue;

        let score = 10;
        const targetTile = this.grid[getCellIndex(nx, ny)];
        if (targetTile === 0) score += 25; // neutral tile preference
        else if (targetTile !== botNum) score += 35; // stealing enemy tile!

        // Target powerups
        for (const pow of this.powerups) {
          const dist = Math.abs(pow.x - nx) + Math.abs(pow.y - ny);
          if (dist === 0) score += 100;
          else score += Math.max(0, 50 - dist * 10);
        }

        // Avoid turning back immediately if possible
        if (dir === bot.direction) score += 5;

        validMoves.push({ dir, score, nx, ny, v });
      }

      if (validMoves.length > 0) {
        validMoves.sort((a, b) => b.score - a.score);
        const best = validMoves[0];

        // Check if dash is smart (e.g. powerup 2 steps away)
        let useDash = false;
        if (now >= bot.dashReadyAt) {
          const d2x = bot.x + best.v[0] * 2;
          const d2y = bot.y + best.v[1] * 2;
          if (
            d2x >= 0 && d2x < GRID_W && d2y >= 0 && d2y < GRID_H &&
            !this.players.some(o => o !== bot && o.x === d2x && o.y === d2y)
          ) {
            const hasPow = this.powerups.some(p => p.x === d2x && p.y === d2y);
            const enemyTile = this.grid[getCellIndex(d2x, d2y)] !== botNum;
            if (hasPow || (enemyTile && Math.random() < 0.35)) {
              useDash = true;
            }
          }
        }

        this.movePlayer(bot.id, { dir: best.dir, dash: useDash });
      }
    }
  }

  getScores() {
    const counts = new Array(this.players.length + 1).fill(0);
    for (let i = 0; i < TOTAL_TILES; i++) {
      const val = this.grid[i];
      if (val > 0 && val <= this.players.length) {
        counts[val]++;
      }
    }
    return this.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      tiles: counts[i + 1] || 0,
      chain: p.chain
    })).sort((a, b) => b.tiles - a.tiles);
  }

  getStateSnapshot() {
    const now = Date.now();
    let binary = "";
    for (let i = 0; i < TOTAL_TILES; i++) {
      binary += String.fromCharCode(this.grid[i]);
    }
    const gridBase64 = btoa(binary);

    return {
      code: this.roomCode,
      status: this.status,
      width: GRID_W,
      height: GRID_H,
      grid: gridBase64,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        x: p.x,
        y: p.y,
        chain: p.chain,
        frozen: this.freeze > now && this.freezeBy !== p.id,
        dashReadyAt: p.dashReadyAt
      })),
      powerups: this.powerups,
      endsAt: this.endsAt,
      scores: this.getScores(),
      winner: this.winner,
      event: this.event
    };
  }
}
