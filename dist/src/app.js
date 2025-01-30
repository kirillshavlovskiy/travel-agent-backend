import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import hotelsRouter from './routes/hotels.js';
import flightsRouter from './routes/flights.js';
import budgetRouter from './routes/budget.js';
import locationsRouter from './routes/locations.js';
const app = express();
// Middleware
app.use(cors());
app.use(express.json());
// Logging middleware
app.use((req, res, next) => {
    logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body
    });
    next();
});
// Routes
app.use('/api/hotels', hotelsRouter);
app.use('/api/flights', flightsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/locations', locationsRouter);
// Error handling
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'An unexpected error occurred'
    });
});
export default app;
