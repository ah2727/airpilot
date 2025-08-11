import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('fdr_records')
export class FdrRecord {
  @PrimaryGeneratedColumn() id: number;

  @Index() @Column({ name: 'flight_number', type: 'varchar', length: 32 })
  flightNumber: string; // e.g. "122"

  @Index() @Column({ name: 'date', type: 'int' })
  date: number; // yyyymmdd e.g. 20250324

  @Column({ name: 'utc_time', type: 'varchar', length: 8 })
  utcTime: string; // "hh:mm:ss"

  @Column({ name: 'fdr_time', type: 'int', nullable: true })
  fdrTime?: number;

  @Column({ name: 'pressure_altitude', type: 'int', nullable: true })
  pressureAltitude?: number;

  @Column({ name: 'pitch_angle', type: 'int', nullable: true })   pitchAngle?: number;
  @Column({ name: 'roll_angle',  type: 'int', nullable: true })   rollAngle?: number;
  @Column({ name: 'mag_heading', type: 'int', nullable: true })   magHeading?: number;
  @Column({ name: 'computed_airspeed', type: 'int', nullable: true }) computedAirspeed?: number;
  @Column({ name: 'vertical_speed', type: 'int', nullable: true }) verticalSpeed?: number;

  @Column({ name: 'latitude',  type: 'double', nullable: true })  latitude?: number;
  @Column({ name: 'longitude', type: 'double', nullable: true })  longitude?: number;

  @Column({ name: 'flap_position', type: 'int', nullable: true }) flapPosition?: number;
  @Column({ name: 'gear_selection_up', type: 'tinyint', nullable: true }) gearSelectionUp?: number;
  @Column({ name: 'ap1_engaged', type: 'tinyint', nullable: true }) ap1Engaged?: number;
  @Column({ name: 'ap2_engaged', type: 'tinyint', nullable: true }) ap2Engaged?: number;
  @Column({ name: 'air_ground', type: 'tinyint', nullable: true }) airGround?: number;
}
