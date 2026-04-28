import jwt from 'jsonwebtoken';
import { auth } from '@/auth';

const BFF_JWT_SECRET = process.env.BFF_JWT_SECRET;
type SessionUserWithProvider = {
  provider?: string;
  providerAccountId?: string;
};

export async function signBffToken() {
  if (!BFF_JWT_SECRET) {
    console.warn('[BFF Auth] BFF_JWT_SECRET not configured');
    return null;
  }

  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const user = session.user as typeof session.user & SessionUserWithProvider;
  
  // Reject signing for unresolved providers — prevents garbage identity linking
  const provider = user.provider;
  if (!provider || provider === 'unknown') {
    console.warn('[BFF Auth] Cannot sign token: provider is unknown');
    return null;
  }

  const payload = {
    email: user.email,
    name: user.name,
    provider,
    provider_account_id: user.providerAccountId || user.id,
    iss: 'sse3d-bff',
    aud: 'sse3d-api',
  };

  return jwt.sign(payload, BFF_JWT_SECRET, {
    expiresIn: '5m',
    algorithm: 'HS256',
  });
}
