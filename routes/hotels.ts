import express, { Request, Response } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { HotelService } from '../services/hotels.js';
import { logger } from '../utils/logger.js';
import axios from 'axios';
import { BookingRequest } from '../types/booking.js';

const router = express.Router();
const hotelService = new HotelService();

// Get hotels endpoint
router.get('/', async (req, res) => {
  try {
    res.json({ message: 'Hotels endpoint' });
  } catch (error) {
    console.error('Error in hotels route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confirm hotel offer availability
router.post('/confirm-offer', async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data || !data.roomAssociations?.[0]?.hotelOfferId) {
      throw new Error('Missing required offer ID');
    }

    const offerId = data.roomAssociations[0].hotelOfferId;
    const result = await hotelService.confirmHotelOffer(offerId);

    res.json({
      success: true,
      data: result
    });

  } catch (err: any) {
    console.error('Error confirming hotel offer:', err);
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to confirm hotel offer'
    });
  }
});

// Book hotel
router.post('/book', async (req: Request, res: Response) => {
  try {
    const { offerId, guest, payment } = req.body as BookingRequest;

    logger.info('Booking hotel:', { offerId });

    if (!offerId || !guest || !payment) {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking information'
      });
    }

    const booking = await hotelService.bookHotel(offerId, {
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      phone: guest.phone,
      payment: {
        cardNumber: payment.cardNumber,
        expiryDate: payment.expiryDate,
        vendorCode: payment.vendorCode,
        holderName: payment.holderName
      }
    });

    return res.json({
      success: true,
      data: booking.data
    });

  } catch (error: any) {
    logger.error('Error in book hotel route:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to book hotel'
    });
  }
});

export default router; 