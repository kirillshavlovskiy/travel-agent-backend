import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { HotelService } from '../services/hotels.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const hotelService = new HotelService();

// City code mapping for common destinations
const CITY_CODES: Record<string, string> = {
  'Amsterdam, Netherlands': 'AMS',
  'Amsterdam': 'AMS',
  'Paris, France': 'PAR',
  'Paris': 'PAR',
  'London, United Kingdom': 'LON',
  'London': 'LON',
  'New York, United States': 'NYC',
  'New York': 'NYC'
};

const searchHotelsSchema = z.object({
  destinations: z.array(z.object({
    cityCode: z.string(),
    arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    departureTime: z.string().regex(/^\d{2}:\d{2}$/).optional()
  })).min(1),
  adults: z.number().int().positive(),
  roomQuantity: z.number().int().positive().optional().default(1),
  ratings: z.string().optional(),
  currency: z.string().optional().default('USD')
});

router.post('/search', validateRequest(searchHotelsSchema), async (req, res) => {
  try {
    const { destinations, adults, roomQuantity = 1, ratings, currency = 'USD' } = req.body;

    logger.info('Searching for hotels with multi-destination params:', {
      destinations,
      adults,
      roomQuantity
    });

    // Create search plan with proper check-in/check-out dates
    const searchPlan = hotelService.createSearchPlan(destinations);

    logger.info('Created search plan:', { searchPlan });

    // Search hotels for all destinations
    const results = await hotelService.searchHotelsMultiDestination({
      destinations: searchPlan,
      adults,
      roomQuantity,
      ratings,
      currency,
      radius: 50 // Default radius in KM
    });

    const totalHotels = results.reduce((sum, result) => sum + result.hotels.length, 0);
    logger.info('Hotels found', { count: totalHotels });

    return res.json({
      success: true,
      data: results,
      count: totalHotels
    });

  } catch (error) {
    logger.error('Error searching hotels:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      code: 'HOTEL_SEARCH_ERROR'
    });
  }
});

export default router; 