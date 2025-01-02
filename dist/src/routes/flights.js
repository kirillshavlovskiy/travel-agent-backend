import { Router } from 'express';
import { AmadeusService } from '../services/amadeus.js';
const router = Router();
const amadeusService = new AmadeusService();
// Test endpoint to verify the router is working
router.get('/test', (req, res) => {
    console.log('Flight test endpoint called');
    res.json({
        status: 'ok',
        message: 'Flight routes are working',
        timestamp: new Date().toISOString()
    });
});
// Flight search endpoint
router.post('/', async (req, res) => {
    try {
        const { departureLocation, destinations, travelers = 1, cabinClass } = req.body;
        if (!departureLocation || !destinations || !destinations.length) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters'
            });
        }
        let flightOffers = [];
        let source = 'amadeus';
        if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
            try {
                // Validate and format IATA codes
                const originCode = departureLocation.code.trim().toUpperCase();
                const destinationCode = destinations[0].code.trim().toUpperCase();
                // Validate and format dates
                const outboundDate = new Date(departureLocation.outboundDate);
                const inboundDate = departureLocation.inboundDate ? new Date(departureLocation.inboundDate) : null;
                if (isNaN(outboundDate.getTime()) || (inboundDate && isNaN(inboundDate.getTime()))) {
                    throw new Error('Invalid date format. Please use YYYY-MM-DD format.');
                }
                // Format dates to YYYY-MM-DD
                const formattedOutboundDate = outboundDate.toISOString().split('T')[0];
                const formattedInboundDate = inboundDate ? inboundDate.toISOString().split('T')[0] : undefined;
                // Validate cabin class
                const validCabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
                const formattedCabinClass = cabinClass ? cabinClass.toUpperCase() : undefined;
                if (formattedCabinClass && !validCabinClasses.includes(formattedCabinClass)) {
                    throw new Error(`Invalid cabin class. Must be one of: ${validCabinClasses.join(', ')}`);
                }
                console.log('Searching flights with Amadeus:', {
                    origin: originCode,
                    destination: destinationCode,
                    dates: {
                        outbound: formattedOutboundDate,
                        inbound: formattedInboundDate
                    },
                    cabinClass: formattedCabinClass,
                    travelers
                });
                const amadeusResults = await amadeusService.searchFlights({
                    originLocationCode: originCode,
                    destinationLocationCode: destinationCode,
                    departureDate: formattedOutboundDate,
                    returnDate: formattedInboundDate,
                    adults: travelers,
                    travelClass: formattedCabinClass
                });
                if (amadeusResults && amadeusResults.length > 0) {
                    console.log(`Found ${amadeusResults.length} Amadeus results`);
                    // Get unique airline codes from all results
                    const uniqueAirlineCodes = [...new Set(amadeusResults.flatMap(offer => offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => segment.carrierCode))))];
                    console.log('Unique airline codes:', uniqueAirlineCodes);
                    // Fetch airline information for all carriers at once
                    let airlineInfoArray;
                    try {
                        airlineInfoArray = await amadeusService.getAirlineInfo(uniqueAirlineCodes);
                    }
                    catch (error) {
                        console.error('Failed to fetch airline information:', error);
                        airlineInfoArray = uniqueAirlineCodes.map(code => ({
                            type: 'airline',
                            iataCode: code,
                            icaoCode: code,
                            businessName: code,
                            commonName: code
                        }));
                    }
                    // Transform flight offers
                    flightOffers = amadeusResults;
                    console.log(`  IDs: ${flightOffers.map(f => f.id).join(', ')}`);
                }
            }
            catch (error) {
                console.error('Error searching Amadeus flights:', error);
            }
        }
        if (!flightOffers || flightOffers.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No flights found'
            });
        }
        return res.json({
            success: true,
            data: flightOffers,
            source
        });
    }
    catch (error) {
        console.error('Error processing flight search:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});
export default router;
