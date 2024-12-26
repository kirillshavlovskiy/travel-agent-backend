import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus.js';

const router = Router();
const agent = new VacationBudgetAgent();
const prisma = new PrismaClient();
const amadeusService = new AmadeusService();

interface Destination {
  code: string;
  label: string;
  airport: string;
}

interface TransformedRequest {
  type: string;
  departureLocation: {
    code: string;
    label: string;
    airport: string;
    outboundDate: string;
    inboundDate: string;
    isRoundTrip: boolean;
  };
  destinations: Destination[];
  country: string;
  travelers: number;
  currency: string;
  budget?: number;
  startDate: string;
  endDate: string;
}

// Get available cities and airports
router.get('/locations', (req: Request, res: Response) => {
  try {
    console.log('[Budget Route] Fetching available locations');
    res.json({
      success: true,
      data: {
        cities: cities.map(city => ({
          value: city.value,
          label: city.label
        })),
        airports: airports.map(airport => ({
          value: airport.value,
          label: airport.label
        }))
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Budget Route] Error fetching locations:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

// Calculate budget endpoint
router.post('/calculate-budget', async (req: Request, res: Response) => {
  try {
    console.log('[Budget Route] ====== START BUDGET CALCULATION ======');
    console.log('[Budget Route] Received request:', {
      body: JSON.stringify(req.body, null, 2),
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        origin: req.headers.origin,
        host: req.headers.host,
        referer: req.headers.referer
      },
      url: req.url,
      method: req.method
    });

    // Validate required fields
    const missingFields = [];
    if (!req.body.departureLocation?.code) missingFields.push('departure location code');
    if (!req.body.departureLocation?.label) missingFields.push('departure location label');
    if (!Array.isArray(req.body.destinations) || req.body.destinations.length === 0) missingFields.push('destinations');
    if (!req.body.startDate) missingFields.push('start date');
    if (!req.body.endDate) missingFields.push('end date');
    if (!req.body.travelers) missingFields.push('number of travelers');

    if (missingFields.length > 0) {
      console.error('[Budget Route] Missing fields:', {
        missingFields,
        receivedFields: {
          departureLocation: req.body.departureLocation,
          startDate: req.body.startDate,
          endDate: req.body.endDate,
          destinations: req.body.destinations,
          travelers: req.body.travelers
        }
      });
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    // Ensure proper data types
    const travelers = parseInt(String(req.body.travelers));
    if (isNaN(travelers)) {
      console.error('[Budget Route] Invalid travelers value:', req.body.travelers);
      return res.status(400).json({
        success: false,
        error: 'Invalid travelers value: must be a number',
        timestamp: new Date().toISOString()
      });
    }

    // Get destination city details
    const destinationCity = cities.find(c => c.value === req.body.destinations[0].code);
    if (!destinationCity) {
      console.error('[Budget Route] Invalid destination city:', {
        receivedCity: req.body.destinations[0],
        availableCities: cities.map(c => ({ value: c.value, label: c.label }))
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid destination city',
        timestamp: new Date().toISOString()
      });
    }

    // Transform the request to match our internal format
    const transformedRequest: TransformedRequest = {
      type: req.body.type || 'full',
      departureLocation: {
        code: String(req.body.departureLocation.code),
        label: String(req.body.departureLocation.label),
        airport: req.body.departureLocation.airport || req.body.departureLocation.code,
        outboundDate: String(req.body.startDate),
        inboundDate: String(req.body.endDate),
        isRoundTrip: true
      },
      destinations: req.body.destinations.map((dest: { code: string; label: string }) => {
        const city = cities.find(c => c.value === dest.code);
        if (!city) {
          console.warn('[Budget Route] City not found in database:', dest);
        }
        return {
          code: city?.value || dest.code,
          label: city?.label || dest.label,
          airport: city?.value || dest.code
        };
      }),
      country: destinationCity.value,
      travelers: travelers,
      currency: String(req.body.currency || 'USD'),
      budget: req.body.budgetLimit ? parseInt(String(req.body.budgetLimit)) : undefined,
      startDate: String(req.body.startDate),
      endDate: String(req.body.endDate)
    };

    console.log('[Budget Route] Transformed request:', {
      request: JSON.stringify(transformedRequest, null, 2),
      dataTypes: {
        type: typeof transformedRequest.type,
        departureLocation: {
          code: typeof transformedRequest.departureLocation.code,
          label: typeof transformedRequest.departureLocation.label,
          airport: typeof transformedRequest.departureLocation.airport,
          outboundDate: typeof transformedRequest.departureLocation.outboundDate,
          inboundDate: typeof transformedRequest.departureLocation.inboundDate
        },
        destinations: transformedRequest.destinations.map(d => ({
          code: typeof d.code,
          label: typeof d.label,
          airport: typeof d.airport
        })),
        travelers: typeof transformedRequest.travelers,
        currency: typeof transformedRequest.currency,
        budget: typeof transformedRequest.budget,
        startDate: typeof transformedRequest.startDate,
        endDate: typeof transformedRequest.endDate
      }
    });

    // Process the request with the agent
    console.log('[Budget Route] Calling budget agent...');
    const result = await agent.handleTravelRequest(transformedRequest);

    // Search for real-time flights with Amadeus
    console.log('[Budget Route] Searching for real-time flights with Amadeus...');
    try {
      // Search for flights in all cabin classes
      const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
      const allFlights = await Promise.all(
        cabinClasses.map(async (travelClass) => {
          try {
            return await amadeusService.searchFlights({
              originLocationCode: transformedRequest.departureLocation.code,
              destinationLocationCode: transformedRequest.destinations[0].code,
              departureDate: transformedRequest.startDate,
              returnDate: transformedRequest.endDate,
              adults: transformedRequest.travelers,
              travelClass
            });
          } catch (error) {
            console.warn(`[Budget Route] Error searching ${travelClass} flights:`, error);
            return [];
          }
        })
      );

      // Combine all flights
      const amadeusFlights = allFlights.flat();

      // Transform Amadeus flights and add them to the result
      if (amadeusFlights && amadeusFlights.length > 0) {
        console.log('[Budget Route] Found', amadeusFlights.length, 'Amadeus flights');
        
        // Transform and categorize flights
        const transformedFlights = await Promise.all(
          amadeusFlights.map(async (offer) => {
            try {
              const firstSegment = offer.itineraries[0].segments[0];
              const lastOutboundSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
              const inboundSegments = offer.itineraries[1]?.segments || [];
              const firstInboundSegment = inboundSegments[0];
              const lastInboundSegment = inboundSegments[inboundSegments.length - 1];
              const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;

              // Try to get airline info, but don't fail if it's not available
              let airlineInfo;
              try {
                airlineInfo = await amadeusService.getAirlineInfo(offer.validatingAirlineCodes[0]);
              } catch (error) {
                console.warn('[Budget Route] Error fetching airline info:', error);
              }

              // Create a consistent flight data structure
              const flightData = {
                // Basic flight info for table view
                airline: airlineInfo?.commonName || airlineInfo?.businessName || offer.validatingAirlineCodes[0],
                route: `${firstSegment.departure.iataCode} - ${lastOutboundSegment.arrival.iataCode}`,
                duration: amadeusService.calculateTotalDuration(offer.itineraries[0].segments),
                layovers: offer.itineraries[0].segments.length - 1,
                outbound: firstSegment.departure.at,
                inbound: lastInboundSegment?.arrival.at || lastOutboundSegment.arrival.at,
                price: parseFloat(offer.price.total),
                tier: amadeusService.determineTier(parseFloat(offer.price.total), cabinClass),
                flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
                referenceUrl: amadeusService.generateBookingUrl(offer),
                cabinClass,

                // Detailed flight info for modal view
                details: {
                  price: {
                    amount: parseFloat(offer.price.total),
                    currency: offer.price.currency
                  },
                  outbound: {
                    departure: {
                      airport: firstSegment.departure.iataCode,
                      terminal: firstSegment.departure.terminal,
                      time: firstSegment.departure.at
                    },
                    arrival: {
                      airport: lastOutboundSegment.arrival.iataCode,
                      terminal: lastOutboundSegment.arrival.terminal,
                      time: lastOutboundSegment.arrival.at
                    },
                    duration: amadeusService.calculateTotalDuration(offer.itineraries[0].segments),
                    stops: offer.itineraries[0].segments.length - 1,
                    segments: offer.itineraries[0].segments.map(segment => ({
                      airline: {
                        code: segment.carrierCode,
                        name: airlineInfo?.commonName || airlineInfo?.businessName || segment.carrierCode
                      },
                      flightNumber: `${segment.carrierCode}${segment.number}`,
                      departure: {
                        airport: segment.departure.iataCode,
                        terminal: segment.departure.terminal,
                        time: segment.departure.at
                      },
                      arrival: {
                        airport: segment.arrival.iataCode,
                        terminal: segment.arrival.terminal,
                        time: segment.arrival.at
                      },
                      duration: segment.duration,
                      cabinClass
                    }))
                  },
                  inbound: inboundSegments.length > 0 ? {
                    departure: {
                      airport: firstInboundSegment.departure.iataCode,
                      terminal: firstInboundSegment.departure.terminal,
                      time: firstInboundSegment.departure.at
                    },
                    arrival: {
                      airport: lastInboundSegment.arrival.iataCode,
                      terminal: lastInboundSegment.arrival.terminal,
                      time: lastInboundSegment.arrival.at
                    },
                    duration: amadeusService.calculateTotalDuration(inboundSegments),
                    stops: inboundSegments.length - 1,
                    segments: inboundSegments.map(segment => ({
                      airline: {
                        code: segment.carrierCode,
                        name: airlineInfo?.commonName || airlineInfo?.businessName || segment.carrierCode
                      },
                      flightNumber: `${segment.carrierCode}${segment.number}`,
                      departure: {
                        airport: segment.departure.iataCode,
                        terminal: segment.departure.terminal,
                        time: segment.departure.at
                      },
                      arrival: {
                        airport: segment.arrival.iataCode,
                        terminal: segment.arrival.terminal,
                        time: segment.arrival.at
                      },
                      duration: segment.duration,
                      cabinClass
                    }))
                  } : null,
                  cabinClass,
                  bookingClass: offer.travelerPricings[0].fareDetailsBySegment[0].class
                }
              };
              
              return flightData;
            } catch (error) {
              console.warn('[Budget Route] Error transforming flight offer:', error);
              // Return a simplified version if transformation fails
              const firstSegment = offer.itineraries[0].segments[0];
              const lastOutboundSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
              const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;
              return {
                airline: offer.validatingAirlineCodes[0],
                route: `${firstSegment.departure.iataCode} - ${lastOutboundSegment.arrival.iataCode}`,
                duration: '(duration not available)',
                layovers: offer.itineraries[0].segments.length - 1,
                outbound: firstSegment.departure.at,
                inbound: lastOutboundSegment.arrival.at,
                price: parseFloat(offer.price.total),
                tier: amadeusService.determineTier(parseFloat(offer.price.total), cabinClass),
                flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
                referenceUrl: '#',
                cabinClass,
                details: null
              };
            }
          })
        );

        // Group flights by tier
        const groupedFlights = transformedFlights.reduce((acc, flight) => {
          if (!acc[flight.tier]) {
            acc[flight.tier] = {
              min: Infinity,
              max: -Infinity,
              average: 0,
              confidence: 0.9,
              source: 'Amadeus API',
              references: []
            };
          }
          
          acc[flight.tier].references.push(flight);
          acc[flight.tier].min = Math.min(acc[flight.tier].min, flight.price);
          acc[flight.tier].max = Math.max(acc[flight.tier].max, flight.price);
          
          return acc;
        }, {} as any);

        // Calculate averages
        Object.keys(groupedFlights).forEach(tier => {
          const flights = groupedFlights[tier].references;
          groupedFlights[tier].average = flights.reduce((sum: number, f: any) => sum + f.price, 0) / flights.length;
        });

        // Merge with existing flight data
        result.flights = {
          ...result.flights,
          ...groupedFlights
        };
      }
    } catch (error) {
      console.warn('[Budget Route] Error fetching Amadeus flights:', error);
      // Continue with the existing flight estimates if Amadeus search fails
    }

    console.log('[Budget Route] Agent response:', {
      success: true,
      hasFlights: !!result.flights,
      hasHotels: !!result.hotels,
      timestamp: new Date().toISOString()
    });

    console.log('[Budget Route] ====== END BUDGET CALCULATION ======');
    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Budget Route] Error processing budget calculation:', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      timestamp: new Date().toISOString()
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 