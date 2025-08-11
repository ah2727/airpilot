import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FdrRecord } from './fdr-record.entity';

export type FlightKey = { flightNumber: string; date: number };

@Injectable()
export class PilotRepository {
  constructor(
    @InjectRepository(FdrRecord) private repo: Repository<FdrRecord>,
  ) {}

  private toTs(date: number, utc: string) {
    // date: yyyymmdd, utc: "hh:mm:ss"
    const yyyy = Math.floor(date / 10000);
    const mm = Math.floor((date % 10000) / 100);
    const dd = date % 100;
    const [h, m, s] = utc.split(':').map(Number);
    return Date.UTC(yyyy, mm - 1, dd, h, m, s);
  }

  async loadFlight({ flightNumber, date }: FlightKey) {
    const rows = await this.repo.find({
      where: { flightNumber, date },
      order: { utcTime: 'ASC', fdrTime: 'ASC' },
    });

    return rows.map((r) => ({
      id: r.id,
      ts: this.toTs(r.date, r.utcTime),     // epoch ms
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
