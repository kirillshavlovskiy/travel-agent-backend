import { Router, Request, Response } from 'express';
import { AmadeusService } from '../services/amadeus.js';
import { AmadeusFlightOffer, AmadeusItinerary, AmadeusSegment } from '../types/amadeus.js';
import { GroupedFlights } from '../types/flight.js';
import { logger } from '../utils/logger.js';

const router = Router();
const amadeusService = new AmadeusService();

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      origin,
      destination,
      outboundDate,
      inboundDate,
      travelers,
      cabinClass
    } = req.body;

    // Validate required fields
    const errors = [];
    if (!origin) errors.push('Origin is required');
    if (!destination) errors.push('Destination is required');
    if (!outboundDate) errors.push('Outbound date is required');
    if (!travelers) errors.push('Number of travelers is required');

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
    flightOffers.sort((a: AmadeusFlightOffer, b: AmadeusFlightOffer) => parseFloat(a.price.total) - parseFloat(b.price.total));

    // Calculate tier statistics
    const tierAnalysis = {
      budget: flightOffers.filter((offer: AmadeusFlightOffer) => amadeusService.determineTier(offer) === 'budget')
        .map((offer: AmadeusFlightOffer) => ({ price: parseFloat(offer.price.total) })),
      medium: flightOffers.filter((offer: AmadeusFlightOffer) => amadeusService.determineTier(offer) === 'medium')
        .map((offer: AmadeusFlightOffer) => ({ price: parseFloat(offer.price.total) })),
      premium: flightOffers.filter((offer: AmadeusFlightOffer) => amadeusService.determineTier(offer) === 'premium')
        .map((offer: AmadeusFlightOffer) => ({ price: parseFloat(offer.price.total) }))
    };

    // Transform flight offers into grouped format
    const groupedFlights: GroupedFlights = {
      budget: {
        min: tierAnalysis.budget.length > 0 ? Math.min(...tierAnalysis.budget.map((f: {price: number}) => f.price)) : 0,
        max: tierAnalysis.budget.length > 0 ? Math.max(...tierAnalysis.budget.map((f: {price: number}) => f.price)) : 0,
        average: tierAnalysis.budget.length > 0 ? 
          tierAnalysis.budget.reduce((sum: number, f: {price: number}) => sum + f.price, 0) / tierAnalysis.budget.length : 0,
        confidence: 0.8,
        source: 'amadeus',
        references: flightOffers
          .filter((offer: AmadeusFlightOffer) => amadeusService.determineTier(offer) === 'budget')
          .map((offer: AmadeusFlightOffer) => ({
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
                segments: offer.itineraries[0].segments.map((seg: AmadeusSegment) => ({
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
                segments: offer.itineraries[1].segments.map((seg: AmadeusSegment) => ({
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
        min: tierAnalysis.medium.length > 0 ? Math.min(...tierAnalysis.medium.map((f: {price: number}) => f.price)) : 0,
        max: tierAnalysis.medium.length > 0 ? Math.max(...tierAnalysis.medium.map((f: {price: number}) => f.price)) : 0,
        average: tierAnalysis.medium.length > 0 ? 
          tierAnalysis.medium.reduce((sum: number, f: {price: number}) => sum + f.price, 0) / tierAnalysis.medium.length : 0,
        confidence: 0.8,
        source: 'amadeus',
        references: flightOffers
          .filter((offer: AmadeusFlightOffer) => amadeusService.determineTier(offer) === 'medium')
          .map((offer: AmadeusFlightOffer) => ({
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
                segments: offer.itineraries[0].segments.map((seg: AmadeusSegment) => ({
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
                segments: offer.itineraries[1].segments.map((seg: AmadeusSegment) => ({
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
        min: tierAnalysis.premium.length > 0 ? Math.min(...tierAnalysis.premium.map((f: {price: number}) => f.price)) : 0,
        max: tierAnalysis.premium.length > 0 ? Math.max(...tierAnalysis.premium.map((f: {price: number}) => f.price)) : 0,
        average: tierAnalysis.premium.length > 0 ? 
          tierAnalysis.premium.reduce((sum: number, f: {price: number}) => sum + f.price, 0) / tierAnalysis.premium.length : 0,
        confidence: 0.8,
        source: 'amadeus',
        references: flightOffers
          .filter((offer: AmadeusFlightOffer) => amadeusService.determineTier(offer) === 'premium')
          .map((offer: AmadeusFlightOffer) => ({
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
                segments: offer.itineraries[0].segments.map((seg: AmadeusSegment) => ({
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
                segments: offer.itineraries[1].segments.map((seg: AmadeusSegment) => ({
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
  } catch (error) {
    logger.error('Error searching flights:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/fare-options', async (req: Request, res: Response) => {
  try {
    const { origin, destination, departureDate, returnDate, adults, flightNumber, carrierCode } = req.body;
    
    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: origin, destination, departureDate are required'
      });
    }

    logger.info('Fetching fare options for flight', {
      origin, 
      destination, 
      departureDate,
      returnDate,
      flightNumber,
      carrierCode
    });
    
    // Fetch flight offers with detailed fare options
    const flightOffers = await amadeusService.searchFlights({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      returnDate,
      adults: adults || 1,
      travelClass: 'ECONOMY', // Default to economy but could be parameterized
      currencyCode: 'USD',
      max: 5 // Limit to reduce response size
    });

    // Filter by flight number and carrier code if provided
    let filteredOffers = flightOffers;
    if (flightNumber && carrierCode) {
      filteredOffers = flightOffers.filter((offer: AmadeusFlightOffer) => {
        // Check outbound segments
        const outboundMatch = offer.itineraries[0]?.segments?.some((seg: AmadeusSegment) => 
          seg.carrierCode === carrierCode && seg.number === flightNumber
        );
        
        // Check inbound segments if any
        const inboundMatch = offer.itineraries[1]?.segments?.some((seg: AmadeusSegment) => 
          seg.carrierCode === carrierCode && seg.number === flightNumber
        );
        
        return outboundMatch || inboundMatch;
      });
    }

    // Format response to include detailed fare options
    const fareOptions = filteredOffers.map((offer: AmadeusFlightOffer) => {
      // Extract fare details
      const fareDetailsBySegment = offer.travelerPricings[0]?.fareDetailsBySegment || [];
      
      // Get unique branded fares
      const brandedFares = new Set<string>();
      fareDetailsBySegment.forEach(detail => {
        if (detail.brandedFare) {
          brandedFares.add(detail.brandedFare);
        } else if (detail.cabin) {
          brandedFares.add(detail.cabin);
        }
      });

      return {
        id: offer.id,
        price: {
          amount: parseFloat(offer.price.total),
          currency: offer.price.currency
        },
        fareType: Array.from(brandedFares)[0] || 'ECONOMY',
        cabin: fareDetailsBySegment[0]?.cabin || 'ECONOMY',
        fareDetailsBySegment: fareDetailsBySegment.map(detail => ({
          cabin: detail.cabin,
          class: detail.class,
          brandedFare: detail.brandedFare,
          fareBasis: detail.fareBasis,
          includedCheckedBags: detail.includedCheckedBags
        })),
        // Include basic flight info
        outbound: {
          departureTime: offer.itineraries[0]?.segments[0]?.departure?.at,
          arrivalTime: offer.itineraries[0]?.segments[offer.itineraries[0].segments.length - 1]?.arrival?.at,
          duration: offer.itineraries[0]?.duration
        },
        inbound: returnDate ? {
          departureTime: offer.itineraries[1]?.segments[0]?.departure?.at,
          arrivalTime: offer.itineraries[1]?.segments[offer.itineraries[1].segments.length - 1]?.arrival?.at,
          duration: offer.itineraries[1]?.duration
        } : undefined
      };
    });

    return res.json({
      success: true,
      data: {
        fareOptions,
        count: fareOptions.length
      }
    });

  } catch (error) {
    logger.error('Error fetching fare options', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch fare options',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Add route for confirming flight price
router.post('/confirm-price', async (req: Request, res: Response) => {
  const startTime = Date.now();
  // Generate a unique request ID for tracking
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  logger.info('[PERF] [confirm-price] Starting request processing', { requestId });
  
  try {
    const { flightOfferId, cabinClass, numberOfTravelers } = req.body;
    
    logger.info('[PERF] [confirm-price] Request parameters', { 
      flightOfferId, 
      cabinClass, 
      numberOfTravelers,
      requestId 
    });

    if (!flightOfferId) {
      logger.warn('[PERF] [confirm-price] Missing flightOfferId', { requestId });
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: flightOfferId'
      });
    }

    // Get the flight offer from cached results or search for it again
    logger.info('[PERF] [confirm-price] Retrieving flight offer', { requestId });
    const searchStartTime = Date.now();
    
    let flightOffers;
    try {
      // Try to find the flight using the segments from the request
      if (req.body.segments) {
        logger.info('[PERF] [confirm-price] Searching with segments', { 
          segments: req.body.segments,
          requestId 
        });
        flightOffers = await amadeusService.searchFlights({
          segments: req.body.segments
        });
      } else {
        // If no segments, try origin/destination + dates
        logger.info('[PERF] [confirm-price] Searching with origin/destination', { 
          origin: req.body.origin,
          destination: req.body.destination,
          requestId
        });
        flightOffers = await amadeusService.searchFlights({
          originLocationCode: req.body.origin,
          destinationLocationCode: req.body.destination,
          departureDate: req.body.departureDate,
          returnDate: req.body.returnDate,
          adults: numberOfTravelers || 1,
          travelClass: cabinClass
        });
      }
    } catch (error) {
      const searchDuration = Date.now() - searchStartTime;
      logger.error('[PERF] [confirm-price] Error searching flights', { 
        error, 
        duration: searchDuration,
        requestId 
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve flight offer',
        processingTime: Date.now() - startTime
      });
    }
    
    const searchDuration = Date.now() - searchStartTime;
    logger.info('[PERF] [confirm-price] Flight search completed', { 
      duration: searchDuration, 
      resultCount: flightOffers?.length || 0,
      requestId
    });

    // Find the specific flight offer
    const flightOffer = flightOffers.find((offer: any) => offer.id === flightOfferId);

    if (!flightOffer) {
      logger.warn('[PERF] [confirm-price] Flight offer not found', { 
        flightOfferId,
        resultCount: flightOffers?.length || 0,
        requestId
      });
      return res.status(404).json({
        success: false,
        error: 'Flight offer not found',
        processingTime: Date.now() - startTime
      });
    }

    // Confirm the price
    logger.info('[PERF] [confirm-price] Confirming price with Amadeus', { requestId });
    const pricingStartTime = Date.now();
    
    try {
      const priceConfirmation = await amadeusService.confirmFlightPrice(flightOffer);
      
      const pricingDuration = Date.now() - pricingStartTime;
      const totalDuration = Date.now() - startTime;
      
      logger.info('[PERF] [confirm-price] Price confirmation completed', { 
        duration: pricingDuration,
        totalDuration,
        requestId
      });

      return res.json({
        success: true,
        data: priceConfirmation.flightOffers,
        price: {
          amount: parseFloat(priceConfirmation.flightOffers[0].price.total),
          currency: priceConfirmation.flightOffers[0].price.currency
        },
        fareRules: priceConfirmation.flightOffers[0].pricingOptions,
        processingTime: totalDuration
      });
    } catch (error) {
      const pricingDuration = Date.now() - pricingStartTime;
      const totalDuration = Date.now() - startTime;
      
      logger.error('[PERF] [confirm-price] Error confirming price', { 
        error, 
        duration: pricingDuration,
        totalDuration,
        requestId
      });
      
      return res.status(500).json({
        success: false,
        error: 'Failed to confirm flight price',
        processingTime: totalDuration
      });
    }
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    logger.error('[PERF] [confirm-price] General error in confirm-price', { 
      error, 
      duration: totalDuration,
      requestId
    });
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      processingTime: totalDuration
    });
  }
});

// Add route for creating flight bookings
router.post('/book', async (req: Request, res: Response) => {
  try {
    const { flightOfferId, travelers, contacts, remarks, ticketingAgreement } = req.body;

    if (!flightOfferId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: flightOfferId'
      });
    }

    if (!travelers || !Array.isArray(travelers) || travelers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid travelers information'
      });
    }

    // Get the flight offer from the cached results or fetch it again
    const flightOffers = await amadeusService.searchFlights({
      segments: req.body.segments
    });

    const flightOffer = flightOffers.find((offer: any) => offer.id === flightOfferId);

    if (!flightOffer) {
      return res.status(404).json({
        success: false,
        error: 'Flight offer not found'
      });
    }

    // Confirm the price before booking
    const priceConfirmation = await amadeusService.confirmFlightPrice(flightOffer);
    
    if (!priceConfirmation.data || !priceConfirmation.data[0]) {
      return res.status(400).json({
        success: false,
        error: 'Could not confirm flight price. The offer may have expired.'
      });
    }

    // Use the confirmed flight offer for booking
    const confirmedFlightOffer = priceConfirmation.data[0];

    // Create the booking
    const bookingResult = await amadeusService.createFlightBooking({
      flightOffer: confirmedFlightOffer,
      travelers,
      contacts,
      remarks,
      ticketingAgreement
    });

    if (!bookingResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to create booking',
        details: bookingResult.errors
      });
    }

    // Return the booking information including PNR
    return res.json({
      success: true,
      booking: {
        pnr: bookingResult.id,
        associatedRecords: bookingResult.associatedRecords,
        flightDetails: {
          origin: confirmedFlightOffer.itineraries[0]?.segments[0]?.departure?.iataCode,
          destination: confirmedFlightOffer.itineraries[0]?.segments[confirmedFlightOffer.itineraries[0]?.segments.length - 1]?.arrival?.iataCode,
          departureDate: confirmedFlightOffer.itineraries[0]?.segments[0]?.departure?.at,
          returnDate: confirmedFlightOffer.itineraries[1]?.segments[0]?.departure?.at,
          carrierCode: confirmedFlightOffer.validatingAirlineCodes?.[0],
          price: {
            currency: confirmedFlightOffer.price.currency,
            total: confirmedFlightOffer.price.total
          }
        }
      }
    });
  } catch (error) {
    logger.error('Error creating flight booking:', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to create flight booking'
    });
  }
});

// Get booking details by reference
router.get('/booking/:pnr', async (req: Request, res: Response) => {
  try {
    const { pnr } = req.params;
    
    if (!pnr) {
      return res.status(400).json({
        success: false,
        error: 'Booking reference (PNR) is required'
      });
    }
    
    logger.info('Retrieving booking details', { pnr });
    
    // In a real implementation, you would call the Amadeus API to get booking details
    // As Amadeus test environment has restrictions, for demo purposes we'll 
    // create a simulated response based on the PNR
    
    // Check if PNR follows our format (BK + numbers)
    if (!/^[A-Z0-9]{8,}$/.test(pnr)) {
      return res.status(404).json({
        success: false,
        error: 'Invalid booking reference format'
      });
    }
    
    // For now, we'll simulate booking retrieval
    // In a production environment, you would use:
    // const bookingDetails = await amadeusService.getFlightBooking(pnr);
    
    return res.json({
      success: true,
      booking: {
        pnr,
        status: 'CONFIRMED',
        associatedRecords: [
          {
            reference: pnr.substring(0, 6),
            creationDate: new Date().toISOString(),
            originSystemCode: 'GDS',
            flightOfferId: '1'
          }
        ],
        flightDetails: {
          origin: 'Simulated origin',
          destination: 'Simulated destination',
          departureDate: new Date().toISOString(),
          carrierCode: 'XX',
          price: {
            currency: 'USD',
            total: '1000.00'
          }
        }
      }
    });
  } catch (error) {
    logger.error('Error retrieving booking details:', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve booking details'
    });
  }
});

// Add route for generating booking URLs
router.post('/booking-url', async (req: Request, res: Response) => {
  try {
    const { 
      flightId, 
      airline = '', 
      origin, 
      destination, 
      departureDate, 
      returnDate,
      cabinClass = 'ECONOMY',
      travelers = 1
    } = req.body;

    // Validate required parameters
    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: origin, destination, departureDate'
      });
    }

    // Create a simplified flight offer object with the necessary fields
    // Cast it to any to bypass type checking since we're only using specific properties
    const flightOffer: any = {
      id: flightId || `generated-${Date.now()}`,
      validatingAirlineCodes: [airline.substr(0, 2) || 'unknown'],
      itineraries: [
        {
          segments: [
            {
              departure: {
                iataCode: origin,
                at: typeof departureDate === 'string' ? departureDate : new Date(departureDate).toISOString()
              },
              arrival: {
                iataCode: destination
              }
            }
          ]
        }
      ],
      travelerPricings: [{
        fareDetailsBySegment: [{
          cabin: cabinClass,
          class: cabinClass.charAt(0)
        }]
      }]
    };

    // Generate the booking URL
    // The generateBookingUrl method only uses validatingAirlineCodes and itineraries properties
    const bookingUrl = amadeusService.generateBookingUrl(flightOffer);

    return res.json({
      success: true,
      bookingUrl,
      airline,
      origin,
      destination
    });
  } catch (error) {
    logger.error('Error generating booking URL:', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to generate booking URL'
    });
  }
});

// Add route for fetching seat map by flight offer
router.post('/seatmap', async (req: Request, res: Response) => {
  try {
    const { flightOffer } = req.body;
    if (!flightOffer || typeof flightOffer !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid flight offer in request body' });
    }

    logger.info('Fetching seat map for flight', {
      flightId: flightOffer.id,
      flightNumber: flightOffer.flightNumber,
      segments: flightOffer.itineraries?.[0]?.segments?.length || 0
    });

    const seatMap = await amadeusService.getSeatMap(flightOffer);
    
    if (!seatMap || !seatMap.segments || seatMap.segments.length === 0) {
      logger.warn('No seat map available for flight', {
        flightId: flightOffer.id,
        flightNumber: flightOffer.flightNumber
      });
      return res.status(404).json({ error: 'No seat map available for this flight' });
    }

    // Calculate total seats from all segments
    const totalSeats = seatMap.segments.reduce((acc, segment) => {
      return acc + (segment.deck?.seats?.length || 0);
    }, 0);

    logger.info('Successfully retrieved seat map', {
      flightId: flightOffer.id,
      segments: seatMap.segments.length,
      totalSeats: totalSeats
    });

    // Return the complete seatMap to the frontend
    return res.json(seatMap);
  } catch (error) {
    logger.error('Error fetching seat map', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({ 
      error: 'Failed to fetch seat map', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

export default router; 