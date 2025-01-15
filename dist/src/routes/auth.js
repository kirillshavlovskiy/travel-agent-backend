import express from 'express';
import { PrismaClient } from '@prisma/client';
import { handleRedditCallback } from '../controllers/auth.js';
// Create a function to generate a session token
function generateSessionToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
const router = express.Router();
// Add providers endpoint
router.get('/providers', (_req, res) => {
    res.json({
        google: {
            id: 'google',
            name: 'Google',
            type: 'oauth',
            signinUrl: '/api/auth/signin/google',
            callbackUrl: '/api/auth/callback/google'
        },
        reddit: {
            id: 'reddit',
            name: 'Reddit',
            type: 'oauth',
            signinUrl: '/api/auth/signin/reddit',
            callbackUrl: '/api/auth/callback/reddit'
        }
    });
});
// Get current user
router.get('/user', async (req, res) => {
    // First check for custom session token
    const sessionToken = req.cookies.session_token;
    if (sessionToken) {
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
            if (session && session.expires > new Date()) {
                return res.json({
                    id: session.user.id,
                    username: session.user.username,
                    profileImage: session.user.profileImage,
                    verified: session.user.verified
                });
            }
        }
        catch (error) {
            console.error('[User] Error checking session token:', error);
        }
    }
    // Fallback to Express session
    if (req.session?.user) {
        return res.json(req.session.user);
    }
    return res.status(401).json({ error: 'Not authenticated' });
});
// Add logging endpoint
router.post('/_log', (req, res) => {
    console.log('[Auth Log]', req.body);
    res.status(200).json({ success: true });
});
// Session management
router.get('/session', async (req, res) => {
    const sessionToken = req.cookies.session_token;
    console.log('[Session] Checking session:', {
        hasToken: !!sessionToken,
        cookies: req.cookies
    });
    try {
        if (!sessionToken) {
            console.log('[Session] No session token found');
            return res.status(200).json({
                authenticated: false,
                user: null
            });
        }
        // Find session and associated user
        const prisma = new PrismaClient();
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
            expired: session ? session.expires < new Date() : null,
            userId: session?.user?.id
        });
        await prisma.$disconnect();
        if (!session || session.expires < new Date()) {
            console.log('[Session] Session invalid or expired');
            // Clear the invalid session token
            res.clearCookie('session_token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/'
            });
            return res.status(200).json({
                authenticated: false,
                user: null
            });
        }
        console.log('[Session] Valid session found, returning user data');
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
        console.error('[Session] Error checking session:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/session', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ error: 'Failed to destroy session' });
        }
        res.clearCookie('connect.sid');
        return res.status(200).json({ message: 'Session destroyed' });
    });
});
// Logout endpoint
router.post('/logout', async (req, res) => {
    try {
        // Clear Express session
        await new Promise((resolve, reject) => {
            req.session.destroy((err) => {
                if (err) {
                    console.error('Error destroying Express session:', err);
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
        // Clear session token from database if it exists
        const sessionToken = req.cookies.session_token;
        if (sessionToken) {
            const prisma = new PrismaClient();
            await prisma.session.delete({
                where: {
                    sessionToken
                }
            }).catch(err => {
                console.error('Error deleting session from database:', err);
            });
            await prisma.$disconnect();
        }
        // Clear all cookies
        res.clearCookie('connect.sid');
        res.clearCookie('session_token');
        return res.status(200).json({ message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Error during logout:', error);
        return res.status(500).json({ error: 'Failed to logout' });
    }
});
// Reddit auth endpoints
router.post('/reddit/callback', handleRedditCallback);
// Google auth endpoints
router.get('/google/authorize', (_req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NODE_ENV === 'production'
        ? 'https://ai-trip-advisor-web.vercel.app/api/auth/callback/google'
        : 'http://localhost:3003/api/auth/callback/google';
    const scope = encodeURIComponent('openid email profile');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${scope}` +
        `&access_type=offline` +
        `&prompt=consent`;
    res.json({ authUrl });
});
// Single callback endpoint for Google
router.post('/google/callback', async (req, res) => {
    try {
        const { code, redirectUri } = req.body;
        console.log('[Google Callback] Processing code:', { code, redirectUri });
        if (!code) {
            return res.status(400).json({ error: 'Missing authorization code' });
        }
        // Exchange code for tokens
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        if (!tokenResponse.ok) {
            const error = await tokenResponse.text();
            console.error('[Google Callback] Token error:', error);
            return res.status(401).json({ error: 'Failed to exchange code for token' });
        }
        const tokens = await tokenResponse.json();
        console.log('[Google Callback] Got tokens:', { accessToken: tokens.access_token ? 'present' : 'missing' });
        // Get user info
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
            },
        });
        if (!userInfoResponse.ok) {
            const error = await userInfoResponse.text();
            console.error('[Google Callback] User info error:', error);
            return res.status(401).json({ error: 'Failed to get user info' });
        }
        const userInfo = await userInfoResponse.json();
        console.log('[Google Callback] Got user info:', { id: userInfo.id, name: userInfo.name });
        // Database transaction
        const prisma = new PrismaClient();
        console.log('[Google Callback] Starting database transaction');
        const result = await prisma.$transaction(async (tx) => {
            // Find or create user
            const user = await tx.user.upsert({
                where: { email: userInfo.email },
                update: {
                    name: userInfo.name,
                    profileImage: userInfo.picture,
                    lastLogin: new Date(),
                },
                create: {
                    email: userInfo.email,
                    name: userInfo.name,
                    username: userInfo.name,
                    profileImage: userInfo.picture,
                    verified: userInfo.verified_email,
                },
            });
            // Create or update account
            const account = await tx.account.upsert({
                where: {
                    provider_providerAccountId: {
                        provider: 'google',
                        providerAccountId: userInfo.id,
                    },
                },
                update: {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
                    token_type: tokens.token_type,
                    scope: 'openid email profile',
                    id_token: tokens.id_token,
                },
                create: {
                    userId: user.id,
                    type: 'oauth',
                    provider: 'google',
                    providerAccountId: userInfo.id,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
                    token_type: tokens.token_type,
                    scope: 'openid email profile',
                    id_token: tokens.id_token,
                },
            });
            // Create new session
            const session = await tx.session.create({
                data: {
                    userId: user.id,
                    sessionToken: generateSessionToken(),
                    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                },
            });
            return { user, account, session };
        });
        await prisma.$disconnect();
        console.log('[Google Callback] Database transaction completed', {
            userId: result.user.id,
            sessionId: result.session.id,
            sessionToken: result.session.sessionToken,
        });
        // Set session cookie
        res.cookie('session_token', result.session.sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            expires: result.session.expires,
        });
        // Return success with user data
        return res.status(200).json({
            success: true,
            user: {
                id: result.user.id,
                username: result.user.username,
                email: result.user.email,
                profileImage: result.user.profileImage,
                verified: result.user.verified,
            },
        });
    }
    catch (error) {
        console.error('[Google Callback] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
//# sourceMappingURL=auth.js.map