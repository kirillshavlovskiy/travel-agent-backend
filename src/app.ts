import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import flightsRouter from './routes/flights.js';
import hotelsRouter from './routes/hotels.js';
import { logger } from './utils/logger.js';
import locationsRouter from './routes/locations.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/flights', flightsRouter);
app.use('/api/hotels', hotelsRouter);
app.use('/api/locations', locationsRouter);

logger.info('Routes mounted', {
  flights: true,
  hotels: true
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

export default app; 