// Networking Layer for Grid Thief
// Supports both zero-server P2P WebRTC Multiplayer (via PeerJS) and Local Solo/Bot Play.

import { GameEngine, generateRoomCode } from "./game-engine.js";

const PEER_PREFIX = "grid-thief-v2-";

export class NetworkManager {
  constructor({ onState, onError, onJoined, onPeerCount }) {
    this.mode = "none"; // 'solo' | 'host' | 'client'
    this.engine = null;
    this.peer = null;
    this.connections = new Map(); // connId -> conn
    this.clientConn = null;
    this.myPlayerId = null;
    this.roomCode = null;
    this.tickTimer = null;
    this.onState = onState;
    this.onError = onError;
    this.onJoined = onJoined;
    this.onPeerCount = onPeerCount;
  }

  isHost() {
    return this.mode === "solo" || this.mode === "host";
  }

  // --- SOLO / BOT MODE ---
  startSolo(playerName, botCount = 3) {
    this.cleanup();
    this.mode = "solo";
    this.roomCode = "SOLO";
    this.myPlayerId = "player-local";

    this.engine = new GameEngine(this.roomCode);
    this.engine.addPlayer(this.myPlayerId, playerName || "Operative", false);

    const botNames = ["Phantom", "Cyber_Rex", "Valkyrie", "Zero"];
    for (let i = 0; i < Math.min(botCount, 3); i++) {
      this.engine.addPlayer(`bot-${i + 1}`, botNames[i] || `Bot_${i + 1}`, true);
    }

    this.onJoined?.({
      ok: true,
      code: this.roomCode,
      playerId: this.myPlayerId,
      isHost: true,
      mode: "solo"
    });

    // Start match immediately in solo mode
    this.engine.startMatch();
    this.startHostLoop();
  }

  // --- WEBRTC HOST MODE ---
  async createRoom(playerName) {
    this.cleanup();
    this.mode = "host";
    const code = generateRoomCode();
    this.roomCode = code;
    this.myPlayerId = `host-${Math.random().toString(36).slice(2, 8)}`;

    this.engine = new GameEngine(code);
    this.engine.addPlayer(this.myPlayerId, playerName || "Host", false);

    if (typeof window.Peer === "undefined") {
      this.onError?.("PeerJS library not loaded. Check internet connection.");
      return;
    }

    const hostPeerId = `${PEER_PREFIX}${code.toLowerCase()}`;

    try {
      this.peer = new window.Peer(hostPeerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" }
          ]
        }
      });

      this.peer.on("open", () => {
        this.onJoined?.({
          ok: true,
          code: this.roomCode,
          playerId: this.myPlayerId,
          isHost: true,
          mode: "host"
        });
        this.startHostLoop();
      });

      this.peer.on("connection", conn => {
        conn.on("open", () => {
          conn.on("data", data => {
            this.handleHostReceivedData(conn, data);
          });
          conn.on("close", () => {
            this.handleHostPeerDisconnect(conn);
          });
        });
      });

      this.peer.on("error", err => {
        console.warn("PeerJS Host Error:", err);
        if (err.type === "unavailable-id") {
          // Collision: retry with fresh code
          this.createRoom(playerName);
        } else {
          this.onError?.(err.message || "Failed to establish P2P room channel.");
        }
      });
    } catch (e) {
      console.error(e);
      this.onError?.("Could not initialize P2P host.");
    }
  }

  // --- WEBRTC JOIN CLIENT MODE ---
  async joinRoom(code, playerName) {
    this.cleanup();
    this.mode = "client";
    const cleanCode = String(code || "").trim().toUpperCase();
    this.roomCode = cleanCode;
    this.myPlayerId = `peer-${Math.random().toString(36).slice(2, 8)}`;

    if (typeof window.Peer === "undefined") {
      this.onError?.("PeerJS library not loaded.");
      return;
    }

    const targetPeerId = `${PEER_PREFIX}${cleanCode.toLowerCase()}`;

    try {
      this.peer = new window.Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" }
          ]
        }
      });

      this.peer.on("open", () => {
        const conn = this.peer.connect(targetPeerId, { reliable: true });
        this.clientConn = conn;

        conn.on("open", () => {
          conn.send({
            type: "join",
            playerId: this.myPlayerId,
            name: playerName || "Rival"
          });
        });

        conn.on("data", data => {
          if (data.type === "join-reply") {
            if (data.ok) {
              this.onJoined?.({
                ok: true,
                code: this.roomCode,
                playerId: this.myPlayerId,
                isHost: false,
                mode: "client"
              });
            } else {
              this.onError?.(data.message || "Could not join room.");
            }
          } else if (data.type === "state") {
            this.onState?.(data.state);
          }
        });

        conn.on("close", () => {
          this.onError?.("Connection to room host was closed.");
        });

        conn.on("error", () => {
          this.onError?.("Connection error while talking to host.");
        });
      });

      this.peer.on("error", err => {
        console.warn("PeerJS Client Error:", err);
        if (err.type === "peer-unavailable") {
          this.onError?.("Room not found. Check code or verify the host is online.");
        } else {
          this.onError?.(err.message || "Failed to reach room.");
        }
      });
    } catch (e) {
      console.error(e);
      this.onError?.("Could not connect to room.");
    }
  }

  // --- HOST DATA DISPATCH ---
  handleHostReceivedData(conn, data) {
    if (!this.engine) return;

    if (data.type === "join") {
      if (this.engine.status === "playing" || this.engine.players.length >= 4) {
        conn.send({
          type: "join-reply",
          ok: false,
          message: "Match is already in progress or room is full."
        });
        return;
      }

      const player = this.engine.addPlayer(data.playerId, data.name, false);
      if (player) {
        this.connections.set(data.playerId, conn);
        conn.send({ type: "join-reply", ok: true, playerId: data.playerId });
        this.broadcastState();
        this.onPeerCount?.(this.engine.players.length);
      }
    } else if (data.type === "move") {
      this.engine.movePlayer(data.playerId, data.input);
      this.broadcastState();
    }
  }

  handleHostPeerDisconnect(conn) {
    let disconnectedPlayerId = null;
    for (const [id, c] of this.connections.entries()) {
      if (c === conn) {
        disconnectedPlayerId = id;
        break;
      }
    }
    if (disconnectedPlayerId && this.engine) {
      this.connections.delete(disconnectedPlayerId);
      this.engine.removePlayer(disconnectedPlayerId);
      this.broadcastState();
      this.onPeerCount?.(this.engine.players.length);
    }
  }

  addBotToLobby() {
    if (!this.isHost() || !this.engine) return;
    if (this.engine.players.length >= 4) return;
    const botIdx = this.engine.players.filter(p => p.isBot).length + 1;
    const botNames = ["Phantom", "Valkyrie", "Cypher", "Apex"];
    const name = botNames[(botIdx - 1) % botNames.length];
    this.engine.addPlayer(`bot-${Date.now()}`, name, true);
    this.broadcastState();
    this.onPeerCount?.(this.engine.players.length);
  }

  removeBotFromLobby(botId) {
    if (!this.isHost() || !this.engine) return;
    this.engine.removePlayer(botId);
    this.broadcastState();
    this.onPeerCount?.(this.engine.players.length);
  }

  launchMatch() {
    if (!this.isHost() || !this.engine) return false;
    const ok = this.engine.startMatch();
    if (ok) {
      this.broadcastState();
    }
    return ok;
  }

  sendMove(input) {
    if (this.isHost()) {
      if (this.engine) {
        this.engine.movePlayer(this.myPlayerId, input);
        this.broadcastState();
      }
    } else if (this.clientConn && this.clientConn.open) {
      this.clientConn.send({
        type: "move",
        playerId: this.myPlayerId,
        input
      });
    }
  }

  startHostLoop() {
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      if (this.engine) {
        this.engine.stepTick();
        this.broadcastState();
      }
    }, 180);
    this.broadcastState();
  }

  broadcastState() {
    if (!this.engine) return;
    const state = this.engine.getStateSnapshot();
    // Dispatch local UI
    this.onState?.(state);

    // Broadcast to all connected WebRTC peers
    if (this.connections.size > 0) {
      const msg = { type: "state", state };
      for (const conn of this.connections.values()) {
        if (conn.open) {
          try {
            conn.send(msg);
          } catch {
            // Channel write handle
          }
        }
      }
    }
  }

  cleanup() {
    clearInterval(this.tickTimer);
    this.tickTimer = null;

    if (this.clientConn) {
      try { this.clientConn.close(); } catch {}
      this.clientConn = null;
    }

    for (const conn of this.connections.values()) {
      try { conn.close(); } catch {}
    }
    this.connections.clear();

    if (this.peer) {
      try { this.peer.destroy(); } catch {}
      this.peer = null;
    }

    this.engine = null;
    this.mode = "none";
    this.roomCode = null;
  }
}
