import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from 'dotenv';
import redditAuthRoutes from './src/routes/auth/reddit.js';
import VacationBudgetAgent from './src/services/agents.js';

// Load environment variables
config();

const app = express();

// Configure CORS with environment-aware origin
const FRONTEND_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3002';

// List of allowed origins
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:3002',
  'https://ai-trip-advisor.vercel.app',
  'https://ai-trip-advisor-server.vercel.app',
  'https://ai-trip-advisor-1b18b6eyj-kirills-projects-bfbcd3f8.vercel.app'
];

// Configure CORS
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }

    console.log('[CORS] Request from origin:', origin);

    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      console.log('[CORS] Origin not allowed:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, {
    headers: req.headers,
    query: req.query,
    body: req.body
  });
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
    timestamp: new Date().toISOString()
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
    allowedOrigins: allowedOrigins
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Global error handler:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404
app.use((req: Request, res: Response) => {
  console.log(`404 Not Found: ${req.method} ${req.url}`);
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
      redditClientSecret: !!process.env.REDDIT_CLIENT_SECRET
    });
  });
}

// Export the Express app for Vercel
export default app;