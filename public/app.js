// Grid Thief — Primary Application Controller
// Orchestrates UI state, DOM rendering, network events, input handling, and particle effects.

import { sound } from "./sound.js";
import { NetworkManager } from "./network.js";
import { TOTAL_TILES } from "./game-engine.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// App State
let myPlayerId = null;
let currentRoomCode = null;
let currentState = null;
let isHost = false;
let lastDirection = "right";
let previousGrid = null;
let lastEventTimestamp = 0;
let clockInterval = null;

const SCREENS = {
  home: $("#home-screen"),
  lobby: $("#lobby-screen"),
  game: $("#game-screen"),
  result: $("#result-screen")
};

function switchScreen(targetKey) {
  Object.entries(SCREENS).forEach(([key, el]) => {
    if (el) {
      el.classList.toggle("hidden", key !== targetKey);
    }
  });
}

function escapeHTML(str) {
  const p = document.createElement("p");
  p.textContent = str;
  return p.innerHTML;
}

function showError(msg = "") {
  const errEl = $("#status-error");
  if (errEl) errEl.textContent = msg;
}

// Particle burst effect
function spawnParticleBurst(color, count = 14) {
  const container = $("#particle-canvas");
  if (!container) return;

  for (let i = 0; i < count; i++) {
    const spark = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 110;
    spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    spark.style.backgroundColor = color;
    container.appendChild(spark);
    setTimeout(() => spark.remove(), 620);
  }
}

// Initialize Sound Button
const soundBtn = $("#sound-btn");
const soundLabel = $("#sound-label");

function updateSoundButtonUI() {
  if (soundLabel) {
    soundLabel.textContent = sound.enabled ? "SOUND ON" : "SOUND OFF";
  }
}
updateSoundButtonUI();

soundBtn?.addEventListener("click", () => {
  const active = sound.toggle();
  updateSoundButtonUI();
});

// Wake Web Audio on first user interaction
const wakeAudio = () => {
  sound.ensureContext();
  window.removeEventListener("pointerdown", wakeAudio);
  window.removeEventListener("keydown", wakeAudio);
};
window.addEventListener("pointerdown", wakeAudio, { once: true });
window.addEventListener("keydown", wakeAudio, { once: true });

// Network Setup
const network = new NetworkManager({
  onState: handleGameStateUpdate,
  onError: handleNetworkError,
  onJoined: handleJoinedRoom,
  onPeerCount: updateLobbyPeerCount
});

function handleJoinedRoom(res) {
  if (!res.ok) {
    showError(res.message || "Failed to enter room.");
    return;
  }
  showError("");
  myPlayerId = res.playerId;
  currentRoomCode = res.code;
  isHost = res.isHost;

  const roomDisplay = $("#room-code-display");
  if (roomDisplay) roomDisplay.textContent = currentRoomCode;

  if (res.mode === "solo") {
    switchScreen("game");
  } else {
    switchScreen("lobby");
  }
}

function handleNetworkError(msg) {
  showError(msg);
}

function updateLobbyPeerCount() {
  // Handled on state update
}

function handleGameStateUpdate(state) {
  currentState = state;

  // Trigger event sounds and particle bursts
  if (state.event?.at > lastEventTimestamp && state.event.kind !== "quiet") {
    lastEventTimestamp = state.event.at;
    sound.play(state.event.kind);

    let sparkColor = "#ff3366";
    if (state.event.kind === "freeze") sparkColor = "#00d4ff";
    else if (state.event.kind === "steal") sparkColor = "#ffd166";
    else if (state.event.kind === "finish") sparkColor = "#00f5a0";

    spawnParticleBurst(sparkColor, state.event.kind === "finish" ? 28 : 14);
  }

  if (state.status === "lobby") {
    renderLobbyScreen();
  } else if (state.status === "playing") {
    renderGameScreen();
  } else if (state.status === "finished") {
    renderResultScreen();
  }
}

// LOBBY RENDERING
function renderLobbyScreen() {
  switchScreen("lobby");
  const players = currentState.players || [];
  const host = isHost;

  const heading = $("#lobby-heading");
  const sub = $("#lobby-subheading");
  if (heading) {
    heading.textContent = players.length < 2 ? "Waiting for Operatives" : "Crew Ready";
  }
  if (sub) {
    sub.textContent = host
      ? "Send the room code or invite link. You can also add AI bots or launch now."
      : "Waiting for the room host to launch the match.";
  }

  const crewList = $("#crew-list");
  if (crewList) {
    let html = players.map((p, i) => {
      const isMe = p.id === myPlayerId;
      const role = i === 0 ? "Room Host" : (p.isBot ? "AI Heist Bot" : "Operative");
      return `
        <div class="crew-slot">
          <span class="crew-dot" style="background-color: ${p.color}"></span>
          <div class="crew-details">
            <span class="crew-name">${escapeHTML(p.name)}${isMe ? " (You)" : ""}</span>
            <span class="crew-role">${role}</span>
          </div>
        </div>
      `;
    }).join("");

    const emptySlots = 4 - players.length;
    for (let i = 0; i < emptySlots; i++) {
      html += `
        <div class="crew-slot crew-empty">
          <span class="crew-dot" style="background-color: #3b4559"></span>
          <div class="crew-details">
            <span class="crew-name">Open Channel</span>
            <span class="crew-role">Awaiting rival</span>
          </div>
        </div>
      `;
    }
    crewList.innerHTML = html;
  }

  const addBotBtn = $("#add-bot-btn");
  if (addBotBtn) {
    addBotBtn.style.display = host && players.length < 4 ? "inline-flex" : "none";
  }

  const launchBtn = $("#launch-btn");
  if (launchBtn) {
    launchBtn.disabled = !host || players.length < 1;
    launchBtn.innerHTML = host
      ? `<span>Launch the Heist</span><span class="btn-arrow">→</span>`
      : `<span>Awaiting Host Launch</span>`;
  }
}

// GAME ARENA RENDERING
const POWER_ICONS = {
  freeze: "F",
  steal: "3",
  dash: "D"
};

function renderGameScreen() {
  switchScreen("game");
  const state = currentState;
  const boardEl = $("#game-board");

  // Decode binary grid
  const rawBinary = atob(state.grid);
  const grid = new Uint8Array(state.width * state.height);
  for (let i = 0; i < rawBinary.length; i++) {
    grid[i] = rawBinary.charCodeAt(i);
  }

  const playerColorMap = {};
  state.players.forEach((p, i) => {
    playerColorMap[i + 1] = p.color;
  });

  const playerPositions = new Map();
  state.players.forEach(p => {
    playerPositions.set(`${p.x},${p.y}`, p);
  });

  const powerupPositions = new Map();
  state.powerups.forEach(pow => {
    powerupPositions.set(`${pow.x},${pow.y}`, pow);
  });

  let boardHTML = "";
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const idx = y * state.width + x;
      const owner = grid[idx];
      const playerHere = playerPositions.get(`${x},${y}`);
      const powerHere = powerupPositions.get(`${x},${y}`);

      const tileColor = owner > 0 ? (playerColorMap[owner] || "var(--bg-tile)") : "var(--bg-tile)";
      const isClaimedNew = previousGrid && previousGrid[idx] !== owner && owner > 0;
      const animClass = isClaimedNew ? " claimed-anim" : "";
      const neutralClass = owner === 0 ? " tile-neutral" : "";

      let inner = "";
      if (powerHere) {
        inner += `<span class="powerup-token powerup-${powerHere.type}">${POWER_ICONS[powerHere.type] || "?"}</span>`;
      }
      if (playerHere) {
        const initial = escapeHTML(playerHere.name.charAt(0).toUpperCase());
        inner += `<span class="player-token" style="--player-color: ${playerHere.color}">${initial}</span>`;
      }

      boardHTML += `<div class="tile${neutralClass}${animClass}" style="--tile-color: ${tileColor}">${inner}</div>`;
    }
  }

  if (boardEl) boardEl.innerHTML = boardHTML;
  previousGrid = grid;

  // Scores & Lead
  const scores = [...state.scores];
  const leaderTiles = scores[0]?.tiles || 0;
  const leadPercent = Math.round((leaderTiles / TOTAL_TILES) * 100);

  const leadEl = $("#lead-pct");
  if (leadEl) leadEl.textContent = `${leadPercent}%`;

  const scoresContainer = $("#scores-container");
  if (scoresContainer) {
    scoresContainer.innerHTML = scores.map(s => {
      const pct = Math.round((s.tiles / TOTAL_TILES) * 100);
      const isMe = s.id === myPlayerId;
      return `
        <div class="score-row ${isMe ? "is-me" : ""}">
          <div class="score-head">
            <span class="score-user">
              <span class="score-dot" style="background-color: ${s.color}"></span>
              ${escapeHTML(s.name)}${isMe ? " (You)" : ""}
            </span>
            <span class="score-pct">${pct}%</span>
          </div>
          <div class="score-meter">
            <div class="score-fill" style="width: ${pct}%; background-color: ${s.color}"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  // Dash & Status
  const me = state.players.find(p => p.id === myPlayerId);
  const now = Date.now();
  const dashRemaining = Math.max(0, (me?.dashReadyAt || 0) - now);
  const dashReady = dashRemaining <= 0 && !me?.frozen;

  const dashMeter = $("#dash-meter");
  if (dashMeter) {
    if (me?.frozen) {
      dashMeter.textContent = "FROZEN";
      dashMeter.style.color = "var(--accent-cyan)";
    } else if (dashRemaining > 0) {
      dashMeter.textContent = `${(dashRemaining / 1000).toFixed(1)}s`;
      dashMeter.style.color = "var(--text-muted)";
    } else {
      dashMeter.textContent = "READY";
      dashMeter.style.color = "var(--accent-hot)";
    }
  }

  const mobileDashBtn = $("#mobile-dash");
  if (mobileDashBtn) {
    mobileDashBtn.disabled = !dashReady;
    mobileDashBtn.classList.toggle("is-charged", dashReady);
  }

  const freezeAlert = $("#freeze-alert");
  if (freezeAlert) {
    freezeAlert.classList.toggle("hidden", !me?.frozen);
  }

  const rushAlert = $("#rush-alert");
  if (rushAlert) {
    rushAlert.classList.toggle("hidden", state.endsAt - now > 10000);
  }

  // Event Banner
  const eventBanner = $("#match-event");
  if (eventBanner && state.event) {
    eventBanner.textContent = state.event.text;
    eventBanner.className = `event-ticker ${state.event.kind}`;
  }

  // Timer Tick
  clearInterval(clockInterval);
  updateMatchClock();
  clockInterval = setInterval(updateMatchClock, 200);
}

function updateMatchClock() {
  if (!currentState || currentState.status !== "playing") return;
  const remainingMs = Math.max(0, currentState.endsAt - Date.now());
  const secondsTotal = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(secondsTotal / 60);
  const secs = secondsTotal % 60;
  const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`; // taste-skill-ignore

  const timerEl = $("#match-timer");
  if (timerEl) {
    timerEl.textContent = formatted;
    timerEl.classList.toggle("critical", secondsTotal <= 10);
  }
}

// RESULT RENDERING
function renderResultScreen() {
  clearInterval(clockInterval);
  switchScreen("result");
  const state = currentState;
  const scores = [...state.scores];
  const winner = scores.find(s => s.id === state.winner);

  const titleEl = $("#result-title");
  const summaryEl = $("#result-summary");

  if (titleEl) {
    titleEl.textContent = winner ? `${winner.name} Dominates the Grid` : "The City Remains Divided";
  }

  if (summaryEl) {
    if (winner) {
      const pct = Math.round((winner.tiles / TOTAL_TILES) * 100);
      summaryEl.textContent = `${winner.name} secured ${pct}% of total territory (${winner.tiles} tiles) before the clock expired.`;
    } else {
      summaryEl.textContent = "A ruthless deadlock. No single operative was able to break the territory tie.";
    }
  }

  const scoreboard = $("#final-scoreboard");
  if (scoreboard) {
    scoreboard.innerHTML = scores.map((s, idx) => {
      const isWinner = s.id === state.winner;
      const isMe = s.id === myPlayerId;
      return `
        <div class="scoreboard-item ${isWinner ? "is-winner" : ""}">
          <span class="rank-badge">${idx + 1}</span>
          <span class="crew-dot" style="background-color: ${s.color}"></span>
          <span class="rank-user">${escapeHTML(s.name)}${isMe ? " (You)" : ""}</span>
          <span class="rank-stat">${s.tiles} tiles</span>
        </div>
      `;
    }).join("");
  }
}

// INPUT DISPATCH
function triggerMove(dir, dash = false) {
  lastDirection = dir;
  sound.play(dash ? "dash" : "move");
  network.sendMove({ dir, dash });
}

// Virtual D-Pad bindings
$$("[data-dir]").forEach(btn => {
  btn.addEventListener("pointerdown", e => {
    e.preventDefault();
    triggerMove(btn.dataset.dir, false);
  });
});

$("#mobile-dash")?.addEventListener("pointerdown", e => {
  e.preventDefault();
  triggerMove(lastDirection, true);
});

// Keyboard bindings
window.addEventListener("keydown", e => {
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

  const keyMap = {
    ArrowUp: "up",
    KeyW: "up",
    w: "up",
    W: "up",
    ArrowDown: "down",
    KeyS: "down",
    s: "down",
    S: "down",
    ArrowLeft: "left",
    KeyA: "left",
    a: "left",
    A: "left",
    ArrowRight: "right",
    KeyD: "right",
    d: "right",
    D: "right"
  };

  if (keyMap[e.code] || keyMap[e.key]) {
    e.preventDefault();
    triggerMove(keyMap[e.code] || keyMap[e.key], false);
  } else if (e.code === "Space" || e.key === "Shift") {
    e.preventDefault();
    triggerMove(lastDirection, true);
  }
});

// Touch Swipe Gestures for Mobile Board
let touchStartX = 0;
let touchStartY = 0;
let lastTapTime = 0;

const boardEl = $("#game-board");
boardEl?.addEventListener("touchstart", e => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;

  // Double-tap to Dash
  const now = Date.now();
  if (now - lastTapTime < 300) {
    triggerMove(lastDirection, true);
  }
  lastTapTime = now;
}, { passive: true });

boardEl?.addEventListener("touchend", e => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (Math.max(absX, absY) > 24) {
    if (absX > absY) {
      triggerMove(dx > 0 ? "right" : "left", false);
    } else {
      triggerMove(dy > 0 ? "down" : "up", false);
    }
  }
}, { passive: true });

// UI Action Buttons
$("#solo-btn")?.addEventListener("click", () => {
  const name = $("#player-name")?.value || "Operative";
  network.startSolo(name, 3);
});

$("#create-btn")?.addEventListener("click", () => {
  const name = $("#player-name")?.value || "Operative";
  network.createRoom(name);
});

$("#join-btn")?.addEventListener("click", () => {
  const name = $("#player-name")?.value || "Operative";
  const code = $("#code-input")?.value;
  if (!code || code.length < 4) {
    showError("Please enter a valid 4-character room code.");
    return;
  }
  network.joinRoom(code, name);
});

const codeInput = $("#code-input");
codeInput?.addEventListener("input", e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("#add-bot-btn")?.addEventListener("click", () => {
  network.addBotToLobby();
});

$("#launch-btn")?.addEventListener("click", () => {
  network.launchMatch();
});

$("#rematch-btn")?.addEventListener("click", () => {
  window.location.reload();
});

$("#copy-btn")?.addEventListener("click", async () => {
  const copyBtn = $("#copy-btn");
  if (!currentRoomCode) return;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    if (copyBtn) {
      copyBtn.textContent = "Link Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy Invite Link"; }, 1500);
    }
  } catch {
    // Fallback if clipboard API denied
    if (copyBtn) copyBtn.textContent = `Code: ${currentRoomCode}`;
  }
});

// Check URL Params for instant room join invite
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get("room");
if (roomParam && codeInput) {
  codeInput.value = roomParam.trim().toUpperCase().slice(0, 4);
  const nameInput = $("#player-name");
  if (nameInput) nameInput.focus();
}
