import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus.js';
import { AirlineInfo } from '../types.js';
import { AmadeusSegment, AmadeusFare, AmadeusFareDetail, AmadeusFlightOffer } from '../types/amadeus.js';

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

// Helper function to get primary airport code for a city
function getPrimaryAirportForCity(cityCode: string): string {
  const cityAirports = airports.filter(airport => airport.cityCode === cityCode);
  if (cityAirports.length > 0) {
    // Return the first airport as primary (they are ordered by importance in the data)
    return cityAirports[0].value;
  }
  // If no mapping found, some airports use the same code as the city
  const directAirport = airports.find(airport => airport.value === cityCode);
  if (directAirport) {
    return directAirport.value;
  }
  console.warn(`[Budget Route] No airport found for city: ${cityCode}`);
  return cityCode; // Fallback to city code
}

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
      budget: req.body.budgetLimit ? parseFloat(String(req.body.budgetLimit)) : undefined,
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

    // Get origin airport code
    const originAirportCode = req.body.departureLocation.code;
    if (!airports.some(a => a.value === originAirportCode)) {
      console.error('[Budget Route] Invalid origin airport code:', originAirportCode);
      return res.status(400).json({
        success: false,
        error: 'Invalid origin airport code',
        timestamp: new Date().toISOString()
      });
    }

    // Get destination airport code
    const destinationCityCode = req.body.destinations[0].code;
    const destinationAirportCode = getPrimaryAirportForCity(destinationCityCode);

    console.log('[Budget Route] Using airport codes:', {
      origin: originAirportCode,
      destination: destinationAirportCode,
      originalDestination: destinationCityCode
    });

    // Process the request with the agent
    console.log('[Budget Route] Calling budget agent...');
    const result = await agent.handleTravelRequest(transformedRequest);

    // Search for real-time flights with Amadeus
    console.log('[Budget Route] Searching for real-time flights with Amadeus...');
    try {
      // Format dates as YYYY-MM-DD
      const formattedDepartureDate = transformedRequest.startDate.split('T')[0];
      const formattedReturnDate = transformedRequest.endDate.split('T')[0];

      console.log('[Budget Route] Using dates:', {
        raw: {
          startDate: transformedRequest.startDate,
          endDate: transformedRequest.endDate
        },
        formatted: {
          departure: formattedDepartureDate,
          return: formattedReturnDate
        }
      });

      const flights = await amadeusService.searchFlights({
        originLocationCode: originAirportCode,
        destinationLocationCode: destinationAirportCode,
        departureDate: formattedDepartureDate,
        returnDate: formattedReturnDate,
        adults: transformedRequest.travelers,
        travelClass: 'ECONOMY'
      });

      // Transform Amadeus flights and add them to the result
      if (flights && flights.length > 0) {
        console.log('[Budget Route] Found', flights.length, 'Amadeus flights');
        
        // Transform and categorize flights
        const transformedFlights = await Promise.all(
          flights.map(async (offer) => {
            try {
              const firstSegment = offer.itineraries[0].segments[0];
              const lastOutboundSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
              const inboundSegments = offer.itineraries[1]?.segments || [];
              const firstInboundSegment = inboundSegments[0];
              const lastInboundSegment = inboundSegments[inboundSegments.length - 1];
              const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;

              // Try to get airline info, but don't fail if it's not available
              let airlineInfo: AirlineInfo;
              try {
                // First try to get airline info for the actual carrier
                const carrierInfo = offer.dictionaries?.carriers?.[firstSegment.carrierCode];
                if (typeof carrierInfo === 'string') {
                  airlineInfo = { commonName: carrierInfo };
                } else if (carrierInfo && typeof carrierInfo === 'object') {
                  airlineInfo = carrierInfo as AirlineInfo;
                } else {
                  // Fallback to validating airline if carrier info not found
                  const airlineInfoArray = await amadeusService.getAirlineInfo(offer.validatingAirlineCodes[0]);
                  airlineInfo = airlineInfoArray[0] || { commonName: firstSegment.carrierCode };
                }
              } catch (error) {
                console.warn('[Budget Route] Error fetching airline info:', error);
                // Use the carrier code as fallback
                airlineInfo = { commonName: firstSegment.carrierCode };
              }

              // Create a consistent flight data structure
              const flightData = {
                // Basic flight info for table view
                airline: airlineInfo.commonName || firstSegment.carrierCode,
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
                    segments: offer.itineraries[0].segments.map((segment: AmadeusSegment) => ({
                      airline: segment.carrierCode,
                      flightNumber: `${segment.carrierCode}${segment.number}`,
                      aircraft: {
                        code: segment.aircraft.code,
                        name: offer.dictionaries?.aircraft?.[segment.aircraft.code] || segment.aircraft.code
                      },
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
                      cabinClass: offer.travelerPricings[0].fareDetailsBySegment.find(
                        (fare: AmadeusFare) => fare.segmentId === segment.id
                      )?.cabin || cabinClass
                    }))
                  }
                }
              };
              
              return flightData;
            } catch (error) {
              console.warn('[Budget Route] Error transforming flight offer:', error);
              return null;
            }
          })
        ).then(flights => flights.filter(flight => flight !== null));

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

        // Only use Perplexity results if Amadeus search fails for a tier
        result.flights = {
          budget: groupedFlights.budget || result.flights?.budget,
          medium: groupedFlights.medium || result.flights?.medium,
          premium: groupedFlights.premium || result.flights?.premium
        };
      }
    } catch (error) {
      console.error('[Budget Route] Error searching flights:', error);
      // Continue with the request even if flight search fails
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
      data: {
        ...result,
        totalBudget: transformedRequest.budget,
        requestDetails: transformedRequest
      },
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