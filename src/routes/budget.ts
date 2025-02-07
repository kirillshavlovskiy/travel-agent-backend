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
import { API_CONFIG } from '../config/api.js';
import { logger } from '../utils/logger.js';

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

interface BudgetCalculationParams {
  departureLocation: {
    code: string;
    label: string;
  };
  destinations: Array<{
    code: string;
    label: string;
  }>;
  startDate: string;
  endDate: string;
  travelers: number;
  budgetLimit: number;
  preferences?: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  };
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
              return []; // Return empty array for failed searches
            }
          });

          // Wait for all searches to complete and process results
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
          }

      if (allFlights && allFlights.length > 0) {
        console.log('[Budget Route] Found', allFlights.length, 'Amadeus flights');
            console.log('[Budget Route] Sample raw flight data:', {
              firstFlight: allFlights[0],
              dictionaries: allFlights[0]?.dictionaries
            });
        
        // Transform and categorize flights
        const transformedFlights = await Promise.all(
          allFlights.map(async (offer: AmadeusFlightOffer) => {
            try {
              const firstSegment = offer.itineraries[0].segments[0];
              const lastOutboundSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
              const inboundSegments = offer.itineraries[1]?.segments || [];
              const lastInboundSegment = inboundSegments[inboundSegments.length - 1];
              const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;

                  console.log('[Budget Route] Processing flight offer:', {
                    price: offer.price,
                    segments: {
                      outbound: offer.itineraries[0].segments.map((segment) => ({
                        departure: segment.departure,
                        arrival: segment.arrival,
                        aircraft: segment.aircraft,
                        duration: segment.duration,
                        carrierCode: segment.carrierCode,
                        number: segment.number
                      })),
                      inbound: offer.itineraries[1]?.segments?.map((segment) => ({
                        departure: segment.departure,
                        arrival: segment.arrival,
                        aircraft: segment.aircraft,
                        duration: segment.duration,
                        carrierCode: segment.carrierCode,
                        number: segment.number
                      }))
                    },
                    cabinClass
                  });

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
                  const tier = amadeusService.determineTier(offer);

                  console.log('[Budget Route] Determined flight tier:', {
                    price,
                    cabinClass,
                    tier
                  });

              // Create a consistent flight data structure
                  const flightData: FlightDetails = {
                // Basic flight info for table view
                airline: airlineInfo.commonName || firstSegment.carrierCode,
                    route: inboundSegments.length > 0 
                      ? `${firstSegment.departure.iataCode} <-> ${lastOutboundSegment.arrival.iataCode}`  // Round trip
                      : `${firstSegment.departure.iataCode} -> ${lastOutboundSegment.arrival.iataCode}`,  // One way
                duration: amadeusService.calculateTotalDuration(offer.itineraries[0].segments),
                layovers: offer.itineraries[0].segments.length - 1,
                outbound: firstSegment.departure.at,
                inbound: lastInboundSegment?.arrival.at || lastOutboundSegment.arrival.at,
                    price: {
                      amount: price,
                      currency: offer.price.currency,
                      numberOfTravelers: transformedRequest.travelers
                    },
                    tier,
                flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
                referenceUrl: amadeusService.generateBookingUrl(offer),
                cabinClass,

                // Detailed flight info for modal view
                details: {
                  price: {
                        amount: price,
                        currency: offer.price.currency,
                        numberOfTravelers: transformedRequest.travelers
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
                    segments: offer.itineraries[0].segments.map((segment) => ({
                      airline: segment.carrierCode,
                      flightNumber: `${segment.carrierCode}${segment.number}`,
                      aircraft: {
                        code: segment.aircraft.code,
                        name: AIRCRAFT_CODES[segment.aircraft.code] || segment.aircraft.code
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
                        (fare) => fare.segmentId === `${segment.carrierCode}${segment.number}`
                      )?.cabin || cabinClass
                    })) as FlightSegment[],
                  }
                }
              };

                  console.log('[Budget Route] Created flight data structure:', {
                    tier,
                    price,
                    route: flightData.route,
                    segments: {
                      outbound: flightData.details.outbound.segments.map(s => ({
                        aircraft: s.aircraft,
                        departure: s.departure,
                        arrival: s.arrival
                      }))
                    }
                  });

                  // Add inbound flight details if it's a round trip
                  if (inboundSegments.length > 0) {
                    const firstInboundSegment = inboundSegments[0];
                    flightData.details.inbound = {
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
                      segments: inboundSegments.map((segment) => ({
                        airline: segment.carrierCode,
                        flightNumber: `${segment.carrierCode}${segment.number}`,
                        aircraft: {
                          code: segment.aircraft.code,
                          name: AIRCRAFT_CODES[segment.aircraft.code] || segment.aircraft.code
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
                          (fare) => fare.segmentId === `${segment.carrierCode}${segment.number}`
                        )?.cabin || cabinClass
                      })) as FlightSegment[]
                    };
                  }
              
              return flightData;
            } catch (error) {
                  console.error('[Budget Route] Error transforming flight:', error);
              return null;
            }
          })
        ).then(flights => flights.filter(flight => flight !== null));

            console.log('[Budget Route] Transformed flights by tier:', {
              flightsByTier: transformedFlights.reduce((acc, flight) => {
                if (!acc[flight.tier]) acc[flight.tier] = [];
                acc[flight.tier].push({
                  price: flight.price,
                  airline: flight.airline,
                  route: flight.route
                });
                return acc;
              }, {} as Record<string, any[]>)
            });

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
              acc[flight.tier].min = Math.min(acc[flight.tier].min, flight.price.amount);
              acc[flight.tier].max = Math.max(acc[flight.tier].max, flight.price.amount);
          
          return acc;
        }, {} as any);

        // Calculate averages
        Object.keys(groupedFlights).forEach(tier => {
          const flights = groupedFlights[tier].references;
              groupedFlights[tier].average = flights.reduce((sum: number, f: any) => sum + f.price.amount, 0) / flights.length;
            });

            console.log('[Budget Route] Final grouped flights:', {
              tiers: Object.keys(groupedFlights),
              flightCounts: Object.entries(groupedFlights).reduce((acc, [tier, data]) => {
                acc[tier] = (data as any).references.length;
                return acc;
              }, {} as Record<string, number>)
            });

            // If we have Amadeus flights, use them exclusively
            if (Object.keys(groupedFlights).length > 0) {
              agentResult.flights = {
                budget: groupedFlights.budget || agentResult.flights.budget,
                medium: groupedFlights.medium || agentResult.flights.medium,
                premium: groupedFlights.premium || agentResult.flights.premium
              };
            }
            // If no Amadeus flights at all, keep Perplexity results
            else {
              agentResult.flights = {
                budget: groupedFlights.budget || {
                  min: 0,
                  max: 0,
                  average: 0,
                  confidence: 0,
                  source: 'Amadeus API',
                  references: []
                },
                medium: groupedFlights.medium || {
                  min: 0,
                  max: 0,
                  average: 0,
                  confidence: 0,
                  source: 'Amadeus API',
                  references: []
                },
                premium: groupedFlights.premium || {
                  min: 0,
                  max: 0,
                  average: 0,
                  confidence: 0,
                  source: 'Amadeus API',
                  references: []
                }
              };
            }
      }
    } catch (error) {
      console.error('[Budget Route] Error searching flights:', error);
      // If flight search fails, call agent without flight data
      console.log('[Budget Route] Calling budget agent without flight data...');
      agentResult = await agent.handleTravelRequest(transformedRequest);
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

async function generateActivities(params: BudgetCalculationParams) {
  try {
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    const days = Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    logger.info('Preparing activity generation request:', {
      startDate: params.startDate,
      endDate: params.endDate,
      calculatedDays: days
    });

    const requestBody = {
      destination: params.destinations[0]?.label,
      days,
      startDate: params.startDate,
      endDate: params.endDate,
      budget: params.budgetLimit,
      currency: 'USD',
      preferences: params.preferences || {
        travelStyle: 'moderate',
        pacePreference: 'balanced',
        interests: ['sightseeing', 'culture'],
        accessibility: [],
        dietaryRestrictions: []
      },
      flightTimes: {
        arrival: params.startDate,
        departure: params.endDate
      }
    };

    logger.info('Generating activities with params:', requestBody);

    const response = await fetch(`${API_CONFIG.BACKEND_URL}/api/activities/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error('Activities generation failed:', {
        status: response.status,
        error,
        requestBody
      });
      throw new Error(error.message || 'Failed to generate activities');
    }

    const result = await response.json();
    logger.info('Activities generated successfully:', {
      activityCount: result.activities?.length || 0,
      hasItineraries: !!result.suggestedItineraries
    });

    return {
      activities: result.activities || [],
      suggestedItineraries: result.suggestedItineraries || {}
    };
  } catch (error) {
    logger.error('Activity generation failed:', error);
    return { activities: [], suggestedItineraries: {} };
  }
}

export async function calculateBudget(params: BudgetCalculationParams) {
  try {
    // Start both budget calculation and activity generation in parallel
    const [budgetResult, activitiesResult] = await Promise.all([
      // Your existing budget calculation logic here
      calculateBaseBudget(params),
      // Generate activities
      generateActivities(params)
    ]);

    return {
      ...budgetResult,
      activities: activitiesResult.activities,
      suggestedItineraries: activitiesResult.suggestedItineraries
    };
  } catch (error) {
    logger.error('Budget calculation failed:', error);
    throw error;
  }
}

async function calculateBaseBudget(params: BudgetCalculationParams) {
  // Your existing budget calculation logic here
  return {
    // ... budget calculation results
  };
}

export default router; 