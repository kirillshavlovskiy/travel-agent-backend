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
  // Set a timeout for the entire request
  const ROUTE_TIMEOUT = 45000; // 45 seconds
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), ROUTE_TIMEOUT)
  );

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
      }
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
      console.error('[Budget Route] Missing fields:', missingFields);
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    // Transform the request
    const transformedRequest = await transformRequest(req.body);

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

    // Search for real-time flights with Amadeus
    console.log('[Budget Route] Searching for real-time flights with Amadeus...');
    const flights = await amadeusService.searchFlights({
      originLocationCode: originAirportCode,
      destinationLocationCode: destinationAirportCode,
      departureDate: formattedDepartureDate,
      returnDate: formattedReturnDate,
      adults: transformedRequest.travelers,
      travelClass: 'ECONOMY'
    });

    let result: Record<string, any> = {
      flights: {
        budget: {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.9,
          source: 'Amadeus API',
          references: []
        },
        medium: {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.9,
          source: 'Amadeus API',
          references: []
        },
        premium: {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.9,
          source: 'Amadeus API',
          references: []
        }
      }
    };

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

            const price = parseFloat(offer.price.total);
            const tier = amadeusService.determineTier(price, cabinClass);

            // Create a consistent flight data structure
            const flightData = {
              airline: airlineInfo.commonName || firstSegment.carrierCode,
              route: `${firstSegment.departure.iataCode} to ${lastOutboundSegment.arrival.iataCode}`,
              duration: amadeusService.calculateTotalDuration(offer.itineraries[0].segments),
              layovers: offer.itineraries[0].segments.length - 1,
              outbound: firstSegment.departure.at,
              inbound: lastInboundSegment?.arrival.at || lastOutboundSegment.arrival.at,
              price,
              tier,
              flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
              referenceUrl: amadeusService.generateBookingUrl(offer)
            };

            // Update tier statistics
            result.flights[tier].references.push(flightData);
            result.flights[tier].min = Math.min(result.flights[tier].min, price);
            result.flights[tier].max = Math.max(result.flights[tier].max, price);

            return flightData;
          } catch (error) {
            console.warn('[Budget Route] Error transforming flight offer:', error);
            return null;
          }
        })
      ).then(flights => flights.filter(flight => flight !== null));

      // Calculate averages for each tier
      ['budget', 'medium', 'premium'].forEach(tier => {
        const tierFlights = result.flights[tier].references;
        if (tierFlights.length > 0) {
          result.flights[tier].average = tierFlights.reduce((sum: number, f: any) => sum + f.price, 0) / tierFlights.length;
        }
      });
    }

    // Get default data for other categories from the agent
    const agentResponse = await Promise.race([
      agent.handleTravelRequest(transformedRequest),
      timeoutPromise
    ]) as Record<string, any>;

    // Combine Amadeus flight data with agent's response for other categories
    const responseData = {
      success: true,
      data: {
        flights: result.flights,
        hotels: agentResponse.hotels,
        localTransportation: agentResponse.localTransportation,
        food: agentResponse.food,
        activities: agentResponse.activities,
        totalBudget: transformedRequest.budget,
        requestDetails: transformedRequest
      },
      timestamp: new Date().toISOString()
    };

    console.log('[Budget Route] ====== END BUDGET CALCULATION ======');
    return res.json(responseData);
  } catch (error) {
    console.error('[Budget Route] Error processing budget calculation:', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      timestamp: new Date().toISOString()
    });

    // Handle timeout specifically
    if (error instanceof Error && error.message === 'Request timeout') {
      return res.status(504).json({
        success: false,
        error: 'The request took too long to process. Please try again.',
        timestamp: new Date().toISOString()
      });
    }

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to transform the request
async function transformRequest(body: any): Promise<TransformedRequest> {
  const destinationCity = cities.find(c => c.value === body.destinations[0].code);
  if (!destinationCity) {
    throw new Error('Invalid destination city');
  }

  return {
    type: body.type || 'full',
    departureLocation: {
      code: String(body.departureLocation.code),
      label: String(body.departureLocation.label),
      airport: body.departureLocation.airport || body.departureLocation.code,
      outboundDate: String(body.startDate),
      inboundDate: String(body.endDate),
      isRoundTrip: true
    },
    destinations: body.destinations.map((dest: { code: string; label: string }) => {
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
    travelers: parseInt(String(body.travelers)),
    currency: String(body.currency || 'USD'),
    budget: body.budgetLimit ? parseFloat(String(body.budgetLimit)) : undefined,
    startDate: String(body.startDate),
    endDate: String(body.endDate)
  };
}

export default router; 