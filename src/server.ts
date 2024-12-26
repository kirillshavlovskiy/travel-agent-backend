import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import redditAuthRoutes from './routes/auth/reddit.js';
import { VacationBudgetAgent } from './services/agents.js';
import budgetRoutes from './routes/budget.js';
import flightRoutes from './routes/flights.js';
import { amadeusService } from './services/amadeus.js';

// Load environment variables
config();

const app = express();

// Configure middleware - move this before CORS
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Configure CORS with environment-aware origins
const FRONTEND_URLS = [
  'https://ai-trip-advisor-web.vercel.app',
  'http://localhost:3003',
  'http://localhost:3002',
  'http://localhost:3000'
].filter(Boolean);

console.log('Allowed origins:', FRONTEND_URLS);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (FRONTEND_URLS.some(url => origin.startsWith(url))) {
      callback(null, true);
    } else {
      console.log(`Blocked request from unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, {
    origin: req.headers.origin,
    referer: req.headers.referer,
    userAgent: req.headers['user-agent']
  });
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', req.body);
  }
  next();
});

// Log available routes
console.log('Mounting routes...');

// Mount routes with logging
console.log('Mounting /api/auth route...');
app.use('/api/auth', redditAuthRoutes);
console.log('Auth route mounted');

console.log('Mounting /api/budget route...');
app.use('/api/budget', budgetRoutes);
console.log('Budget route mounted');

console.log('Mounting /api/flights route...');
app.use('/api/flights', flightRoutes);
console.log('Flight route mounted');

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'AI Trip Advisor API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    routes: {
      auth: !!redditAuthRoutes,
      budget: !!budgetRoutes,
      flights: !!flightRoutes
    }
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
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404
app.use((req: Request, res: Response) => {
  console.log(`404 Not Found: ${req.method} ${req.url}`, {
    origin: req.headers.origin,
    availableRoutes: {
      auth: !!redditAuthRoutes,
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

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
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
    auth: !!redditAuthRoutes,
    budget: !!budgetRoutes,
    flights: !!flightRoutes
  });
});

export default app; 