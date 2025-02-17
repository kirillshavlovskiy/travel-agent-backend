import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Allow internal requests
  const authHeader = req.headers.authorization;
  if (authHeader === 'Bearer internal') {
    return next();
  }

  // Check for session token
  const sessionToken = req.cookies.session_token;
  if (!sessionToken) {
    return res.status(401).json({
      authenticated: false,
      error: 'No session token found'
    });
  }

  try {
    const prisma = new PrismaClient();
    const session = await prisma.session.findUnique({
      where: {
        sessionToken,
      },
      include: {
        user: true,
      },
    });

    await prisma.$disconnect();

    if (!session || session.expires < new Date()) {
      return res.status(401).json({
        authenticated: false,
        error: 'Session expired'
      });
    }

    // Add user to request
    (req as any).user = session.user;
    next();
  } catch (error) {
    console.error('[Auth] Error checking session:', error);
    return res.status(500).json({
      authenticated: false,
      error: 'Internal server error'
    });
  }
}; 