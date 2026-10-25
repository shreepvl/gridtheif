// Synthesized Web Audio Effects for Grid Thief
// Generates clean retro electronic sound effects with zero external audio assets.

class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem("grid_thief_sound") !== "off";
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("grid_thief_sound", this.enabled ? "on" : "off");
    if (this.enabled) {
      this.ensureContext();
      this.playTone(520, 0.08, "triangle", 0.04, 660);
    }
    return this.enabled;
  }

  playTone(freqStart, duration = 0.08, waveType = "sine", volume = 0.04, freqEnd = freqStart) {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = waveType;
      osc.frequency.setValueAtTime(Math.max(20, freqStart), now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // AudioContext policy catch
    }
  }

  play(kind) {
    if (!this.enabled) return;
    switch (kind) {
      case "move":
        this.playTone(280, 0.04, "triangle", 0.015, 340);
        break;
      case "dash":
        this.playTone(160, 0.16, "sawtooth", 0.04, 520);
        break;
      case "freeze":
        this.playTone(720, 0.28, "sine", 0.05, 120);
        break;
      case "steal":
        this.playTone(340, 0.22, "square", 0.035, 780);
        break;
      case "drop":
        this.playTone(480, 0.12, "sine", 0.03, 880);
        break;
      case "start":
        this.playTone(260, 0.2, "triangle", 0.05, 600);
        break;
      case "finish":
        this.playTone(440, 0.35, "sine", 0.05, 880);
        break;
      case "countdown":
        this.playTone(800, 0.05, "sine", 0.02, 700);
        break;
      default:
        this.playTone(300, 0.05, "triangle", 0.02, 380);
    }
  }
}

export const sound = new SoundManager();
