import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

const router = Router();

// Define supported locations with their details
const supportedLocations = [
  {
    id: 'amsterdam',
    name: 'Amsterdam',
    country: 'Netherlands',
    displayName: 'Amsterdam, Netherlands',
    coordinates: {
      latitude: 52.3676,
      longitude: 4.9041
    },
    airports: ['AMS'],
    timezone: 'Europe/Amsterdam',
    currency: 'EUR',
    languages: ['Dutch', 'English'],
    popularSeasons: {
      high: ['Jun', 'Jul', 'Aug'],
      shoulder: ['Apr', 'May', 'Sep', 'Oct'],
      low: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    }
  },
  {
    id: 'paris',
    name: 'Paris',
    country: 'France',
    displayName: 'Paris, France',
    coordinates: {
      latitude: 48.8566,
      longitude: 2.3522
    },
    airports: ['CDG', 'ORY'],
    timezone: 'Europe/Paris',
    currency: 'EUR',
    languages: ['French', 'English'],
    popularSeasons: {
      high: ['Jun', 'Jul', 'Aug', 'Sep'],
      shoulder: ['Apr', 'May', 'Oct'],
      low: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    }
  },
  {
    id: 'london',
    name: 'London',
    country: 'United Kingdom',
    displayName: 'London, United Kingdom',
    coordinates: {
      latitude: 51.5074,
      longitude: -0.1278
    },
    airports: ['LHR', 'LGW', 'STN', 'LTN', 'LCY'],
    timezone: 'Europe/London',
    currency: 'GBP',
    languages: ['English'],
    popularSeasons: {
      high: ['Jun', 'Jul', 'Aug'],
      shoulder: ['Apr', 'May', 'Sep', 'Oct'],
      low: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    }
  }
];

// Get all supported locations
router.get('/', (req: Request, res: Response) => {
  logger.info('Fetching all supported locations');
  res.json({ locations: supportedLocations });
});

// Search locations by query
router.get('/search', (req: Request, res: Response) => {
  const { query } = req.query;
  
  if (!query || typeof query !== 'string') {
    logger.warn('Invalid search query', { query });
    return res.status(400).json({ error: 'Invalid search query' });
  }

  logger.info('Searching locations', { query });
  
  const normalizedQuery = query.toLowerCase();
  const results = supportedLocations.filter(location => 
    location.name.toLowerCase().includes(normalizedQuery) ||
    location.country.toLowerCase().includes(normalizedQuery) ||
    location.displayName.toLowerCase().includes(normalizedQuery) ||
    location.airports.some(airport => airport.toLowerCase().includes(normalizedQuery))
  );

  res.json({ 
    results,
    count: results.length,
    query
  });
});

// Get location by ID
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  
  logger.info('Fetching location by ID', { id });
  
  const location = supportedLocations.find(loc => loc.id === id);
  
  if (!location) {
    logger.warn('Location not found', { id });
    return res.status(404).json({ error: 'Location not found' });
  }
  
  res.json(location);
});

export default router; 