import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import redditAuthRoutes from './src/routes/auth/reddit.js';
import VacationBudgetAgent from './src/services/agents.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from 'dotenv';

// Get current file path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS
app.use(cors({
  origin: 'http://localhost:3002',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
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

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    perplexityApiKey: !!process.env.PERPLEXITY_API_KEY,
    redditClientId: !!process.env.REDDIT_CLIENT_ID,
    redditClientSecret: !!process.env.REDDIT_CLIENT_SECRET
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
    timestamp: new Date().toISOString()
  });
});

// Start server with error handling
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log('Environment:', {
    nodeEnv: process.env.NODE_ENV,
    perplexityApiKey: !!process.env.PERPLEXITY_API_KEY,
    redditClientId: !!process.env.REDDIT_CLIENT_ID,
    redditClientSecret: !!process.env.REDDIT_CLIENT_SECRET
  });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error('Server error:', {
    code: error.code,
    message: error.message,
    stack: error.stack
  });
  
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please try a different port or kill the process using this port.`);
    process.exit(1);
  } else {
    console.error('Unhandled server error');
    process.exit(1);
  }
});