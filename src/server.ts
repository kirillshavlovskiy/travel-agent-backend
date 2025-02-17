import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { config } from 'dotenv';
import authRoutes from './routes/auth/index.js';
import budgetRoutes from './routes/budget.js';
import flightRoutes from './routes/flights.js';
import hotelRoutes from './routes/hotels.js';
import perplexityRoutes from './routes/perplexity.js';
import { activitiesRouter } from './routes/activities.js';
import enrichmentRouter from './routes/enrichment.js';
import locationsRouter from './routes/locations.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();

// Enable JSON body parsing
app.use(express.json());

// Add timeout middleware with longer timeout for budget calculation
app.use((req: Request, res: Response, next: NextFunction) => {
  // Set a longer timeout (10 minutes) for budget calculation
  const timeoutDuration = req.path.includes('/api/budget/calculate') ? 600000 : 30000;
  
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

// Mount the activities router with auth middleware
app.use('/api/activities', authMiddleware, activitiesRouter); 