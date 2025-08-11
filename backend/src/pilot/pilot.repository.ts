import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FdrRecord } from './fdr-record.entity';

export type FlightKey = { flightNumber: string; date: number };

export interface FdrTick {
  id: number;
  ts: number;
  utcTime: string;
  date: number;
  flightNumber: string;
  pressureAltitude: number | null | undefined;
  pitchAngle: number | null | undefined;
  rollAngle: number | null | undefined;
  magHeading: number | null | undefined;
  computedAirspeed: number | null | undefined;
  verticalSpeed: number | null | undefined;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  flapPosition: number | null | undefined;
  gearSelectionUp: number | null | undefined;
  ap1Engaged: number | null | undefined;
  ap2Engaged: number | null | undefined;
  airGround: number | null | undefined;
}

@Injectable()
export class PilotRepository {
  constructor(@InjectRepository(FdrRecord) private repo: Repository<FdrRecord>) {}

  private toTs(date: number, utc: string) {
    const yyyy = Math.floor(date / 10000);
    const mm = Math.floor((date % 10000) / 100);
    const dd = date % 100;
    const [h, m, s] = utc.split(':').map(Number);
    return Date.UTC(yyyy, mm - 1, dd, h, m, s);
  }

  async loadFlight({ flightNumber, date }: FlightKey): Promise<FdrTick[]> {
    const rows = await this.repo.find({
      where: { flightNumber, date },
      order: { utcTime: 'ASC', fdrTime: 'ASC' },
    });

    return rows.map((r) => ({
      id: r.id,
      ts: this.toTs(r.date, r.utcTime),
      utcTime: r.utcTime,
      date: r.date,
      flightNumber: r.flightNumber,
      pressureAltitude: r.pressureAltitude,
      pitchAngle: r.pitchAngle,
      rollAngle: r.rollAngle,
      magHeading: r.magHeading,
      computedAirspeed: r.computedAirspeed,
      verticalSpeed: r.verticalSpeed,
      latitude: r.latitude,
      longitude: r.longitude,
      flapPosition: r.flapPosition,
      gearSelectionUp: r.gearSelectionUp,
      ap1Engaged: r.ap1Engaged,
      ap2Engaged: r.ap2Engaged,
      airGround: r.airGround,
    }));
  }
}
