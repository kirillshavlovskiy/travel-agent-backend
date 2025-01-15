import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { config } from 'dotenv';
import authRoutes from './src/routes/auth.js';
import { publicRouter as budgetPublicRoutes, authenticatedRouter as budgetAuthRoutes } from './src/routes/budget.js';
import flightRoutes from './src/routes/flights.js';
import hotelRoutes from './src/routes/hotels.js';
import perplexityRoutes from './src/routes/perplexity.js';
import activitiesRoutes from './src/routes/activities.js';

// Load environment variables
config();

const app = express();

// Configure CORS with environment-aware origins
const FRONTEND_URLS = [
  'https://ai-trip-advisor-web.vercel.app',
  'https://ai-trip-advisor-server.vercel.app',
  'http://localhost:3003',
  'http://localhost:3002',
  'http://localhost:3000'
].filter(Boolean);

// Configure CORS middleware with better error handling
app.use(cors({
  origin: function(origin, callback) {
    console.log('[CORS] Request from origin:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('[CORS] Allowing request with no origin');
      return callback(null, true);
    }
    
    // Check if the origin matches exactly or is a Vercel preview URL
    const isAllowed = FRONTEND_URLS.includes(origin) || 
                     origin.includes('vercel.app') || 
                     origin.includes('localhost');
    console.log('[CORS] Origin check:', { origin, isAllowed });
    
    if (isAllowed) {
      console.log('[CORS] Allowing request from:', origin);
      callback(null, true);
    } else {
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

app.set('trust proxy', 1); // Trust first proxy for secure cookies

// Configure middleware for all routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET));

// Public routes (no authentication required)
app.get('/health', (_req: Request, res: Response) => {
  try {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      message: 'Server is running'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Failed to check server health'
    });
  }
});

// Mount public budget routes before auth
console.log('Mounting public budget routes...');
app.use('/api/public/budget', budgetPublicRoutes);
console.log('Public budget routes mounted');

// Configure session middleware for authenticated routes
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    domain: process.env.NODE_ENV === 'production' ? '.vercel.app' : undefined
  }
});

// Apply session middleware only to authenticated routes
const authenticatedRouter = express.Router();
authenticatedRouter.use(sessionMiddleware);

// Mount authenticated routes
console.log('Mounting authenticated routes...');
app.use('/api/auth', authRoutes);
app.use('/api/budget', budgetAuthRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/perplexity', perplexityRoutes);
app.use('/api/activities', activitiesRoutes);
console.log('Authenticated routes mounted');

// Mount the authenticated router
app.use(authenticatedRouter);

// Root endpoint (public)
app.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'AI Trip Advisor API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
app.use((_req: Request, res: Response) => {
  console.log('404 for path:', _req.path);
  res.status(404).json({
    error: 'Not Found',
    message: `The requested endpoint does not exist: ${_req.path}`,
    timestamp: new Date().toISOString()
  });
});

// Export the Express app for serverless deployment
export default app;

// Start the server if not in production (Vercel handles production)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
} 