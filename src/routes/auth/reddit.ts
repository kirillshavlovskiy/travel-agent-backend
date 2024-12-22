import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import { Response } from 'node-fetch';

const router = Router();
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Set up Prisma logging with proper types
prisma.$on('query', (e: any) => {
  console.log('[Prisma Query]', {
    query: e.query,
    params: e.params,
    duration: `${e.duration}ms`
  });
});

prisma.$on('info', (e: any) => {
  console.log('[Prisma Info]', e.message);
});

prisma.$on('error', (e: any) => {
  console.error('[Prisma Error]', e.message);
});

interface RedditTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface RedditUserData {
  id: string;
  name: string;
  created: number;
  verified: boolean;
  icon_img?: string;
}

router.post('/reddit/callback', async (req, res) => {
  console.log('[Reddit Callback] Starting callback processing', {
    timestamp: new Date().toISOString(),
    body: req.body,
    headers: req.headers
  });

  try {
    const { code, redirectUri } = req.body;

    if (!code) {
      console.error('[Reddit Callback] No authorization code provided');
      return res.status(400).json({ error: 'No authorization code provided' });
    }

    console.log('[Reddit Callback] Exchanging code for access token', {
      redirectUri,
      clientId: process.env.REDDIT_CLIENT_ID ? 'present' : 'missing',
      clientSecret: process.env.REDDIT_CLIENT_SECRET ? 'present' : 'missing'
    });

    // Exchange code for access token
    const tokenUrl = 'https://www.reddit.com/api/v1/access_token';
    const authHeader = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');

    console.log('[Reddit Callback] Making token request to:', tokenUrl);

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`,
        'User-Agent': 'Travel Budget Calculator/1.0.0'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Reddit Callback] Token exchange failed', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText
      });
      return res.status(tokenResponse.status).json({
        error: 'Token exchange failed',
        details: errorText
      });
    }

    const tokenData = await tokenResponse.json() as RedditTokenResponse;
    console.log('[Reddit Callback] Token exchange successful', {
      tokenType: tokenData.token_type,
      scope: tokenData.scope,
      expiresIn: tokenData.expires_in
    });

    // Get user info from Reddit
    console.log('[Reddit Callback] Fetching user info');
    const userResponse = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Travel Budget Calculator/1.0.0'
      }
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('[Reddit Callback] User info fetch failed', {
        status: userResponse.status,
        statusText: userResponse.statusText,
        error: errorText
      });
      return res.status(userResponse.status).json({
        error: 'Failed to fetch user info',
        details: errorText
      });
    }

    const userData = await userResponse.json() as RedditUserData;
    console.log('[Reddit Callback] User info received', {
      username: userData.name,
      verified: userData.verified,
      created: new Date(userData.created * 1000)
    });

    // Database transaction
    console.log('[Reddit Callback] Starting database transaction');
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { redditId: userData.id },
        update: {
          username: userData.name,
          profileImage: userData.icon_img || null,
          lastLogin: new Date(),
          verified: userData.verified
        },
        create: {
          redditId: userData.id,
          username: userData.name,
          profileImage: userData.icon_img || null,
          lastLogin: new Date(),
          verified: userData.verified,
          redditCreated: new Date(userData.created * 1000),
          createdAt: new Date()
        }
      });

      const account = await tx.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: "reddit",
            providerAccountId: userData.id
          }
        },
        update: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + tokenData.expires_in,
          token_type: tokenData.token_type,
          scope: tokenData.scope
        },
        create: {
          userId: user.id,
          type: "oauth",
          provider: "reddit",
          providerAccountId: userData.id,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + tokenData.expires_in,
          token_type: tokenData.token_type,
          scope: tokenData.scope
        }
      });

      const session = await tx.session.create({
        data: {
          userId: user.id,
          sessionToken: tokenData.access_token,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      return { user, account, session };
    });

    console.log('[Reddit Callback] Database transaction completed', {
      userId: result.user.id,
      sessionId: result.session.id
    });

    return res.json({
      sessionToken: result.session.sessionToken,
      expires: result.session.expires.toISOString(),
      user: {
        id: result.user.id,
        username: result.user.username,
        profileImage: result.user.profileImage,
        verified: result.user.verified
      }
    });

  } catch (error) {
    console.error('[Reddit Callback] Error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as default }; 