import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { AmadeusService } from '../services/amadeus.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const amadeusService = new AmadeusService();

const searchHotelsSchema = z.object({
  destination: z.string(),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().positive(),
  roomQuantity: z.number().int().positive().optional().default(1),
  priceRange: z.string().optional(),
  ratings: z.string().optional()
});

router.post('/search', validateRequest(searchHotelsSchema), async (req, res) => {
  try {
    const { destination, checkInDate, checkOutDate, adults, roomQuantity = 1, ratings = '1,2,3,4,5' } = req.body;

    logger.info('Searching for hotels', {
      destination,
      checkInDate,
      checkOutDate,
      adults
    });

    const hotels = await amadeusService.searchHotels({
      cityCode: destination,
      checkInDate,
      checkOutDate,
      adults,
      roomQuantity,
      currency: 'USD',
      radius: 50,
      ratings
    });

    const transformedHotels = hotels.map(hotel => amadeusService.transformHotelOffer(hotel));

    logger.info('Hotels found', { 
      count: hotels.length,
      transformedCount: transformedHotels.length
    });

    res.json({
      success: true,
      data: transformedHotels,
      count: transformedHotels.length
    });
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

      return res.status(errorDetails.status).json({
        success: false,
        error: 'Failed to search for hotels',
        details: errorDetails.detail,
        code: errorDetails.code,
        title: errorDetails.title
      });
    }

    if (error instanceof Error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to search for hotels',
        details: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to search for hotels',
      details: 'An unknown error occurred'
    });
  }
});

export default router; 