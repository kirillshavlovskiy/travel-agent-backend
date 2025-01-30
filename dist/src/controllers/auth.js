import { PrismaClient } from '@prisma/client';
// Create a function to generate a session token
function generateSessionToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
export const handleGoogleVerify = async (req, res) => {
    try {
        const { user, account } = req.body;
        if (!user || !account) {
            return res.status(400).json({ error: 'Missing user or account data' });
        }
        // Here you would typically:
        // 1. Verify the Google token
        // 2. Create or update user in your database
        // 3. Return the verified user data
        // For now, we'll just return the user data as-is
        return res.status(200).json({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            username: user.name,
            profileImage: user.image,
            verified: true
        });
    }
    catch (error) {
        console.error('Google verify error:', error);
        return res.status(500).json({ error: 'Failed to verify Google user' });
    }
};
export const handleGoogleCallback = async (req, res) => {
    try {
        const { code } = req.query;
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ error: 'Missing authorization code' });
        }
        // Exchange the code for tokens
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = process.env.NODE_ENV === 'production'
            ? 'https://ai-trip-advisor-web.vercel.app/api/auth/callback/google'
            : 'http://localhost:3003/api/auth/callback/google';
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                code: code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        if (!tokenResponse.ok) {
            throw new Error('Failed to exchange code for tokens');
        }
        const tokens = await tokenResponse.json();
        // Get user info using the access token
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
            },
        });
        if (!userInfoResponse.ok) {
            throw new Error('Failed to get user info');
        }
        const userInfo = await userInfoResponse.json();
        // Create a session for the user
        // Here you would typically:
        // 1. Create or update user in your database
        // 2. Create a session
        // 3. Set session cookies
        // For now, we'll just redirect back to the frontend with the user info
        const frontendUrl = process.env.NODE_ENV === 'production'
            ? 'https://ai-trip-advisor-web.vercel.app'
            : 'http://localhost:3003';
        // Add user info to the session
        if (req.session) {
            req.session.user = {
                id: userInfo.id,
                name: userInfo.name,
                email: userInfo.email,
                image: userInfo.picture,
                username: userInfo.name,
                profileImage: userInfo.picture,
            };
        }
        return res.redirect(`${frontendUrl}?auth=success`);
    }
    catch (error) {
        console.error('Google callback error:', error);
        const frontendUrl = process.env.NODE_ENV === 'production'
            ? 'https://ai-trip-advisor-web.vercel.app'
            : 'http://localhost:3003';
        return res.redirect(`${frontendUrl}?auth_error=Failed to authenticate with Google`);
    }
};
export const handleRedditCallback = async (req, res) => {
    const prisma = new PrismaClient();
    try {
        const { code, redirectUri } = req.body;
        console.log('[Reddit Callback] Processing code:', code);
        if (!code) {
            return res.status(400).json({ error: 'Missing authorization code' });
        }
        // Exchange code for tokens
        const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')}`,
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri || 'http://localhost:3003/api/auth/callback/reddit',
            }),
        });
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[Reddit Callback] Token error:', errorText);
            return res.status(401).json({ error: 'Failed to exchange code for token' });
        }
        const tokens = await tokenResponse.json();
        console.log('[Reddit Callback] Got tokens:', { accessToken: tokens.access_token ? 'present' : 'missing' });
        // Get user info
        const userResponse = await fetch('https://oauth.reddit.com/api/v1/me', {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'User-Agent': 'web:ai-trip-advisor:v1.0.0',
            },
        });
        if (!userResponse.ok) {
            const errorText = await userResponse.text();
            console.error('[Reddit Callback] User info error:', errorText);
            return res.status(401).json({ error: 'Failed to get user info' });
        }
        const userData = await userResponse.json();
        console.log('[Reddit Callback] Got user data:', { id: userData.id, name: userData.name });
        // Database transaction
        console.log('[Reddit Callback] Starting database transaction');
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.upsert({
                where: { redditId: userData.id },
                update: {
                    username: userData.name,
                    profileImage: userData.icon_img || null,
                    lastLogin: new Date(),
                },
                create: {
                    redditId: userData.id,
                    username: userData.name,
                    profileImage: userData.icon_img || null,
                    lastLogin: new Date(),
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
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
                    token_type: tokens.token_type,
                    scope: tokens.scope
                },
                create: {
                    userId: user.id,
                    type: "oauth",
                    provider: "reddit",
                    providerAccountId: userData.id,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
                    token_type: tokens.token_type,
                    scope: tokens.scope
                }
            });
            const session = await tx.session.create({
                data: {
                    userId: user.id,
                    sessionToken: generateSessionToken(),
                    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
                }
            });
            return { user, account, session };
        });
        await prisma.$disconnect();
        console.log('[Reddit Callback] Database transaction completed', {
            userId: result.user.id,
            sessionId: result.session.id,
            sessionToken: result.session.sessionToken
        });
        // Set session cookie
        res.cookie('session_token', result.session.sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            expires: result.session.expires
        });
        // Return success with user data
        return res.status(200).json({
            success: true,
            user: {
                id: result.user.id,
                username: result.user.username,
                profileImage: result.user.profileImage
            }
        });
    }
    catch (error) {
        await prisma.$disconnect();
        console.error('[Reddit Callback] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
