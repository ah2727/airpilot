import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetPathDto {
  @IsString()
  @IsNotEmpty()
  flightNumber!: string;

  @Type(() => Number)
  @IsInt()
  @Min(19000101) // yyyymmdd
  date!: number;
}
