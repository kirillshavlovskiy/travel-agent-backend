import express from 'express';
import cors from 'cors';
import budgetRouter from './budget/router';
import flightsRouter from './flights/router';
import hotelsRouter from './hotels/router';
import imagesRouter from './images/proxy';

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/budget', budgetRouter);
app.use('/api/flights', flightsRouter);
app.use('/api/hotels', hotelsRouter);
app.use('/api/images', imagesRouter);

export default app; 