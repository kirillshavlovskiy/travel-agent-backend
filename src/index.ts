import express from 'express';
import activitiesRouter from './routes/activities.js';
import imagesRouter from './routes/images.js';

const app = express();

// Register routes
app.use('/api/activities', activitiesRouter);
app.use('/api/images', imagesRouter); 