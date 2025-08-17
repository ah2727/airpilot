import { Controller, Get, Query, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { PilotService } from './pilot.service';
import { GetPathDto } from './dto/get-path.dto';

@Controller('pilot')
@UseInterceptors(CacheInterceptor) // enable response caching
export class PilotController {
  constructor(private readonly pilot: PilotService) {}

  @Get('path')
  @CacheTTL(30) // seconds
  async path(
    @Query(new ValidationPipe({ transform: true, whitelist: true })) q: GetPathDto,
  ) {
    const path = await this.pilot.getPath({
      flightNumber: q.flightNumber.trim(),
      date: q.date,
    });
    return { path };
  }
}
