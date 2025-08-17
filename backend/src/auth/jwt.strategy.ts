// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
      ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: number; email: string; role: string }) {
    // whatever you return here becomes request.user
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
