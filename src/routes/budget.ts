import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus.js';
import { AirlineInfo } from '../types.js';
import { AmadeusSegment, AmadeusFare, AmadeusFareDetail, AmadeusFlightOffer } from '../types/amadeus.js';
import { AIRCRAFT_CODES as AIRCRAFT_CODE_MAP } from '../constants/aircraft.js';
import { normalizeCategory } from '../constants/categories.js';

const router = Router();
const amadeusService = new AmadeusService();
const agent = new VacationBudgetAgent(amadeusService);
const prisma = new PrismaClient();

// Import AIRCRAFT_CODES from amadeus service
const AIRCRAFT_CODES: { [key: string]: string } = {
  '319': 'Airbus A319',
  '320': 'Airbus A320',
  '321': 'Airbus A321',
  '32A': 'Airbus A320',
  '32B': 'Airbus A321',
  '32Q': 'Airbus A321neo',
  '32S': 'Airbus A321',
  '32N': 'Airbus A321neo',
  '333': 'Airbus A330-300',
  '359': 'Airbus A350-900',
  '388': 'Airbus A380-800',
  '738': 'Boeing 737-800',
  '73H': 'Boeing 737-800',
  '744': 'Boeing 747-400',
  '767': 'Boeing 767',
  '777': 'Boeing 777',
  '772': 'Boeing 777-200',
  '77W': 'Boeing 777-300ER',
  '787': 'Boeing 787 Dreamliner',
  '788': 'Boeing 787-8 Dreamliner',
  '789': 'Boeing 787-9 Dreamliner',
  'E90': 'Embraer E190',
  'E95': 'Embraer E195',
  'CR9': 'Bombardier CRJ-900',
  'CRJ': 'Bombardier CRJ',
  'DH4': 'Bombardier Q400',
  'AT7': 'ATR 72',
  'AT5': 'ATR 42',
  'E75': 'Embraer E175',
  'E70': 'Embraer E170',
  'A20N': 'Airbus A320neo',
  'A21N': 'Airbus A321neo',
  'B38M': 'Boeing 737 MAX 8',
  'B39M': 'Boeing 737 MAX 9',
  'A339': 'Airbus A330-900neo',
  'A359': 'Airbus A350-900',
  'A35K': 'Airbus A350-1000',
  'B78X': 'Boeing 787-10 Dreamliner',
  '7M9': 'Boeing 737 MAX 9'
};

interface FlightSegment {
  airline: string;
  flightNumber: string;
  aircraft: {
    code: string;
    name: string;
  };
  departure: {
    airport: string;
    terminal?: string;
    time: string;
  };
  arrival: {
    airport: string;
    terminal?: string;
    time: string;
  };
  duration: string;
  cabinClass: string;
}

interface FlightDetails {
  airline: string;
  route: string;
  duration: string;
  layovers: number;
  outbound: string;
  inbound: string;
  price: {
    amount: number;
    currency: string;
    numberOfTravelers: number;
  };
  tier: 'budget' | 'medium' | 'premium';
  flightNumber: string;
  referenceUrl: string;
  cabinClass: string;
  details: {
    price: {
      amount: number;
      currency: string;
      numberOfTravelers: number;
    };
    outbound: {
      departure: {
        airport: string;
        terminal?: string;
        time: string;
      };
      arrival: {
        airport: string;
        terminal?: string;
        time: string;
      };
      duration: string;
      segments: FlightSegment[];
    };
    inbound?: {
      departure: {
        airport: string;
        terminal?: string;
        time: string;
      };
      arrival: {
        airport: string;
        terminal?: string;
        time: string;
      };
      duration: string;
      segments: FlightSegment[];
    };
  };
}

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
  flightData?: AmadeusFlightOffer[];
  days: number;
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
router.post('/calculate', async (req: Request, res: Response) => {
  // Increase timeout for the entire request
  const TIMEOUT = 600000; // 10 minutes to account for multiple flight searches
  const SEARCH_TIMEOUT = 120000; // 2 minutes per search
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), TIMEOUT);
  });

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
    try {
      const locations = await amadeusService.searchLocations(req.body.destinations[0].code);
      if (!locations || locations.length === 0) {
      console.error('[Budget Route] Invalid destination city:', {
          receivedCity: req.body.destinations[0]
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid destination city',
        timestamp: new Date().toISOString()
      });
    }

      // Use the first matching location
      const destinationCity = {
        value: locations[0].iataCode,
        label: `${locations[0].address.cityName}, ${locations[0].address.countryName}`
      };

    // Get origin airport code
      const originLocations = await amadeusService.searchLocations(req.body.departureLocation.code);
      if (!originLocations || originLocations.length === 0) {
        console.error('[Budget Route] Invalid origin location:', {
          receivedLocation: req.body.departureLocation
        });
        return res.status(400).json({
          success: false,
          error: 'Invalid origin location',
          timestamp: new Date().toISOString()
        });
      }

      // Use the first matching location's IATA code
      const originAirportCode = originLocations[0].iataCode;

      // Get destination airport code - we already have it from the location search above
      const destinationAirportCode = locations[0].iataCode;

    // Race between the actual work and the timeout
    const result = await Promise.race([
      (async () => {
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
      endDate: String(req.body.endDate),
      days: Math.ceil((new Date(req.body.endDate).getTime() - new Date(req.body.startDate).getTime()) / (1000 * 60 * 60 * 24))
    };

        // Initialize agentResult
        let agentResult: any = {
          flights: {
            budget: {
              min: 0,
              max: 0,
              average: 0,
              confidence: 0,
              source: 'Amadeus API',
              references: []
            },
            medium: {
              min: 0,
              max: 0,
              average: 0,
              confidence: 0,
              source: 'Amadeus API',
              references: []
            },
            premium: {
              min: 0,
              max: 0,
              average: 0,
              confidence: 0,
              source: 'Amadeus API',
              references: []
            }
          },
          activities: {
            budget: {
              min: 0,
              max: 0,
              average: 0,
              confidence: 0,
              source: 'Activities API',
              references: []
            },
            medium: {
              min: 0,
              max: 0,
              average: 0,
              confidence: 0,
              source: 'Activities API',
              references: []
            },
            premium: {
              min: 0,
              max: 0,
              average: 0,
              confidence: 0,
              source: 'Activities API',
              references: []
            }
          }
        };

        // First search for real-time flights with Amadeus
        console.log('[Budget Route] Searching for real-time flights with Amadeus...');
        try {
          const formattedDepartureDate = transformedRequest.startDate.split('T')[0];
          const formattedReturnDate = transformedRequest.endDate.split('T')[0];

          // Search for flights in all cabin classes with individual timeouts
          const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
          const searchPromises = cabinClasses.map(async cabinClass => {
            try {
              const searchPromise = amadeusService.searchFlights({
                segments: [{
                  originLocationCode: originAirportCode,
                  destinationLocationCode: destinationAirportCode,
                  departureDate: formattedDepartureDate
                }, {
                  originLocationCode: destinationAirportCode,
                  destinationLocationCode: originAirportCode,
                  departureDate: formattedReturnDate
                }],
                adults: transformedRequest.travelers,
                travelClass: cabinClass
              });

              // Add timeout to individual search
              const result = await Promise.race([
                searchPromise,
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error(`Search timeout for ${cabinClass}`)), SEARCH_TIMEOUT)
                )
              ]);

              return result;
            } catch (error) {
              console.warn(`[Budget Route] Search failed for ${cabinClass}:`, error);
              return [];
            }
          });

          // Wait for all searches to complete
          const allFlights = (await Promise.all(searchPromises)).flat();

          if (allFlights.length === 0) {
            console.warn('[Budget Route] No flights found for any cabin class');
          } else {
            console.log('[Budget Route] Flight search results:', {
              totalFlights: allFlights.length,
              byClass: {
                economy: allFlights.filter((f: AmadeusFlightOffer) => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'ECONOMY').length,
                premiumEconomy: allFlights.filter((f: AmadeusFlightOffer) => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'PREMIUM_ECONOMY').length,
                business: allFlights.filter((f: AmadeusFlightOffer) => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'BUSINESS').length,
                first: allFlights.filter((f: AmadeusFlightOffer) => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'FIRST').length
              }
            });

            // Add flight data to the transformed request
            transformedRequest.flightData = allFlights;
          }

          // Call VacationBudgetAgent with flight data
          console.log('[Budget Route] Calling VacationBudgetAgent with flight data...');
          agentResult = await agent.handleTravelRequest({
            ...transformedRequest,
            preferences: req.body.preferences,
            budgetLimit: req.body.budgetLimit
          });

          // Log the agent result
          console.log('[Budget Route] VacationBudgetAgent result:', {
            hasFlights: !!agentResult.flights,
            hasActivities: !!agentResult.activities,
            flightTiers: Object.keys(agentResult.flights || {}),
            activityTiers: Object.keys(agentResult.activities || {})
          });

        } catch (error) {
          console.error('[Budget Route] Error searching flights:', error);
          // If flight search fails, call agent without flight data
          console.log('[Budget Route] Calling budget agent without flight data...');
          agentResult = await agent.handleTravelRequest({
            ...transformedRequest,
            preferences: req.body.preferences,
            budgetLimit: req.body.budgetLimit
          });
        }

        return {
          ...(agentResult || {}),
          totalBudget: transformedRequest.budget,
          requestDetails: transformedRequest
        };
      })(),
      timeoutPromise
    ]);

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

      // Handle timeout specifically
      if (error instanceof Error && error.message === 'Request timeout') {
        return res.status(504).json({
          success: false,
          error: 'Request timed out. Please try again with a shorter date range or fewer destinations.',
          timestamp: new Date().toISOString()
        });
      }

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: unknown) {
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
        error: 'Request timed out. Please try again with a shorter date range or fewer destinations.',
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

router.post('/generate-activity', async (req: Request, res: Response) => {
  try {
    const {
      destination,
      dayNumber,
      timeSlot,
      tier,
      category,
      duration,
      userPreferences,
      existingActivities = [],
      flightTimes = {},
      currency = 'USD'
    } = req.body;

    console.log('[Budget API] Received activity generation request:', {
      destination,
      dayNumber,
      timeSlot,
      tier,
      category,
      duration,
      userPreferences,
      hasExistingActivities: !!existingActivities?.length,
      flightTimes
    });

    if (!destination || !dayNumber || !timeSlot || !tier) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const mappedCategory = normalizeCategory(category || '');

    console.log('[Budget API] Calling VacationBudgetAgent to generate activity with mapped category:', {
      originalCategory: category,
      mappedCategory
    });

    const activity = await agent.generateSingleActivity({
      destination,
      dayNumber,
      timeOfDay: timeSlot,
      budget: tier,
      category: mappedCategory,
      userPreferences,
      existingActivities,
      flightTimes,
      currency
    });

    console.log('[Budget API] Successfully generated activity:', {
      activityId: activity.id,
      name: activity.name,
      timeSlot: activity.timeSlot,
      dayNumber: activity.dayNumber,
      tier: activity.tier,
      category: activity.category,
      duration: activity.duration
    });

    res.json({
      success: true,
      activity: activity
    });
  } catch (error) {
    console.error('[Budget API] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activity',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 