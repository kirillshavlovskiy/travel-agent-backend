import express from 'express';
import { prisma } from '../lib/prisma.js';
const router = express.Router();
// Base auth route
router.get('/', async (req, res) => {
    try {
        // Add your base auth logic here
        res.json({ status: 'success' });
    }
    catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Session validation route
router.get('/session', async (req, res) => {
    try {
        const sessionToken = req.cookies.session_token;
        if (!sessionToken) {
            return res.status(401).json({
                authenticated: false,
                user: null,
                message: 'No session token found'
            });
        }
        const session = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
        });
        if (!session || session.expires < new Date()) {
            return res.status(401).json({
                authenticated: false,
                user: null,
                message: 'Invalid or expired session'
            });
        }
        res.json({
            authenticated: true,
            user: {
                id: session.user.id,
                username: session.user.username,
                profileImage: session.user.profileImage
            }
        });
    }
    catch (error) {
        console.error('Session validation error:', error);
        res.status(500).json({
            authenticated: false,
            user: null,
            error: 'Internal server error'
        });
    }
});
// Reddit callback route
router.post('/reddit/callback', async (req, res) => {
    try {
        const { code, redirectUri } = req.body;
        if (!code || !redirectUri) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters'
            });
        }
        // Exchange code for Reddit access token
        const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri
            })
        });
        if (!tokenResponse.ok) {
            console.error('Reddit token error:', await tokenResponse.text());
            return res.status(401).json({
                success: false,
                error: 'Failed to obtain access token'
            });
        }
        const tokenData = await tokenResponse.json();
        // Get user info from Reddit
        const userResponse = await fetch('https://oauth.reddit.com/api/v1/me', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'User-Agent': 'AI Trip Advisor/1.0.0'
            }
        });
        if (!userResponse.ok) {
            console.error('Reddit user info error:', await userResponse.text());
            return res.status(401).json({
                success: false,
                error: 'Failed to get user info'
            });
        }
        const userData = await userResponse.json();
        // Create or update user
        const user = await prisma.user.upsert({
            where: { redditId: userData.id },
            update: {
                username: userData.name,
                profileImage: userData.icon_img,
                lastLogin: new Date()
            },
            create: {
                redditId: userData.id,
                username: userData.name,
                profileImage: userData.icon_img,
                lastLogin: new Date()
            }
        });
        // Create or update Reddit account
        await prisma.account.upsert({
            where: {
                provider_providerAccountId: {
                    provider: 'reddit',
                    providerAccountId: userData.id
                }
            },
            update: {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: Math.floor(Date.now() / 1000 + tokenData.expires_in),
                token_type: tokenData.token_type,
                scope: tokenData.scope
            },
            create: {
                userId: user.id,
                type: 'oauth',
                provider: 'reddit',
                providerAccountId: userData.id,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: Math.floor(Date.now() / 1000 + tokenData.expires_in),
                token_type: tokenData.token_type,
                scope: tokenData.scope
            }
        });
        // Create session
        const session = await prisma.session.create({
            data: {
                userId: user.id,
                sessionToken: Math.random().toString(36).substring(2) + Date.now().toString(36),
                expires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            }
        });
        // Set session cookie
        res.cookie('session_token', session.sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                profileImage: user.profileImage
            }
        });
    }
    catch (error) {
        console.error('Reddit auth callback error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});
export default router;
//# sourceMappingURL=auth.js.map