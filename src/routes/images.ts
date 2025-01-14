import { Router } from 'express';
import { searchImages } from '../services/google-images.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/search', async (req, res) => {
  const { q: query } = req.query;

  if (!query || typeof query !== 'string') {
    logger.warn('Missing or invalid query parameter');
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const images = await searchImages(query);
    res.json({ images });
  } catch (error) {
    logger.error('Error in image search route', { error });
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

export default router; 