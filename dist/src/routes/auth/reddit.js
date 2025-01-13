import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
const router = Router();
// Create a function to get a Prisma instance with logging
function getPrismaWithLogging() {
    const prisma = new PrismaClient({
        log: [
            {
                emit: 'event',
                level: 'query',
            },
            {
                emit: 'stdout',
                level: 'error',
            },
            {
                emit: 'stdout',
                level: 'info',
            },
            {
                emit: 'stdout',
                level: 'warn',
            },
        ],
    });
    // Only set up event handlers if they haven't been set up already
    if (process.env.NODE_ENV !== 'production') {
        prisma.$on('query', (e) => {
            console.log('[Prisma Query]', {
                timestamp: new Date().toISOString(),
                query: e.query,
                params: e.params,
                duration: `${e.duration}ms`
            });
        });
    }
    return prisma;
}
// Create a function to generate a session token
function generateSessionToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
// Create a new Prisma instance for each request
router.post('/reddit/callback', async (req, res) => {
    const prisma = getPrismaWithLogging();
    console.log('[Reddit Callback] Starting callback processing', {
        timestamp: new Date().toISOString(),
        body: req.body,
        headers: {
            origin: req.headers.origin,
            referer: req.headers.referer,
            'user-agent': req.headers['user-agent']
        },
        environment: process.env.NODE_ENV
    });
    try {
        const { code, redirectUri } = req.body;
        if (!code) {
            console.error('[Reddit Callback] No authorization code provided');
            return res.status(400).json({ error: 'No authorization code provided' });
        }
        if (!redirectUri) {
            console.error('[Reddit Callback] No redirect URI provided');
            return res.status(400).json({ error: 'No redirect URI provided' });
        }
        // Validate redirect URI against allowed origins
        const ALLOWED_REDIRECT_URIS = {
            production: [
                'https://ai-trip-advisor-web.vercel.app/api/auth/callback/reddit'
            ],
            development: [
                'http://localhost:3003/api/auth/callback/reddit',
                'http://localhost:3002/api/auth/callback/reddit',
                'http://localhost:3000/api/auth/callback/reddit'
            ]
        };
        // Get environment-specific URIs
        const validRedirectUris = [
            ...ALLOWED_REDIRECT_URIS.production,
            ...(process.env.NODE_ENV !== 'production' ? ALLOWED_REDIRECT_URIS.development : [])
        ];
        console.log('[Reddit Callback] Validating redirect URI:', {
            provided: redirectUri,
            environment: process.env.NODE_ENV,
            validUris: validRedirectUris
        });
        const isValidRedirectUri = validRedirectUris.includes(redirectUri);
        if (!isValidRedirectUri) {
            console.error('[Reddit Callback] Invalid redirect URI:', {
                provided: redirectUri,
                allowedUris: validRedirectUris,
                environment: process.env.NODE_ENV
            });
            return res.status(400).json({
                error: 'Invalid redirect URI',
                message: 'The provided redirect URI is not in the list of allowed URIs for this environment'
            });
        }
        console.log('[Reddit Callback] Exchanging code for access token', {
            redirectUri,
            clientId: process.env.REDDIT_CLIENT_ID ? 'present' : 'missing',
            clientSecret: process.env.REDDIT_CLIENT_SECRET ? 'present' : 'missing',
            environment: process.env.NODE_ENV
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
        const tokenData = await tokenResponse.json();
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
        const userData = await userResponse.json();
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
                    sessionToken: generateSessionToken(),
                    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                }
            });
            return { user, account, session };
        });
        // Clean up Prisma connection
        await prisma.$disconnect();
        console.log('[Reddit Callback] Database transaction completed', {
            userId: result.user.id,
            sessionId: result.session.id
        });
        // Set session cookie
        res.cookie('session_token', result.session.sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            expires: result.session.expires
        });
        return res.json({
            success: true,
            user: {
                id: result.user.id,
                username: result.user.username,
                profileImage: result.user.profileImage,
                verified: result.user.verified
            }
        });
    }
    catch (error) {
        // Make sure to disconnect Prisma even if there's an error
        await prisma.$disconnect();
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
// Add session check endpoint
router.get('/session', async (req, res) => {
    const prisma = getPrismaWithLogging();
    const sessionToken = req.cookies.session_token;
    console.log('[Session] Checking session token:', {
        hasToken: !!sessionToken,
        cookies: req.cookies
    });
    try {
        if (!sessionToken) {
            console.log('[Session] No session token found');
            return res.json({ authenticated: false });
        }
        // Find session and associated user
        const session = await prisma.session.findUnique({
            where: {
                sessionToken,
            },
            include: {
                user: true,
            },
        });
        console.log('[Session] Session lookup result:', {
            found: !!session,
            expired: session ? session.expires < new Date() : null
        });
        if (!session || session.expires < new Date()) {
            return res.json({ authenticated: false });
        }
        return res.json({
            authenticated: true,
            user: {
                id: session.user.id,
                username: session.user.username,
                profileImage: session.user.profileImage,
                verified: session.user.verified
            }
        });
    }
    catch (error) {
        console.error('[Session] Check error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        await prisma.$disconnect();
    }
});
// Add user info endpoint
router.get('/user', async (req, res) => {
    const prisma = getPrismaWithLogging();
    const sessionToken = req.cookies.session_token;
    console.log('[User] Fetching user data', {
        hasToken: !!sessionToken,
        cookies: req.cookies
    });
    try {
        if (!sessionToken) {
            console.log('[User] No session token found');
            return res.status(401).json({ error: 'No session token' });
        }
        // First find the session
        const session = await prisma.session.findUnique({
            where: {
                sessionToken,
            }
        });
        console.log('[User] Session lookup result:', {
            found: !!session,
            expired: session ? session.expires < new Date() : null
        });
        if (!session || session.expires < new Date()) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        // Then find the user and their Reddit account
        const user = await prisma.user.findUnique({
            where: { id: session.userId },
            include: {
                accounts: {
                    where: {
                        provider: 'reddit'
                    }
                }
            }
        });
        if (!user || !user.accounts[0]) {
            return res.status(401).json({ error: 'No Reddit account found' });
        }
        const account = user.accounts[0];
        // Get fresh user data from Reddit
        const userResponse = await fetch('https://oauth.reddit.com/api/v1/me', {
            headers: {
                'Authorization': `Bearer ${account.access_token}`,
                'User-Agent': 'Travel Budget Calculator/1.0.0'
            }
        });
        if (!userResponse.ok) {
            console.error('[User] Reddit API error:', await userResponse.text());
            return res.status(500).json({ error: 'Failed to fetch Reddit user data' });
        }
        const userData = await userResponse.json();
        console.log('[User] Reddit data received:', {
            username: userData.name,
            verified: userData.verified
        });
        // Update user data
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                username: userData.name,
                profileImage: userData.icon_img || null,
                verified: userData.verified,
                lastLogin: new Date()
            }
        });
        return res.json({
            id: updatedUser.id,
            username: updatedUser.username,
            profileImage: updatedUser.profileImage,
            verified: updatedUser.verified
        });
    }
    catch (error) {
        console.error('[User] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        await prisma.$disconnect();
    }
});
export default router;
//# sourceMappingURL=reddit.js.map