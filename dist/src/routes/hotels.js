import express from 'express';
import { z } from 'zod';
import { HotelService } from '../services/hotels.js';
import { logger } from '../utils/logger.js';
import axios from 'axios';
const router = express.Router();
const hotelService = new HotelService();
// City code mapping for common destinations
const CITY_CODES = {
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
router.post('/search', async (req, res) => {
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
            destinations: destinations.map((dest) => ({
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
    }
    catch (error) {
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
router.post('/images', async (req, res) => {
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
    }
    catch (error) {
        console.error('Error fetching hotel images:', error);
        res.status(500).json({ error: 'Failed to fetch hotel images' });
    }
});
// Confirm hotel offer availability
router.post('/confirm-offer', async (req, res) => {
    try {
        const { data } = req.body;
        if (!data || !data.roomAssociations?.[0]?.hotelOfferId) {
            logger.warn('Missing required parameters for offer confirmation:', req.body);
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters'
            });
        }
        const offerId = data.roomAssociations[0].hotelOfferId;
        const hotelId = offerId.split('_')[0]; // Assuming hotelId is part of the offerId
        logger.info('Creating hotel booking:', {
            hotelId,
            offerId,
            guestInfo: data.guests[0]
        });
        const result = await hotelService.bookHotel(offerId, {
            firstName: data.guests[0].firstName,
            lastName: data.guests[0].lastName,
            email: data.guests[0].email,
            phone: data.guests[0].phone,
            payment: {
                vendorCode: data.payment.paymentCard.paymentCardInfo.vendorCode,
                cardNumber: data.payment.paymentCard.paymentCardInfo.cardNumber,
                expiryDate: data.payment.paymentCard.paymentCardInfo.expiryDate
            }
        });
        logger.info('Hotel booking successful:', {
            hotelId,
            offerId,
            bookingId: result.data.id
        });
        return res.json(result);
    }
    catch (error) {
        logger.error('Error confirming hotel offer:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            request: req.body
        });
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to confirm hotel offer'
        });
    }
});
export default router;
