import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'fallback-dev-secret',
    });
  }

  validate(payload: JwtPayload): { userId: string; email: string; role: string } | null {
    // Refresh tokens must not be accepted as access tokens
    if (payload.type === 'refresh') return null;
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
