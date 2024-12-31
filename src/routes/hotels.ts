import { Router, Request, Response } from 'express';
import { AmadeusService } from '../services/amadeus.js';

const router = Router();
const amadeusService = new AmadeusService();

router.post('/search', async (req: Request, res: Response) => {
  try {
    const { cityCode, checkInDate, checkOutDate, adults, roomQuantity, priceRange, ratings } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!cityCode) missingFields.push('cityCode');
    if (!checkInDate) missingFields.push('check-in date');
    if (!checkOutDate) missingFields.push('check-out date');
    if (!adults) missingFields.push('number of guests');

    if (missingFields.length > 0) {
      console.error('[Hotels Route] Missing fields:', missingFields);
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    // Search for hotels using Amadeus
    const hotelOffers = await amadeusService.searchHotels({
      cityCode,
      checkInDate,
      checkOutDate,
      adults,
      roomQuantity,
      priceRange,
      ratings
    });

    // Transform the hotel offers
    const transformedOffers = hotelOffers.map(offer => amadeusService.transformHotelOffer(offer));

    // Group hotels by tier
    const groupedHotels = transformedOffers.reduce((acc, hotel) => {
      if (!acc[hotel.tier]) {
        acc[hotel.tier] = {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.9,
          source: 'Amadeus Direct',
          references: []
        };
      }

      const tier = acc[hotel.tier];
      tier.references.push(hotel);
      
      const price = hotel.price.amount;
      tier.min = Math.min(tier.min, price);
      tier.max = Math.max(tier.max, price);
      tier.average = tier.references.reduce((sum: number, h: { price: { amount: number } }) => sum + h.price.amount, 0) / tier.references.length;

      return acc;
    }, {} as Record<string, {
      min: number;
      max: number;
      average: number;
      confidence: number;
      source: string;
      references: Array<{
        tier: string;
        price: { amount: number };
      }>;
    }>);

    res.json({
      success: true,
      data: {
        hotels: groupedHotels,
        source: 'amadeus',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Hotels Route] Error searching hotels:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 