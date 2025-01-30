import { Router } from 'express';
import { AmadeusService } from '../services/amadeus.js';
import { logger } from '../utils/logger.js';
const router = Router();
const amadeusService = new AmadeusService();
router.post('/', async (req, res) => {
    try {
        const { origin, destination, outboundDate, inboundDate, travelers, cabinClass } = req.body;
        // Validate required fields
        const errors = [];
        if (!origin)
            errors.push('Origin is required');
        if (!destination)
            errors.push('Destination is required');
        if (!outboundDate)
            errors.push('Outbound date is required');
        if (!travelers)
            errors.push('Number of travelers is required');
        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }
        // Validate dates
        const outboundDateObj = new Date(outboundDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (outboundDateObj < today) {
            return res.status(400).json({
                errors: ['Outbound date cannot be in the past']
            });
        }
        if (inboundDate) {
            const inboundDateObj = new Date(inboundDate);
            if (inboundDateObj < outboundDateObj) {
                return res.status(400).json({
                    errors: ['Inbound date must be after outbound date']
                });
            }
        }
        // Validate number of travelers
        const numTravelers = parseInt(travelers);
        if (isNaN(numTravelers) || numTravelers < 1 || numTravelers > 9) {
            return res.status(400).json({
                errors: ['Number of travelers must be between 1 and 9']
            });
        }
        // Validate cabin class
        const validCabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
        if (cabinClass && !validCabinClasses.includes(cabinClass.toUpperCase())) {
            return res.status(400).json({
                errors: ['Invalid cabin class. Must be one of: ' + validCabinClasses.join(', ')]
            });
        }
        // Search for flights
        const flightOffers = await amadeusService.searchFlights({
            originLocationCode: origin,
            destinationLocationCode: destination,
            departureDate: outboundDate,
            returnDate: inboundDate,
            adults: numTravelers,
            travelClass: cabinClass?.toUpperCase() || 'ECONOMY',
            max: 100,
            currencyCode: 'USD'
        });
        if (!flightOffers || flightOffers.length === 0) {
            return res.status(404).json({
                message: 'No flights found for the given criteria'
            });
        }
        // Sort flight offers by price
        flightOffers.sort((a, b) => parseFloat(a.price.total) - parseFloat(b.price.total));
        // Calculate tier statistics
        const tierAnalysis = {
            budget: flightOffers.filter(offer => amadeusService.determineTier(offer) === 'budget')
                .map(offer => ({ price: parseFloat(offer.price.total) })),
            medium: flightOffers.filter(offer => amadeusService.determineTier(offer) === 'medium')
                .map(offer => ({ price: parseFloat(offer.price.total) })),
            premium: flightOffers.filter(offer => amadeusService.determineTier(offer) === 'premium')
                .map(offer => ({ price: parseFloat(offer.price.total) }))
        };
        // Transform flight offers into grouped format
        const groupedFlights = {
            budget: {
                min: tierAnalysis.budget.length > 0 ? Math.min(...tierAnalysis.budget.map(f => f.price)) : 0,
                max: tierAnalysis.budget.length > 0 ? Math.max(...tierAnalysis.budget.map(f => f.price)) : 0,
                average: tierAnalysis.budget.length > 0 ?
                    tierAnalysis.budget.reduce((sum, f) => sum + f.price, 0) / tierAnalysis.budget.length : 0,
                confidence: 0.8,
                source: 'amadeus',
                references: flightOffers
                    .filter(offer => amadeusService.determineTier(offer) === 'budget')
                    .map(offer => ({
                    id: offer.id,
                    airline: offer.validatingAirlineCodes[0],
                    cabinClass: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin,
                    price: {
                        amount: parseFloat(offer.price.total),
                        currency: offer.price.currency,
                        numberOfTravelers: numTravelers
                    },
                    details: {
                        outbound: offer.itineraries[0] ? {
                            duration: offer.itineraries[0].duration,
                            segments: offer.itineraries[0].segments.map(seg => ({
                                departure: {
                                    airport: seg.departure.iataCode,
                                    terminal: seg.departure.terminal,
                                    time: seg.departure.at
                                },
                                arrival: {
                                    airport: seg.arrival.iataCode,
                                    terminal: seg.arrival.terminal,
                                    time: seg.arrival.at
                                },
                                duration: seg.duration,
                                flightNumber: `${seg.carrierCode}${seg.number}`,
                                aircraft: {
                                    code: seg.aircraft.code
                                },
                                airline: {
                                    code: seg.carrierCode,
                                    name: offer.dictionaries?.carriers?.[seg.carrierCode] || seg.carrierCode
                                }
                            }))
                        } : undefined,
                        inbound: offer.itineraries[1] ? {
                            duration: offer.itineraries[1].duration,
                            segments: offer.itineraries[1].segments.map(seg => ({
                                departure: {
                                    airport: seg.departure.iataCode,
                                    terminal: seg.departure.terminal,
                                    time: seg.departure.at
                                },
                                arrival: {
                                    airport: seg.arrival.iataCode,
                                    terminal: seg.arrival.terminal,
                                    time: seg.arrival.at
                                },
                                duration: seg.duration,
                                flightNumber: `${seg.carrierCode}${seg.number}`,
                                aircraft: {
                                    code: seg.aircraft.code
                                },
                                airline: {
                                    code: seg.carrierCode,
                                    name: offer.dictionaries?.carriers?.[seg.carrierCode] || seg.carrierCode
                                }
                            }))
                        } : undefined
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
                references: flightOffers
                    .filter(offer => amadeusService.determineTier(offer) === 'medium')
                    .map(offer => ({
                    id: offer.id,
                    airline: offer.validatingAirlineCodes[0],
                    cabinClass: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin,
                    price: {
                        amount: parseFloat(offer.price.total),
                        currency: offer.price.currency,
                        numberOfTravelers: numTravelers
                    },
                    details: {
                        outbound: offer.itineraries[0] ? {
                            duration: offer.itineraries[0].duration,
                            segments: offer.itineraries[0].segments.map(seg => ({
                                departure: {
                                    airport: seg.departure.iataCode,
                                    terminal: seg.departure.terminal,
                                    time: seg.departure.at
                                },
                                arrival: {
                                    airport: seg.arrival.iataCode,
                                    terminal: seg.arrival.terminal,
                                    time: seg.arrival.at
                                },
                                duration: seg.duration,
                                flightNumber: `${seg.carrierCode}${seg.number}`,
                                aircraft: {
                                    code: seg.aircraft.code
                                },
                                airline: {
                                    code: seg.carrierCode,
                                    name: offer.dictionaries?.carriers?.[seg.carrierCode] || seg.carrierCode
                                }
                            }))
                        } : undefined,
                        inbound: offer.itineraries[1] ? {
                            duration: offer.itineraries[1].duration,
                            segments: offer.itineraries[1].segments.map(seg => ({
                                departure: {
                                    airport: seg.departure.iataCode,
                                    terminal: seg.departure.terminal,
                                    time: seg.departure.at
                                },
                                arrival: {
                                    airport: seg.arrival.iataCode,
                                    terminal: seg.arrival.terminal,
                                    time: seg.arrival.at
                                },
                                duration: seg.duration,
                                flightNumber: `${seg.carrierCode}${seg.number}`,
                                aircraft: {
                                    code: seg.aircraft.code
                                },
                                airline: {
                                    code: seg.carrierCode,
                                    name: offer.dictionaries?.carriers?.[seg.carrierCode] || seg.carrierCode
                                }
                            }))
                        } : undefined
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
                references: flightOffers
                    .filter(offer => amadeusService.determineTier(offer) === 'premium')
                    .map(offer => ({
                    id: offer.id,
                    airline: offer.validatingAirlineCodes[0],
                    cabinClass: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin,
                    price: {
                        amount: parseFloat(offer.price.total),
                        currency: offer.price.currency,
                        numberOfTravelers: numTravelers
                    },
                    details: {
                        outbound: offer.itineraries[0] ? {
                            duration: offer.itineraries[0].duration,
                            segments: offer.itineraries[0].segments.map(seg => ({
                                departure: {
                                    airport: seg.departure.iataCode,
                                    terminal: seg.departure.terminal,
                                    time: seg.departure.at
                                },
                                arrival: {
                                    airport: seg.arrival.iataCode,
                                    terminal: seg.arrival.terminal,
                                    time: seg.arrival.at
                                },
                                duration: seg.duration,
                                flightNumber: `${seg.carrierCode}${seg.number}`,
                                aircraft: {
                                    code: seg.aircraft.code
                                },
                                airline: {
                                    code: seg.carrierCode,
                                    name: offer.dictionaries?.carriers?.[seg.carrierCode] || seg.carrierCode
                                }
                            }))
                        } : undefined,
                        inbound: offer.itineraries[1] ? {
                            duration: offer.itineraries[1].duration,
                            segments: offer.itineraries[1].segments.map(seg => ({
                                departure: {
                                    airport: seg.departure.iataCode,
                                    terminal: seg.departure.terminal,
                                    time: seg.departure.at
                                },
                                arrival: {
                                    airport: seg.arrival.iataCode,
                                    terminal: seg.arrival.terminal,
                                    time: seg.arrival.at
                                },
                                duration: seg.duration,
                                flightNumber: `${seg.carrierCode}${seg.number}`,
                                aircraft: {
                                    code: seg.aircraft.code
                                },
                                airline: {
                                    code: seg.carrierCode,
                                    name: offer.dictionaries?.carriers?.[seg.carrierCode] || seg.carrierCode
                                }
                            }))
                        } : undefined
                    }
                }))
            }
        };
        return res.json({
            data: {
                flights: groupedFlights,
                requestDetails: {
                    origin,
                    destination,
                    outboundDate,
                    inboundDate,
                    travelers: numTravelers,
                    cabinClass: cabinClass?.toUpperCase() || 'ECONOMY'
                }
            }
        });
    }
    catch (error) {
        logger.error('Error searching flights:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
export default router;
