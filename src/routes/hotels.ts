import express, { Request, Response } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { HotelService } from '../services/hotels.js';
import { logger } from '../utils/logger.js';
import axios from 'axios';

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

interface HotelImagesRequest {
  query: string;
  limit?: number;
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

router.post('/images', async (req: Request<{}, {}, HotelImagesRequest>, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
      console.warn('Google Search API credentials not configured');
      return res.status(200).json({ items: [] });
    }

    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        searchType: 'image',
        num: limit,
        imgType: 'photo',
        imgSize: 'large',
        safe: 'active'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching hotel images:', error);
    res.status(500).json({ error: 'Failed to fetch hotel images' });
  }
});

export default router; 