import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PilotService } from './pilot.service';
import { FlightKey } from './pilot.repository';

@WebSocketGateway({ namespace: '/pilot', cors: { origin: '*' } })
export class PilotGateway {
  @WebSocketServer() server: Server;
  constructor(private readonly pilot: PilotService) {}

@SubscribeMessage('join')
async join(@ConnectedSocket() client: Socket, @MessageBody() key: FlightKey) {
  const room = `${key.flightNumber}:${key.date}`;
  await client.join(room);

  // send static path once
  const path = await this.pilot.getPath(key);
  client.emit('telemetry:path', { path, total: path.length });

  // send current snapshot
  client.emit('telemetry:snapshot', await this.pilot.snapshot(key));
  return { ok: true };
}

  @SubscribeMessage('player:resume')
  async resume(@MessageBody() key: FlightKey) {
    const room = `${key.flightNumber}:${key.date}`;
    await this.pilot.resume(key, (t) => this.server.to(room).emit('telemetry:tick', t));
    this.server.to(room).emit('telemetry:snapshot', await this.pilot.snapshot(key));
    return { ok: true };
  }

  @SubscribeMessage('player:pause')
  async pause(@MessageBody() key: FlightKey) {
    await this.pilot.pause(key);
    this.server.to(`${key.flightNumber}:${key.date}`).emit('telemetry:snapshot', await this.pilot.snapshot(key));
    return { ok: true };
  }

  @SubscribeMessage('player:seekSeconds')
  async seekSeconds(@MessageBody() data: FlightKey & { seconds: number }) {
    const snap = await this.pilot.seekSeconds(data, data.seconds);
    this.server.to(`${data.flightNumber}:${data.date}`).emit('telemetry:snapshot', snap);
    return { ok: true };
  }

  @SubscribeMessage('player:seekPoints')
  async seekPoints(@MessageBody() data: FlightKey & { points: number }) {
    const snap = await this.pilot.seekPoints(data, data.points);
    this.server.to(`${data.flightNumber}:${data.date}`).emit('telemetry:snapshot', snap);
    return { ok: true };
  }

  @SubscribeMessage('player:setRate')
  async setRate(@MessageBody() data: FlightKey & { rate: number }) {
    const res = await this.pilot.setRate(data, data.rate);
    this.server.to(`${data.flightNumber}:${data.date}`).emit('player:rate', res);
    return { ok: true };
  }
}
