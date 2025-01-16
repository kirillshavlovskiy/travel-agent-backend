import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { AmadeusService } from '../services/amadeus.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const amadeusService = new AmadeusService();

// City code mapping for common destinations
const CITY_CODES: Record<string, string> = {
  'Amsterdam, Netherlands': 'AMS',
  'Amsterdam': 'AMS'
};

const searchHotelsSchema = z.object({
  destination: z.string(),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  numberOfTravelers: z.number()
});

router.post('/search', validateRequest(searchHotelsSchema), async (req, res) => {
  try {
    const { destination, checkInDate, checkOutDate, numberOfTravelers } = req.body;

    logger.info('Searching for hotels', {
      destination,
      checkInDate,
      checkOutDate,
      numberOfTravelers
    });

    // Convert destination to city code
    const cityCode = CITY_CODES[destination];
    if (!cityCode) {
      logger.error('Invalid city code', { destination });
      return res.status(400).json({
        error: 'Invalid destination',
        details: 'City code not found for the provided destination',
        code: 'INVALID_CITY_CODE'
      });
    }

    const hotels = await amadeusService.searchHotels({
      cityCode,
      checkInDate,
      checkOutDate,
      adults: numberOfTravelers,
      roomQuantity: 1,
      currency: 'USD',
      radius: 50,
      ratings: '1,2,3,4,5'
    });

    logger.info('Hotels found', { count: hotels.length });

    res.json(hotels);
  } catch (error: unknown) {
    logger.error('Failed to search for hotels', error);
    
    // Handle Amadeus API errors
    if (error && typeof error === 'object' && 'response' in error) {
      const amadeusError = error as any;
      const errorDetails = amadeusError.response?.result?.errors?.[0] || {
        status: 500,
        code: 'UNKNOWN_ERROR',
        title: 'Unknown Error',
        detail: 'An unknown error occurred'
      };

      res.status(errorDetails.status).json({
        error: 'Failed to search for hotels',
        details: errorDetails.detail,
        code: errorDetails.code,
        title: errorDetails.title
      });
    } else if (error instanceof Error) {
      res.status(500).json({
        error: 'Failed to search for hotels',
        details: error.message
      });
    } else {
      res.status(500).json({
        error: 'Failed to search for hotels',
        details: 'An unknown error occurred'
      });
    }
  }
});

export default router; 