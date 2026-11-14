import { FIXED_DT } from '../types.ts';

export class GameLoop {
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private accumulator = 0;
  private hitstopTimer = 0;
  private slowMoTimer = 0;
  private slowMoScale = 1;
  private running = false;

  constructor(
    private readonly onFixedUpdate: (dt: number) => void,
    private readonly onRender: () => void,
    private readonly onRawTick?: (rawDt: number) => void,
    private readonly onFrameEnd?: () => void
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      let rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      // Prevent spiral of death on tab switch
      if (rawDt > 0.1) rawDt = 0.1;

      this.onRawTick?.(rawDt);

      // Hitstop freezes simulation briefly (40-60ms) while still rendering screen shake
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - rawDt);
        this.onRender();
        // Still close out the frame so buffered input edges are consumed exactly once.
        this.onFrameEnd?.();
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      let timeScale = 1;
      if (this.slowMoTimer > 0) {
        this.slowMoTimer = Math.max(0, this.slowMoTimer - rawDt);
        timeScale = this.slowMoScale;
        if (this.slowMoTimer <= 0) {
          this.slowMoScale = 1;
        }
      }

      this.accumulator += rawDt * timeScale;
      while (this.accumulator >= FIXED_DT) {
        this.onFixedUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }

      this.onRender();
      this.onFrameEnd?.();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  triggerHitstop(seconds: number): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, seconds);
  }

  triggerSlowMo(seconds: number, scale: number): void {
    this.slowMoTimer = seconds;
    this.slowMoScale = scale;
  }

  clearEffects(): void {
    this.hitstopTimer = 0;
    this.slowMoTimer = 0;
    this.slowMoScale = 1;
  }
}
