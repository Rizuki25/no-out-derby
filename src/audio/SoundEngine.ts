import { GameEvent } from '../types.ts';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private bgmEnabled = true;
  private bgmPlaying = false;
  private bgmStep = 0;
  private nextNoteTime = 0;
  private bgmIntervalId: number | null = null;
  private bgmTempoMultiplier = 1.0;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  setBgmFastMode(fast: boolean): void {
    this.bgmTempoMultiplier = fast ? 1.28 : 1.0;
  }

  startBgm(): void {
    if (!this.bgmEnabled || this.bgmPlaying) return;
    this.unlock();
    if (!this.ctx) return;
    this.bgmPlaying = true;
    this.bgmStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.bgmIntervalId = window.setInterval(() => this.scheduleBgmNotes(), 45);
  }

  stopBgm(): void {
    this.bgmPlaying = false;
    if (this.bgmIntervalId !== null) {
      clearInterval(this.bgmIntervalId);
      this.bgmIntervalId = null;
    }
  }

  playMenuBlip(confirm = false): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(confirm ? 520 : 380, now);
    if (confirm) {
      osc.frequency.setValueAtTime(760, now + 0.05);
    }
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (confirm ? 0.12 : 0.06));
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + (confirm ? 0.13 : 0.07));
  }

  handleEvents(events: GameEvent[]): void {
    if (this.muted || events.length === 0) return;
    if (!this.ctx || this.ctx.state === 'suspended') return;

    for (const ev of events) {
      switch (ev.type) {
        case 'kick':
          this.playKick(ev.power, ev.isOneTimer);
          break;
        case 'wall_bounce':
          this.playWallBounce(ev.speed, ev.isPinball);
          break;
        case 'post_clang':
          this.playPostClang();
          break;
        case 'save':
          this.playSave();
          break;
        case 'dash':
          this.playDash();
          break;
        case 'tackle':
          this.playTackle(ev.stoleBall);
          break;
        case 'goal':
          this.playGoalCheer(ev.isGoldenGoal);
          break;
        case 'hot_potato_tick':
          this.playHotPotatoTick(ev.urgency);
          break;
        case 'hot_potato_boom':
          this.playExplosion();
          break;
        case 'mutator_start':
          this.playMutatorJingle();
          break;
        case 'whistle':
          this.playWhistle(ev.kind);
          break;
        case 'countdown_beep':
          this.playCountdownBeep(ev.final);
          break;
      }
    }
  }

  private playKick(power: number, isOneTimer = false): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = power >= 0.8 ? 'triangle' : 'sine';
    const startFreq = (135 + power * 95) * (isOneTimer ? 1.25 : 1);
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(isOneTimer ? 52 : 42, now + 0.11 + power * 0.05);
    gain.gain.setValueAtTime(0.22 + power * 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12 + power * 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);

    if (isOneTimer) {
      const sting = this.ctx.createOscillator();
      const sGain = this.ctx.createGain();
      sting.type = 'square';
      sting.frequency.setValueAtTime(480, now);
      sting.frequency.exponentialRampToValueAtTime(920, now + 0.08);
      sGain.gain.setValueAtTime(0.09, now);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      sting.connect(sGain).connect(this.ctx.destination);
      sting.start(now);
      sting.stop(now + 0.12);
    }

    // Extra crisp punch snap on Power Shot
    if (power >= 0.78 && this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.18, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      src.connect(filter).connect(nGain).connect(this.ctx.destination);
      src.start(now);
      src.stop(now + 0.09);
    }
  }

  private playWallBounce(speed: number, isPinball: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const norm = Math.min(1, speed / 260);
    osc.type = isPinball ? 'square' : 'triangle';
    const baseFreq = isPinball ? 360 + norm * 280 : 190 + norm * 110;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(isPinball ? baseFreq * 1.45 : baseFreq * 0.65, now + 0.07);
    gain.gain.setValueAtTime(0.05 + norm * 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  private playPostClang(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freqs = [920, 1390, 2140];
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.27);
    }
  }

  private playDash(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(now);
    src.stop(now + 0.14);
  }

  private playSave(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freqs = [390, 585];
    freqs.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.11);
    });
  }

  private playTackle(stoleBall = false): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(stoleBall ? 210 : 170, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.14);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);

    if (stoleBall) {
      const snap = this.ctx.createOscillator();
      const sGain = this.ctx.createGain();
      snap.type = 'square';
      snap.frequency.setValueAtTime(640, now + 0.03);
      sGain.gain.setValueAtTime(0.08, now + 0.03);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      snap.connect(sGain).connect(this.ctx.destination);
      snap.start(now + 0.03);
      snap.stop(now + 0.12);
    }
  }

  private playWhistle(kind: 'kickoff' | 'fulltime' | 'golden_goal'): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const playTone = (start: number, dur: number, freq: number) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      lfo.frequency.setValueAtTime(36, start);
      lfoGain.gain.setValueAtTime(75, start);
      lfo.connect(lfoGain).connect(osc.frequency);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.11, start + 0.02);
      gain.gain.setValueAtTime(0.11, start + dur - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain).connect(this.ctx.destination);
      osc.start(start);
      lfo.start(start);
      osc.stop(start + dur + 0.01);
      lfo.stop(start + dur + 0.01);
    };

    if (kind === 'kickoff') {
      playTone(now, 0.24, 2450);
    } else if (kind === 'golden_goal') {
      playTone(now, 0.16, 2350);
      playTone(now + 0.2, 0.28, 2650);
    } else {
      playTone(now, 0.14, 2450);
      playTone(now + 0.19, 0.14, 2450);
      playTone(now + 0.39, 0.34, 2550);
    }
  }

  private playGoalCheer(isGoldenGoal: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Filtered white-noise crowd roar (PRD §6.4)
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(700, now);
      filter.frequency.linearRampToValueAtTime(1450, now + 0.35);
      filter.Q.value = 1.4;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
      src.connect(filter).connect(gain).connect(this.ctx.destination);
      src.start(now);
      src.stop(now + 1.1);
    }

    // Retro 8-bit goal fanfare arpeggio
    const notes = isGoldenGoal ? [523, 659, 784, 1046, 1318] : [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  private playHotPotatoTick(urgency: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(720 + urgency * 540, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  private playExplosion(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(620, now);
      filter.frequency.exponentialRampToValueAtTime(95, now + 0.42);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
      src.connect(filter).connect(gain).connect(this.ctx.destination);
      src.start(now);
      src.stop(now + 0.45);
    }
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(125, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  private playMutatorJingle(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      if (!this.ctx) return;
      const t = now + i * 0.055;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.075, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  private playCountdownBeep(final: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(final ? 880 : 440, now);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  private scheduleBgmNotes(): void {
    if (!this.bgmPlaying || !this.ctx || this.ctx.state !== 'running') return;
    const baseBpm = 134 * this.bgmTempoMultiplier;
    const sixteenthDur = 60 / baseBpm / 4;

    // 16-step retro arcade futsal bass + melody pattern (C minor / Dorian groove)
    const bassNotes = [130.8, 0, 130.8, 155.6, 174.6, 0, 196.0, 155.6, 116.5, 0, 116.5, 130.8, 146.8, 0, 196.0, 174.6];
    const leadNotes = [523.3, 0, 622.3, 0, 587.3, 523.3, 466.2, 0, 392.0, 0, 466.2, 523.3, 622.3, 0, 587.3, 466.2];

    while (this.nextNoteTime < this.ctx.currentTime + 0.14) {
      if (!this.muted) {
        const step = this.bgmStep % 16;
        const bassFreq = bassNotes[step];
        const leadFreq = leadNotes[step];

        if (bassFreq > 0) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(bassFreq, this.nextNoteTime);
          gain.gain.setValueAtTime(0.045, this.nextNoteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.nextNoteTime + sixteenthDur * 0.9);
          osc.connect(gain).connect(this.ctx.destination);
          osc.start(this.nextNoteTime);
          osc.stop(this.nextNoteTime + sixteenthDur);
        }

        if (leadFreq > 0 && Math.floor(this.bgmStep / 16) % 2 === 1) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(leadFreq, this.nextNoteTime);
          gain.gain.setValueAtTime(0.022, this.nextNoteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.nextNoteTime + sixteenthDur * 0.85);
          osc.connect(gain).connect(this.ctx.destination);
          osc.start(this.nextNoteTime);
          osc.stop(this.nextNoteTime + sixteenthDur);
        }
      }

      this.nextNoteTime += sixteenthDur;
      this.bgmStep++;
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
