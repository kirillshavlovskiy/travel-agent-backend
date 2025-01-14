import express from 'express';
import { cities } from '../src/data/cities.js';
import { airports } from '../src/data/airports.js';

const router = express.Router();

// Get locations endpoint
router.get('/locations', async (req, res) => {
  try {
    console.log('[Budget Route] Fetching available locations');
    res.json({
      success: true,
      data: {
        cities: cities.map(city => ({
          value: city.value,
          label: city.label
        })),
        airports: airports.map(airport => ({
          value: airport.value,
          label: airport.label
        }))
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Budget Route] Error fetching locations:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

// Get budget endpoint
router.get('/', async (req, res) => {
  try {
    res.json({ message: 'Budget endpoint' });
  } catch (error) {
    console.error('Error in budget route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
