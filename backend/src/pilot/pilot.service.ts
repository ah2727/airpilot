import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { FdrRecord } from './fdr-record.entity';

// Frontend/stream types
export type FlightKey = { flightNumber: string; date: number };
export type FdrTick = {
  id: number;
  ts: number; // epoch ms (UTC)
  utcTime: string;
  date: number;
  flightNumber: string;
  latitude: number | null;
  longitude: number | null;
  pressureAltitude: number | null;
  pitchAngle: number | null;
  rollAngle: number | null;
  magHeading: number | null;
  computedAirspeed: number | null;
  verticalSpeed: number | null;
  flapPosition: number | null;
  gearSelectionUp: number | null;
  ap1Engaged: number | null;
  ap2Engaged: number | null;
  airGround: number | null;
};

type GetPathParams = { flightNumber: string; date: number };
type SessionKey = string;
const keyOf = (k: FlightKey): SessionKey => `${k.flightNumber}:${k.date}`;

type Session = {
  key: SessionKey;
  data: FdrTick[];
  idx: number;
  playing: boolean;
  rate: number;
  timer?: NodeJS.Timeout;
  lastOnTick?: (t: FdrTick) => void;
};

@Injectable()
export class PilotService {
  private log = new Logger(PilotService.name);
  private sessions = new Map<SessionKey, Session>();

  constructor(
    @InjectRepository(FdrRecord)
    private readonly repo: Repository<FdrRecord>,
  ) {}

  // ---------- helpers ----------
  private toNum = (v: any) => (v == null ? null : Number(v));

  private computeTs(date: number, utcTime: string): number {
    // date: yyyymmdd, utcTime: HH:MM:SS
    const y = Math.floor(date / 10000);
    const m = Math.floor((date % 10000) / 100);
    const d = date % 100;
    const [hh, mm, ss] = (utcTime || '00:00:00')
      .split(':')
      .map((n) => parseInt(n, 10) || 0);
    return Date.UTC(y, m - 1, d, hh, mm, ss);
  }

  private mapRecord(r: FdrRecord): FdrTick {
    return {
      id: r.id,
      ts: this.computeTs(r.date, r.utcTime),
      utcTime: r.utcTime,
      date: r.date,
      flightNumber: r.flightNumber,
      latitude: this.toNum(r.latitude),
      longitude: this.toNum(r.longitude),
      pressureAltitude: this.toNum(r.pressureAltitude),
      pitchAngle: this.toNum(r.pitchAngle),
      rollAngle: this.toNum(r.rollAngle),
      magHeading: this.toNum(r.magHeading),
      computedAirspeed: this.toNum(r.computedAirspeed),
      verticalSpeed: this.toNum(r.verticalSpeed),
      flapPosition: this.toNum(r.flapPosition),
      gearSelectionUp: this.toNum(r.gearSelectionUp),
      ap1Engaged: this.toNum(r.ap1Engaged),
      ap2Engaged: this.toNum(r.ap2Engaged),
      airGround: this.toNum(r.airGround),
    };
  }

  private async loadFlight(k: FlightKey): Promise<FdrTick[]> {
    const fn = (k.flightNumber ?? '').trim();
    // Fast path: exact match
    let rows = await this.repo.find({
      where: { flightNumber: fn, date: k.date },
      order: { id: 'ASC' },
      select: [
        'id',
        'utcTime',
        'date',
        'flightNumber',
        'latitude',
        'longitude',
        'pressureAltitude',
        'pitchAngle',
        'rollAngle',
        'magHeading',
        'computedAirspeed',
        'verticalSpeed',
        'flapPosition',
        'gearSelectionUp',
        'ap1Engaged',
        'ap2Engaged',
        'airGround',
        // NOTE: FdrRecord table does not have 'ts'; we compute it from date+utcTime.
      ] as (keyof FdrRecord)[],
    });

    // Fallback: case/space-insensitive
    if (!rows.length) {
      rows = await this.repo
        .createQueryBuilder('r')
        .where('r.date = :date', { date: k.date })
        .andWhere(
          new Brackets((qb) => {
            qb.where(
              'LOWER(REPLACE(r.flightNumber, \' \', \'\')) = LOWER(REPLACE(:fn, \' \', \'\'))',
              { fn },
            );
          }),
        )
        .orderBy('r.id', 'ASC')
        .getMany();
    }

    const out = rows.map((r) => this.mapRecord(r));
    this.log.debug(`loadFlight(${fn}, ${k.date}) -> ${out.length} rows`);
    return out;
  }

  // ---------- playback/session ----------
  private async ensureSession(k: FlightKey): Promise<Session> {
    const key = keyOf(k);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const data = await this.loadFlight(k);
    const s: Session = { key, data, idx: 0, playing: false, rate: 1 };
    this.sessions.set(key, s);
    return s;
  }

  private scheduleNext(s: Session, onTick: (t: FdrTick) => void) {
    if (!s.playing) return;
    const cur = s.data[s.idx];
    const next = s.data[s.idx + 1];

    const delay = next ? Math.max(10, Math.floor((next.ts - cur.ts) / s.rate)) : 0;

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

  async resume(k: FlightKey, onTick: (t: FdrTick) => void) {
    const s = await this.ensureSession(k);
    s.lastOnTick = onTick;
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
    if (s.playing) {
      await this.pause(k);
      if (s.lastOnTick) await this.resume(k, s.lastOnTick);
    }
    return { rate: s.rate };
  }

  async seekSeconds(k: FlightKey, seconds: number) {
    const s = await this.ensureSession(k);
    if (!s.data.length) return this.snapshot(k);

    const target = (s.data[s.idx]?.ts ?? s.data[0].ts) + seconds * 1000;

    // binary search by ts
    let lo = 0,
      hi = s.data.length - 1,
      ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.data[mid].ts <= target) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    s.idx = ans;
    return this.snapshot(k);
  }

  async seekPoints(k: FlightKey, delta: number) {
    const s = await this.ensureSession(k);
    s.idx = Math.max(0, Math.min(s.data.length - 1, s.idx + delta));
    return this.snapshot(k);
  }

  // ---------- HTTP API ----------
  async getPath({ flightNumber, date }: GetPathParams) {
    const fn = (flightNumber ?? '').trim();

    // exact
    let rows = await this.repo.find({
      where: { flightNumber: fn, date },
      order: { id: 'ASC' },
      select: [
        'id',
        'utcTime',
        'date',
        'flightNumber',
        'latitude',
        'longitude',
        'pressureAltitude',
        'pitchAngle',
        'rollAngle',
        'magHeading',
        'computedAirspeed',
        'verticalSpeed',
        'flapPosition',
        'gearSelectionUp',
        'ap1Engaged',
        'ap2Engaged',
        'airGround',
      ] as (keyof FdrRecord)[],
    });

    // fallback: case/space-insensitive
    if (!rows.length) {
      rows = await this.repo
        .createQueryBuilder('r')
        .where('r.date = :date', { date })
        .andWhere(
          new Brackets((qb) => {
            qb.where(
              'LOWER(REPLACE(r.flightNumber, \' \', \'\')) = LOWER(REPLACE(:fn, \' \', \'\'))',
              { fn },
            );
          }),
        )
        .orderBy('r.id', 'ASC')
        .getMany();
    }

    const out = rows.map((r) => this.mapRecord(r));
    this.log.debug(`getPath(${fn}, ${date}) -> ${out.length} rows`);
    return out;
  }
}
