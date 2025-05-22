import express from 'express';
import { Amadeus } from '../services/amadeus';
import { authenticateToken } from '../middleware/auth';
const router = express.Router();
const amadeus = new Amadeus();
router.post('/seatmap', authenticateToken, async (req, res) => {
    try {
        const { flightOffer } = req.body;
        if (!flightOffer) {
            return res.status(400).json({ error: 'Flight offer is required' });
        }
        console.log('Received flight offer:', JSON.stringify(flightOffer, null, 2));
        const seatMap = await amadeus.getSeatMap(flightOffer);
        if (!seatMap || !seatMap.segments || seatMap.segments.length === 0) {
            return res.status(404).json({ error: 'No seat map available for this flight' });
        }
        res.json(seatMap);
    }
    catch (error) {
        console.error('Error retrieving seat map:', {
            error: error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
                cause: error.cause,
                raw: error
            } : error,
            flightOffer: req.body.flightOffer
        });
        let errorMessage = 'Failed to retrieve seat map';
        let errorDetails = error instanceof Error ? error.message : String(error);
        // Try to extract more detailed error information
        if (error && typeof error === 'object') {
            try {
                const errorObj = JSON.stringify(error);
                errorDetails = errorObj;
            }
            catch (e) {
                console.error('Error stringifying error object:', e);
            }
        }
        res.status(500).json({
            error: errorMessage,
            details: errorDetails
        });
    }
});
export default router;
