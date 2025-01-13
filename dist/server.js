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
// Configure CORS
const allowedOrigins = [
    'http://localhost:3003',
    'https://ai-trip-advisor-web.vercel.app',
    'https://chiptrip.app',
    process.env.FRONTEND_URL, // Fallback to env variable if set
].filter(Boolean); // Remove any undefined values
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
// Configure middleware for all routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Public routes (no authentication required)
app.get('/health', (_req, res) => {
    try {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            message: 'Server is running'
        });
    }
    catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            message: 'Failed to check server health'
        });
    }
});
app.get('/api/public/locations', async (_req, res) => {
    try {
        res.json({
            status: 'ok',
            locations: [
                { id: 1, name: 'New York', code: 'NYC' },
                { id: 2, name: 'London', code: 'LON' },
                { id: 3, name: 'Paris', code: 'PAR' }
            ]
        });
    }
    catch (error) {
        console.error('Locations error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch locations'
        });
    }
});
// Configure session middleware for authenticated routes
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
// Apply session middleware only to authenticated routes
const authenticatedRouter = express.Router();
authenticatedRouter.use(sessionMiddleware);
// Mount authenticated routes
authenticatedRouter.use('/api/auth', authRoutes);
authenticatedRouter.use('/api/budget', budgetRoutes);
authenticatedRouter.use('/api/flights', flightRoutes);
authenticatedRouter.use('/api/hotels', hotelRoutes);
authenticatedRouter.use('/api/perplexity', perplexityRoutes);
authenticatedRouter.use('/api/activities', activitiesRoutes);
// Mount the authenticated router
app.use(authenticatedRouter);
// Root endpoint (public)
app.get('/', (_req, res) => {
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
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'CORS policy violation',
            timestamp: new Date().toISOString()
        });
    }
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
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested endpoint does not exist',
        timestamp: new Date().toISOString()
    });
});
// Export the Express app for serverless deployment
export default app;
//# sourceMappingURL=server.js.map