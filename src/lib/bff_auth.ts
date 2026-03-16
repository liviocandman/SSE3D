import jwt from 'jsonwebtoken';
import { auth } from '@/auth';

const BFF_JWT_SECRET = process.env.BFF_JWT_SECRET || process.env.NEXTAUTH_SECRET;

export async function signBffToken() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  // Find the provider and providerAccountId from the session
  // NextAuth v5 (Auth.js) session user usually doesn't have these by default
  // But we can pass them in the JWT/Session callbacks if needed.
  // For now, we'll assume the session.user has these fields if we configured them.
  // If not, we'll use the user.id as providerAccountId and 'next-auth' as provider as fallback.

  const payload = {
    email: session.user.email,
    name: session.user.name,
    // These need to be available in the session for Identity Linking to work properly
    provider: (session.user as any).provider || 'unknown',
    provider_account_id: (session.user as any).providerAccountId || session.user.id,
  };

  return jwt.sign(payload, BFF_JWT_SECRET!, {
    expiresIn: '5m',
    algorithm: 'HS256',
  });
}
