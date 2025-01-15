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
router.post('/search', async (req, res) => {
    const errors = [];
    let flightOffers = [];
    try {
        // Validate required fields
        const { origin, destination, outboundDate, inboundDate, travelers, cabinClass } = req.body;
        if (!origin || !destination || !outboundDate || !travelers) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                requiredFields: ['origin', 'destination', 'outboundDate', 'travelers']
            });
        }
        // Validate dates
        const currentDate = new Date();
        const outDate = new Date(outboundDate);
        const inDate = inboundDate ? new Date(inboundDate) : null;
        if (outDate < currentDate) {
            return res.status(400).json({
                success: false,
                error: 'Outbound date cannot be in the past'
            });
        }
        if (inDate && inDate < outDate) {
            return res.status(400).json({
                success: false,
                error: 'Inbound date must be after outbound date'
            });
        }
        // Validate travelers
        const numTravelers = parseInt(travelers);
        if (isNaN(numTravelers) || numTravelers < 1 || numTravelers > 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid number of travelers. Must be between 1 and 9'
            });
        }
        // Extract location codes
        const originCode = origin.code || origin;
        const destinationCode = destination.code || destination;
        // Format dates
        const formattedOutboundDate = outboundDate.split('T')[0];
        const formattedInboundDate = inboundDate ? inboundDate.split('T')[0] : undefined;
        // Optimize cabin class search strategy
        let searchCabinClasses = [];
        if (cabinClass) {
            const formattedCabinClass = cabinClass.toUpperCase();
            const validCabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
            if (!validCabinClasses.includes(formattedCabinClass)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid cabin class. Must be one of: ${validCabinClasses.join(', ')}`
                });
            }
            searchCabinClasses = [formattedCabinClass];
        }
        else {
            // If no cabin class specified, prioritize economy and premium economy
            searchCabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY'];
        }
        console.log('Searching flights with Amadeus:', {
            origin: originCode,
            destination: destinationCode,
            dates: {
                outbound: formattedOutboundDate,
                inbound: formattedInboundDate
            },
            cabinClasses: searchCabinClasses,
            travelers: numTravelers
        });
        // Sequential search with rate limiting
        let lastError;
        for (const travelClass of searchCabinClasses) {
            try {
                const results = await amadeusService.searchFlights({
                    originLocationCode: originCode,
                    destinationLocationCode: destinationCode,
                    departureDate: formattedOutboundDate,
                    returnDate: formattedInboundDate,
                    adults: numTravelers,
                    travelClass: travelClass,
                    max: 25 // Limit results per cabin class
                });
                if (results && results.length > 0) {
                    flightOffers.push(...results);
                    // Get unique airline codes
                    const uniqueAirlineCodes = [...new Set(results.flatMap(offer => offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => segment.carrierCode))))];
                    // Fetch airline information
                    try {
                        const airlineInfoArray = await amadeusService.getAirlineInfo(uniqueAirlineCodes);
                        console.log(`Found ${results.length} results for ${travelClass}`);
                    }
                    catch (error) {
                        console.error('Failed to fetch airline information:', error);
                        errors.push(`Airline information unavailable for ${travelClass}`);
                    }
                }
            }
            catch (error) {
                lastError = error;
                console.error(`Search failed for ${travelClass}:`, error);
                if (error.response?.status === 429) {
                    // Rate limit hit, wait before next attempt
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        if (flightOffers.length === 0) {
            return res.status(lastError?.response?.status || 500).json({
                success: false,
                error: 'No flights found',
                details: lastError?.message || 'Unknown error occurred',
                errors
            });
        }
        // Sort results by price
        flightOffers.sort((a, b) => parseFloat(a.price.total) - parseFloat(b.price.total));
        // Add detailed tier analysis logging
        const tierAnalysis = {
            budget: [],
            medium: [],
            premium: []
        };
        flightOffers.forEach(offer => {
            const price = parseFloat(offer.price.total);
            const cabinClass = offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin;
            const tier = amadeusService.determineTier(price, cabinClass);
            console.log('[Tier Analysis]', {
                price,
                cabinClass,
                tier,
                segments: offer.itineraries.map(it => ({
                    segments: it.segments.map(seg => ({
                        departure: seg.departure.iataCode,
                        arrival: seg.arrival.iataCode,
                        carrier: seg.carrierCode,
                        duration: seg.duration
                    }))
                })),
                validatingCarrier: offer.validatingAirlineCodes[0]
            });
            tierAnalysis[tier].push({
                price,
                cabinClass,
                id: offer.id,
                carrier: offer.validatingAirlineCodes[0]
            });
        });
        console.log('[Tier Summary]', {
            total: flightOffers.length,
            byTier: {
                budget: {
                    count: tierAnalysis.budget.length,
                    priceRange: tierAnalysis.budget.length > 0 ? {
                        min: Math.min(...tierAnalysis.budget.map(f => f.price)),
                        max: Math.max(...tierAnalysis.budget.map(f => f.price))
                    } : null
                },
                medium: {
                    count: tierAnalysis.medium.length,
                    priceRange: tierAnalysis.medium.length > 0 ? {
                        min: Math.min(...tierAnalysis.medium.map(f => f.price)),
                        max: Math.max(...tierAnalysis.medium.map(f => f.price))
                    } : null
                },
                premium: {
                    count: tierAnalysis.premium.length,
                    priceRange: tierAnalysis.premium.length > 0 ? {
                        min: Math.min(...tierAnalysis.premium.map(f => f.price)),
                        max: Math.max(...tierAnalysis.premium.map(f => f.price))
                    } : null
                }
            },
            byCabinClass: Object.fromEntries([...new Set(flightOffers.map(o => o.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin))].map(cabin => [
                cabin,
                flightOffers.filter(o => o.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === cabin).length
            ]))
        });
        // Transform flight offers into grouped format
        const groupedFlights = {
            budget: {
                min: tierAnalysis.budget.length > 0 ? Math.min(...tierAnalysis.budget.map(f => f.price)) : 0,
                max: tierAnalysis.budget.length > 0 ? Math.max(...tierAnalysis.budget.map(f => f.price)) : 0,
                average: tierAnalysis.budget.length > 0 ?
                    tierAnalysis.budget.reduce((sum, f) => sum + f.price, 0) / tierAnalysis.budget.length : 0,
                confidence: 0.8,
                source: 'amadeus',
                references: tierAnalysis.budget.map(f => ({
                    id: f.id,
                    airline: f.carrier,
                    cabinClass: f.cabinClass,
                    price: {
                        amount: f.price,
                        currency: 'USD',
                        numberOfTravelers: numTravelers
                    }
                }))
            },
            medium: {
                min: tierAnalysis.medium.length > 0 ? Math.min(...tierAnalysis.medium.map(f => f.price)) : 0,
                max: tierAnalysis.medium.length > 0 ? Math.max(...tierAnalysis.medium.map(f => f.price)) : 0,
                average: tierAnalysis.medium.length > 0 ?
                    tierAnalysis.medium.reduce((sum, f) => sum + f.price, 0) / tierAnalysis.medium.length : 0,
                confidence: 0.8,
                source: 'amadeus',
                references: tierAnalysis.medium.map(f => ({
                    id: f.id,
                    airline: f.carrier,
                    cabinClass: f.cabinClass,
                    price: {
                        amount: f.price,
                        currency: 'USD',
                        numberOfTravelers: numTravelers
                    }
                }))
            },
            premium: {
                min: tierAnalysis.premium.length > 0 ? Math.min(...tierAnalysis.premium.map(f => f.price)) : 0,
                max: tierAnalysis.premium.length > 0 ? Math.max(...tierAnalysis.premium.map(f => f.price)) : 0,
                average: tierAnalysis.premium.length > 0 ?
                    tierAnalysis.premium.reduce((sum, f) => sum + f.price, 0) / tierAnalysis.premium.length : 0,
                confidence: 0.8,
                source: 'amadeus',
                references: tierAnalysis.premium.map(f => ({
                    id: f.id,
                    airline: f.carrier,
                    cabinClass: f.cabinClass,
                    price: {
                        amount: f.price,
                        currency: 'USD',
                        numberOfTravelers: numTravelers
                    }
                }))
            }
        };
        return res.json({
            success: true,
            data: {
                flights: groupedFlights,
                summary: {
                    total: flightOffers.length,
                    byTier: {
                        budget: tierAnalysis.budget.length,
                        medium: tierAnalysis.medium.length,
                        premium: tierAnalysis.premium.length
                    }
                }
            },
            errors: errors.length > 0 ? errors : undefined
        });
    }
    catch (error) {
        console.error('Flight search error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});
// Test endpoint to measure Amadeus API response time
router.get('/test-amadeus-timing', async (req, res) => {
    try {
        console.time('amadeus-search');
        const results = await amadeusService.searchFlights({
            originLocationCode: 'JFK',
            destinationLocationCode: 'PAR',
            departureDate: '2025-01-09',
            returnDate: '2025-01-16',
            adults: 2,
            travelClass: 'ECONOMY'
        });
        console.timeEnd('amadeus-search');
        res.json({
            success: true,
            timing: process.hrtime(),
            resultsCount: results.length,
            firstResult: results[0] ? {
                id: results[0].id,
                price: results[0].price,
                segments: results[0].itineraries[0].segments.length
            } : null
        });
    }
    catch (error) {
        console.error('Amadeus timing test error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Unknown error occurred'
        });
    }
});
export default router;
//# sourceMappingURL=flights.js.map