import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { config } from 'dotenv';
import authRoutes from './routes/auth.js';
import budgetRoutes from './routes/budget.js';
import flightRoutes from './routes/flights.js';
import hotelRoutes from './routes/hotels.js';
import perplexityRoutes from './routes/perplexity.js';
import activitiesRoutes from './routes/activities.js';
// Load environment variables
config();
const app = express();
// Health check endpoint - before any middleware
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});
// Configure middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Configure session middleware
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});
app.use(sessionMiddleware);
// Request logging middleware - move this before CORS
app.use((req, res, next) => {
    const requestStart = Date.now();
    // Log request details
    console.log(`[REQUEST][${new Date().toISOString()}] ${req.method} ${req.url}`, {
        origin: req.headers.origin,
        referer: req.headers.referer,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        headers: req.headers,
        query: req.query,
        params: req.params
    });
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('[REQUEST-BODY]', JSON.stringify(req.body, null, 2));
    }
    // Capture response using event listeners
    res.on('finish', () => {
        const responseTime = Date.now() - requestStart;
        console.log(`[RESPONSE][${new Date().toISOString()}] ${req.method} ${req.url}`, {
            statusCode: res.statusCode,
            responseTime: `${responseTime}ms`,
            headers: res.getHeaders()
        });
    });
    res.on('error', (error) => {
        console.error(`[RESPONSE-ERROR][${new Date().toISOString()}] ${req.method} ${req.url}`, {
            error: error.message,
            stack: error.stack
        });
    });
    next();
});
// Configure CORS with environment-aware origins
const FRONTEND_URLS = [
    'https://ai-trip-advisor-web.vercel.app',
    'http://localhost:3003',
    'http://localhost:3002',
    'http://localhost:3000'
].filter(Boolean);
console.log('Allowed origins:', FRONTEND_URLS);
// Configure CORS middleware with better error handling
app.use(cors({
    origin: function (origin, callback) {
        console.log('[CORS] Request from origin:', origin);
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
            console.log('[CORS] Allowing request with no origin');
            return callback(null, true);
        }
        // Check if the origin matches exactly or is a Vercel preview URL
        const isAllowed = FRONTEND_URLS.includes(origin) || origin.includes('vercel.app');
        console.log('[CORS] Origin check:', { origin, isAllowed });
        if (isAllowed) {
            console.log('[CORS] Allowing request from:', origin);
            callback(null, true);
        }
        else {
            console.warn('[CORS] Blocked request from:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
}));
// Add timeout middleware with longer timeout for budget calculation
app.use((req, res, next) => {
    // Set a longer timeout (300 seconds) for budget calculation
    const timeoutDuration = req.path.includes('/api/budget/calculate-budget') ? 300000 : 30000;
    // Set both the request and response timeouts
    req.setTimeout(timeoutDuration);
    res.setTimeout(timeoutDuration);
    const timeoutHandler = () => {
        console.error(`[TIMEOUT] Request timed out after ${timeoutDuration}ms: ${req.method} ${req.url}`, {
            origin: req.headers.origin,
            path: req.path,
            query: req.query,
            body: req.body
        });
        if (!res.headersSent) {
            res.status(504).json({
                error: 'Gateway Timeout',
                message: 'Request took too long to process',
                timestamp: new Date().toISOString()
            });
        }
    };
    // Set timeout handlers for both request and response
    req.on('timeout', timeoutHandler);
    res.on('timeout', timeoutHandler);
    next();
});
// Log available routes
console.log('Mounting routes...');
// Mount routes with logging
console.log('Mounting /api/auth route...');
app.use('/api/auth', authRoutes);
console.log('Auth route mounted');
console.log('Mounting /api/budget route...');
app.use('/api/budget', budgetRoutes);
console.log('Budget route mounted');
console.log('Mounting /api/flights route...');
app.use('/api/flights', flightRoutes);
console.log('Flight route mounted');
console.log('Mounting /api/hotels route...');
app.use('/api/hotels', hotelRoutes);
console.log('Hotel route mounted');
console.log('Mounting /api/perplexity route...');
app.use('/api/perplexity', perplexityRoutes);
console.log('Perplexity route mounted');
console.log('Mounting /api/activities route...');
app.use('/api/activities', activitiesRoutes);
console.log('Activities route mounted');
// Root endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'AI Trip Advisor API',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        body: req.body,
        origin: req.headers.origin
    });
    // Handle CORS errors
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'CORS policy violation',
            timestamp: new Date().toISOString(),
            origin: req.headers.origin
        });
    }
    // Handle timeout errors
    if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
        return res.status(504).json({
            error: 'Gateway Timeout',
            message: 'Request took too long to process',
            timestamp: new Date().toISOString()
        });
    }
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
        timestamp: new Date().toISOString()
    });
});
// Handle 404
app.use((req, res) => {
    console.log(`404 Not Found: ${req.method} ${req.url}`, {
        origin: req.headers.origin,
        availableRoutes: {
            auth: !!authRoutes,
            budget: !!budgetRoutes,
            flights: !!flightRoutes
        }
    });
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested endpoint does not exist',
        timestamp: new Date().toISOString(),
        path: req.url
    });
});
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/api/health`);
    console.log('Environment:', {
        nodeEnv: process.env.NODE_ENV,
        perplexityApiKey: !!process.env.PERPLEXITY_API_KEY,
        redditClientId: !!process.env.REDDIT_CLIENT_ID,
        redditClientSecret: !!process.env.REDDIT_CLIENT_SECRET,
        amadeusClientId: !!process.env.AMADEUS_CLIENT_ID,
        amadeusClientSecret: !!process.env.AMADEUS_CLIENT_SECRET
    });
    console.log('Routes mounted:', {
        auth: !!authRoutes,
        budget: !!budgetRoutes,
        flights: !!flightRoutes
    });
});
export default app;
//# sourceMappingURL=server.js.map