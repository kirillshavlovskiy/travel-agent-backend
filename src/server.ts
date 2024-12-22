import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import redditAuthRoutes from './routes/auth/reddit.js';
import VacationBudgetAgent from './services/agents.js';

// Load environment variables
config();

const app = express();

// Configure CORS with environment-aware origins
const FRONTEND_URLS = [
  'https://ai-trip-advisor-web.vercel.app',  // Production frontend
  'http://localhost:3002',  // Development frontend
  'http://localhost:3000'   // Alternative development port
].filter(Boolean);

console.log('Allowed origins:', FRONTEND_URLS);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
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

app.use(express.json());
app.use(cookieParser());

// Auth routes
app.use('/api/auth', redditAuthRoutes);

const agent = new VacationBudgetAgent();

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'AI Trip Advisor API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    allowedOrigins: FRONTEND_URLS
  });
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'development',
    url: process.env.VERCEL_URL || 'localhost',
    region: process.env.VERCEL_REGION || 'local',
    perplexityApiKey: !!process.env.PERPLEXITY_API_KEY,
    redditClientId: !!process.env.REDDIT_CLIENT_ID,
    redditClientSecret: !!process.env.REDDIT_CLIENT_SECRET,
    allowedOrigins: FRONTEND_URLS
  });
});

// Calculate budget endpoint
app.post('/calculate-budget', async (req: Request, res: Response) => {
  console.log('[Calculate Budget] Received request:', {
    body: req.body,
    query: req.query,
    origin: req.headers.origin
  });

  try {
    await agent.handleTravelRequest(req, res);
  } catch (error) {
    console.error('[Calculate Budget] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
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
    origin: req.headers.origin
  });
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    timestamp: new Date().toISOString(),
    path: req.url
  });
});

// Only start the server in development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/api/health`);
    console.log('Environment:', {
      nodeEnv: process.env.NODE_ENV,
      perplexityApiKey: !!process.env.PERPLEXITY_API_KEY,
      redditClientId: !!process.env.REDDIT_CLIENT_ID,
      redditClientSecret: !!process.env.REDDIT_CLIENT_SECRET,
      allowedOrigins: FRONTEND_URLS
    });
  });
}

export default app; 