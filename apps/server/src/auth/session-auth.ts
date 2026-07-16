import type { AccessScope, SessionTokenClaims } from '@formation-chat-core/protocol';
import type { FastifyRequest } from 'fastify';

import { SessionTokenService } from '../session/token.js';

export class AuthorizationError extends Error {
  constructor(readonly statusCode: 401 | 403) {
    super(
      statusCode === 401 ? 'Authentication is required.' : 'The token lacks the required scope.',
    );
  }
}

export async function authenticate(
  request: FastifyRequest,
  tokens: SessionTokenService,
  scope: AccessScope,
): Promise<SessionTokenClaims> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new AuthorizationError(401);
  try {
    const claims = await tokens.verify(authorization.slice(7));
    if (!claims.scopes.includes(scope)) throw new AuthorizationError(403);
    return claims;
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw new AuthorizationError(401);
  }
}
