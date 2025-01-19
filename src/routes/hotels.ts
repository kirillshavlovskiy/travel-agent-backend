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

interface Destination {
  cityCode: string;
  arrivalDate: string;
  departureDate: string;
}

router.post('/search', async (req: Request, res: Response) => {
  const { destinations, adults, roomQuantity, currency } = req.body;

  // Log the exact request payload
  logger.info('[Hotels Route] Raw request body:', JSON.stringify(req.body, null, 2));

  logger.info('[Hotels Route] Received search request:', {
    destinations,
    adults,
    roomQuantity,
    currency,
    timestamp: new Date().toISOString()
  });

  try {
    // Log the exact payload being sent to the hotel service
    const searchParams = {
      destinations: destinations.map((dest: any) => ({
        cityCode: dest.cityCode,
        arrivalDate: dest.arrivalDate,
        departureDate: dest.departureDate
      })),
      adults,
      roomQuantity,
      currency
    };
    
    logger.info('[Hotels Route] Calling hotel service with params:', JSON.stringify(searchParams, null, 2));

    const results = await hotelService.searchHotelsMultiDestination(searchParams);

    logger.info('[Hotels Route] Search completed:', {
      totalHotels: results.reduce((sum, result) => sum + result.hotels.length, 0),
      destinations: results.map(r => r.cityCode),
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        cityCode: r.cityCode,
        checkInDate: r.checkInDate,
        checkOutDate: r.checkOutDate,
        hotelCount: r.hotels.length
      }))
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('[Hotels Route] Error searching hotels:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      requestBody: req.body
    });

    res.status(500).json({
      success: false,
      error: 'Failed to search hotels'
    });
  }
});

export default router; 