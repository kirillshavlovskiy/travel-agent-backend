import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import enrichmentRouter from './routes/enrichment';
import placesRouter from './routes/places';
import imagesRouter from './routes/images';
const app = express();
// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
// Register routes
app.use('/api/enrichment', enrichmentRouter);
app.use('/api/places', placesRouter);
app.use('/api/images', imagesRouter);
export default app;
//# sourceMappingURL=app.js.map