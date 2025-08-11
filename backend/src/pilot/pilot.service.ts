import { Injectable, Logger } from '@nestjs/common';
import { PilotRepository, FlightKey } from './pilot.repository';

type Tick = ReturnType<PilotRepository['loadFlight']> extends (infer R)[] ? R : never;
type SessionKey = string;
const keyOf = (k: FlightKey): SessionKey => `${k.flightNumber}:${k.date}`;

type Session = {
  key: SessionKey;
  data: Tick[];
  idx: number;
  playing: boolean;
  rate: number;        // 1 = real-time, 2 = 2x, etc.
  timer?: NodeJS.Timeout;
};

@Injectable()
export class PilotService {
  private log = new Logger(PilotService.name);
  private sessions = new Map<SessionKey, Session>();

  constructor(private readonly repo: PilotRepository) {}

  private async ensureSession(k: FlightKey) {
    const key = keyOf(k);
    let s = this.sessions.get(key);
    if (!s) {
      const data = await this.repo.loadFlight(k);
      s = { key, data, idx: 0, playing: false, rate: 1 };
      this.sessions.set(key, s);
    }
    return s;
  }

  private scheduleNext(s: Session, onTick: (t: Tick) => void) {
    if (!s.playing) return;

    const cur = s.data[s.idx];
    const next = s.data[s.idx + 1];
    const delay = next
      ? Math.max(10, Math.floor((next.ts - cur.ts) / s.rate))
      : 0;

    s.timer = setTimeout(() => {
      if (!s.playing) return;
      onTick(s.data[s.idx]);
      s.idx++;
      if (s.idx >= s.data.length) {
        s.playing = false;
        return;
      }
      this.scheduleNext(s, onTick);
    }, delay);
  }

  async snapshot(k: FlightKey) {
    const s = await this.ensureSession(k);
    return {
      key: s.key,
      idx: s.idx,
      total: s.data.length,
      playing: s.playing,
      rate: s.rate,
      point: s.data[s.idx] ?? null,
    };
  }

  async resume(k: FlightKey, onTick: (t: Tick) => void) {
    const s = await this.ensureSession(k);
    if (s.playing || !s.data.length) return;
    s.playing = true;
    this.scheduleNext(s, onTick);
    this.log.log(`▶️ resume ${s.key}`);
  }

  async pause(k: FlightKey) {
    const s = await this.ensureSession(k);
    s.playing = false;
    if (s.timer) clearTimeout(s.timer);
    this.log.log(`⏸️ pause ${s.key}`);
  }

  async setRate(k: FlightKey, rate: number) {
    const s = await this.ensureSession(k);
    s.rate = Math.max(0.1, rate);
    // If playing, restart timing at new rate
    if (s.playing) {
      await this.pause(k);
      await this.resume(k, () => {});
    }
    return { rate: s.rate };
  }

  /** Seek by seconds relative to current point */
  async seekSeconds(k: FlightKey, seconds: number) {
    const s = await this.ensureSession(k);
    if (!s.data.length) return this.snapshot(k);
    const target = (s.data[s.idx]?.ts ?? s.data[0].ts) + seconds * 1000;

    // binary search by ts
    let lo = 0, hi = s.data.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.data[mid].ts <= target) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    s.idx = ans;
    return this.snapshot(k);
  }

  /** Seek by N records (negative = backward) */
  async seekPoints(k: FlightKey, delta: number) {
    const s = await this.ensureSession(k);
    s.idx = Math.max(0, Math.min(s.data.length - 1, s.idx + delta));
    return this.snapshot(k);
  }
}
