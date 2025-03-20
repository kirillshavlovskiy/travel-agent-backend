import { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus.js';
import { FlightService } from '../services/flights.js';
import { AirlineInfo } from '../types.js';
import { AmadeusSegment, AmadeusFare, AmadeusFareDetail, AmadeusFlightOffer } from '../types/amadeus.js';
import { AIRCRAFT_CODES as AIRCRAFT_CODE_MAP } from '../constants/aircraft.js';
import { normalizeCategory } from '../constants/categories.js';
import { logger } from '../utils/logger.js';
import { 
  generateDayTheme,
  determineMainArea,
  generateBreakSchedule,
  generateLogistics,
  generateDayCommentary,
  generateDayHighlights,
  optimizeSchedule
} from './activities.js';
import { DestinationsService } from '../services/destinations.js';
import { ViatorService } from '../services/viator.js';

const router = Router();
const amadeusService = new AmadeusService();
const agent = new VacationBudgetAgent(amadeusService);
const prisma = new PrismaClient();
const destinationsService = DestinationsService.getInstance();
const viatorService = new ViatorService();

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
  preferences: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  };
}

// Helper function to transform budget request
function transformBudgetRequest(requestBody: any): TransformedRequest {
  // Extract dates
  const startDate = requestBody.startDate || new Date().toISOString().split('T')[0];
  const endDate = requestBody.endDate || new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Calculate number of days
  const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));

  // Transform departure location
  const departureLocation = {
    code: requestBody.departureLocation?.code || '',
    label: requestBody.departureLocation?.label || '',
    airport: getPrimaryAirportForCity(requestBody.departureLocation?.code || ''),
    outboundDate: startDate,
    inboundDate: endDate,
    isRoundTrip: true
  };

  // Transform destinations
  const destinations = (requestBody.destinations || []).map((dest: any) => ({
    code: dest.code || '',
    label: dest.label || '',
    airport: getPrimaryAirportForCity(dest.code || '')
  }));

  // Transform preferences
  const preferences = {
    travelStyle: requestBody.preferences?.travelStyle || 'balanced',
    pacePreference: requestBody.preferences?.pacePreference || 'moderate',
    interests: requestBody.preferences?.interests || [],
    accessibility: requestBody.preferences?.accessibility || [],
    dietaryRestrictions: requestBody.preferences?.dietaryRestrictions || []
  };

  return {
    type: 'vacation',
    departureLocation,
    destinations,
    country: destinations[0]?.label?.split(',')[0] || '',
    travelers: requestBody.travelers || 1,
    currency: requestBody.currency || 'USD',
    budget: requestBody.budgetLimit,
    startDate,
    endDate,
    days,
    preferences,
    flightData: requestBody.flightData
  };
}

// Get available cities and airports
router.get('/locations', async (req: Request, res: Response) => {
  try {
    logger.info('[Budget Route] Fetching available locations');
    
    // Get destinations from the service
    const destinations = await destinationsService.getDestinations();
    
    res.json({
      success: true,
      data: {
        cities: destinations.map(city => ({
          value: city.code,
          label: city.label
        })),
        airports: airports.map(airport => ({
          value: airport.value,
          label: airport.label
        }))
      },
      metadata: {
        lastUpdated: destinations[0]?.lastUpdated || new Date(),
        totalDestinations: destinations.length,
        sources: {
          viator: destinations.filter(d => d.source === 'VIATOR').length,
          amadeus: destinations.filter(d => d.source === 'AMADEUS').length,
          static: destinations.filter(d => d.source === 'STATIC').length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[Budget Route] Error fetching locations:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to get primary airport code for a city
function getPrimaryAirportForCity(cityCode: string): string {
  try {
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
  } catch (error) {
    console.error('[Budget Route] Error getting airport code:', error);
    return cityCode; // Return the city code as fallback
  }
}

// Add a helper function for safely calling the helper functions with better error handling
const safelyCallHelper = (fn: Function, args: any[], fnName: string, defaultValue: any) => {
  try {
    return fn(...args);
  } catch (error) {
    logger.error(`[Budget] Helper function ${fnName} failed:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return defaultValue;
  }
};

// Add validation for enriched activities
function validateEnrichedActivity(activity: Activity): boolean {
  const hasValidBookingDetails = activity.bookingDetails && 
    activity.bookingDetails.productCode &&
    activity.bookingDetails.provider === 'Viator';

  const hasValidAvailability = activity.availability &&
    Array.isArray(activity.availability.availableTimeSlots) &&
    activity.availability.realTimeVerification?.verified;

  const hasValidPrice = activity.price &&
    typeof activity.price.amount === 'number' &&
    activity.price.amount > 0 &&
    activity.price.currency;

  return hasValidBookingDetails && hasValidAvailability && hasValidPrice;
}

// Add logging for activity validation
function logActivityValidation(activity: Activity): void {
  logger.debug('[Budget] Activity validation:', {
    name: activity.name,
    bookingDetails: {
      hasDetails: !!activity.bookingDetails,
      provider: activity.bookingDetails?.provider,
      productCode: activity.bookingDetails?.productCode
    },
    availability: {
      hasAvailability: !!activity.availability,
      isAvailable: activity.availability?.isAvailable,
      hasTimeSlots: !!activity.availability?.availableTimeSlots?.length,
      timeSlots: activity.availability?.availableTimeSlots,
      verified: activity.availability?.realTimeVerification?.verified
    },
    price: {
      hasPrice: !!activity.price,
      amount: activity.price?.amount,
      currency: activity.price?.currency
    },
    timeSlot: activity.timeSlot,
    dayNumber: activity.dayNumber
  });
}

// Calculate budget endpoint
router.post('/calculate', async (req: Request, res: Response) => {
  // Increase timeout for the entire request
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    logger.info('[Budget Route] ====== START BUDGET CALCULATION ======');
    logger.info('[Budget Route] Received request:', {
      body: req.body,
        timestamp: new Date().toISOString()
      });

    // Transform request
    const transformedRequest = transformBudgetRequest(req.body);
    logger.info('[Budget Route] Transformed request:', transformedRequest);

    // Initialize services
    const agent = new VacationBudgetAgent(new FlightService());
    const viatorService = new ViatorService();

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Budget calculation timed out')), 290000);
    });

    const result = await Promise.race([
      (async () => {
        let agentResult;

        try {
          // Get activities from the budget agent
          agentResult = await agent.handleTravelRequest({
            departureLocation: transformedRequest.departureLocation,
            destinations: transformedRequest.destinations,
            startDate: transformedRequest.startDate,
            endDate: transformedRequest.endDate,
            travelers: transformedRequest.travelers,
            budgetLimit: transformedRequest.budget || 0,
            flightData: transformedRequest.flightData,
            preferences: transformedRequest.preferences
          });

          logger.info('[Budget Route] Received agent result:', {
            hasActivities: !!agentResult?.activities,
            hasEnrichedActivities: !!agentResult?.enrichedActivities,
            activitiesCount: agentResult?.activities?.length || 0,
            enrichedCount: agentResult?.enrichedActivities?.length || 0
          });
            } catch (error) {
          logger.error('[Budget Route] Error in budget agent:', error);
          throw error;
        }

        // Check if agent result is valid before proceeding
        if (!agentResult || (!agentResult.activities && !agentResult.enrichedActivities)) {
          logger.error('[Budget Route] VacationBudgetAgent failed to return valid result');
          return {
            success: false,
            error: 'Failed to calculate budget and generate initial activities',
            timestamp: new Date().toISOString()
          };
        }

        // Use enriched activities if available, otherwise fall back to regular activities
        const activitiesArray = agentResult.enrichedActivities || 
          (Array.isArray(agentResult.activities) ? agentResult.activities : 
            agentResult.activities ? Object.values(agentResult.activities).flatMap(tier => tier.references || []) : []);

        if (!activitiesArray || !activitiesArray.length) {
          logger.error('[Budget Route] No activities found in agent result');
          return {
            success: false,
            error: 'No activities generated',
            timestamp: new Date().toISOString()
          };
        }

        // Extract destination info for Viator enrichment
        const destination = transformedRequest.destinations[0];
        const cityName = destination.label.split(',')[0].trim();

        // Get destination ID from Viator
        let destinationId;
        try {
          destinationId = await viatorService.getDestinationId(cityName);
          logger.info('[Budget] Found Viator destination ID:', {
            city: cityName,
            destinationId
          });
        } catch (error) {
          logger.error('[Budget] Failed to get Viator destination ID:', {
            city: cityName,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }

        // Enrich activities with Viator data
        const enrichedActivities = await Promise.all(
          activitiesArray.map(async (activity) => {
            try {
              logger.info('[Budget] Enriching activity:', {
                name: activity.name,
                destination: cityName,
                date: transformedRequest.startDate,
                stage: 'start'
              });

              // Search for matching Viator activities
              const searchResults = await viatorService.searchActivity(
                activity.name,
                destinationId,
                transformedRequest.startDate,
                transformedRequest.endDate
              );

              if (!searchResults || searchResults.length === 0) {
                logger.warn('[Budget] No Viator activities found for:', {
                  name: activity.name,
                  destination: cityName,
                  stage: 'no_results'
                });
          return {
              ...activity,
                  enrichmentStatus: 'not_found',
                  location: cityName,
                  date: transformedRequest.startDate
                };
              }

              // Get the best match using string similarity
              const bestMatch = searchResults.reduce((best, current) => {
                const bestScore = viatorService.stringSimilarity(activity.name.toLowerCase(), best.title.toLowerCase());
                const currentScore = viatorService.stringSimilarity(activity.name.toLowerCase(), current.title.toLowerCase());
                return currentScore > bestScore ? current : best;
              }, searchResults[0]);

              logger.info('[Budget] Found matching activity:', {
                originalName: activity.name,
                matchedName: bestMatch.title,
                productCode: bestMatch.productCode,
                stage: 'match_found'
              });

              // Get real-time availability
              let realTimeCheck;
              try {
                realTimeCheck = await viatorService.checkRealTimeAvailability(
                  bestMatch.productCode,
                  transformedRequest.startDate
                );
                
                logger.info('[Budget] Real-time availability checked:', {
                  name: activity.name,
                  productCode: bestMatch.productCode,
                  isAvailable: realTimeCheck?.available,
                  stage: 'availability_checked'
                });
              } catch (error) {
                logger.warn('[Budget] Failed to get real-time availability:', {
                  name: activity.name,
                  productCode: bestMatch.productCode,
                  error: error instanceof Error ? error.message : 'Unknown error'
                });
              }

              // Get detailed product information
              const enriched = await viatorService.enrichActivityDetails({
                ...activity,
                name: activity.name,
                timeSlot: activity.timeSlot,
                dayNumber: activity.dayNumber,
                location: cityName,
                date: transformedRequest.startDate,
                bookingDetails: {
                  provider: 'Viator',
                  productCode: bestMatch.productCode,
                  referenceUrl: viatorService.constructBookingUrl(bestMatch)
                },
                price: {
                  amount: realTimeCheck?.pricing?.fromPrice || bestMatch.pricing?.summary?.fromPrice || activity.price?.amount || 0,
                  currency: realTimeCheck?.pricing?.currency || bestMatch.pricing?.currency || 'USD'
                },
                availability: realTimeCheck ? {
                  isAvailable: realTimeCheck.available,
                  availableTimeSlots: realTimeCheck.schedule.availableTimeSlots.map(time => {
                    const hour = parseInt(time.split(':')[0]);
                    if (hour >= 6 && hour < 12) return 'morning';
                    if (hour >= 12 && hour < 17) return 'afternoon';
                    return 'evening';
                  }),
                  exactStartTimes: realTimeCheck.schedule.availableTimeSlots,
                  realTimeVerification: {
                    verified: true,
                    exactStartTimes: realTimeCheck.schedule.availableTimeSlots,
                    lastChecked: new Date().toISOString(),
                    pricing: realTimeCheck.pricing
                  },
                  operatingHours: realTimeCheck.schedule.openingHours?.join(', ')
                } : undefined
              });

              logger.info('[Budget] Successfully enriched activity:', {
                name: activity.name,
                productCode: bestMatch.productCode,
                stage: 'complete'
              });

              // Return enriched activity with fallback to original data
          return {
                ...activity,
                ...enriched,
                name: activity.name,
                timeSlot: activity.timeSlot,
                dayNumber: activity.dayNumber,
                location: cityName,
                date: transformedRequest.startDate,
                enrichmentStatus: enriched.bookingDetails?.productCode ? 'success' : 'not_found'
              };
        } catch (error) {
              logger.warn('[Budget] Failed to enrich activity with Viator details:', {
                name: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
              return {
                ...activity,
                location: cityName,
                date: transformedRequest.startDate,
                enrichmentStatus: 'failed'
              };
            }
          })
        );

        // Update daily plans with enriched activities
        const updatedDailyPlans = agentResult.dailyPlans?.map((plan) => ({
          ...plan,
          activities: plan.activities?.map((activity) => {
            const enriched = enrichedActivities.find(
              (ea) => ea.name === activity.name && ea.dayNumber === plan.dayNumber
            );
            return enriched || activity;
          }) || []
        })) || [];

        // Return the final result
          return {
            success: true,
          requestDetails: {
              departureLocation: transformedRequest.departureLocation,
              destinations: transformedRequest.destinations,
              startDate: transformedRequest.startDate,
              endDate: transformedRequest.endDate,
              travelers: transformedRequest.travelers,
            currency: transformedRequest.currency,
            budgetLimit: transformedRequest.budget
          },
          activities: enrichedActivities,
          dailyPlans: updatedDailyPlans.map(day => ({
            ...day,
            activities: day.mapData.locations.map(location => {
              // Find matching enriched activity
              const enrichedActivity = enrichedActivities.find(a => 
                a.name === location.name || 
                a.name.toLowerCase().includes(location.name.toLowerCase()) ||
                location.name.toLowerCase().includes(a.name.toLowerCase())
              );

              if (enrichedActivity) {
                return {
                  ...enrichedActivity,
                  name: location.name,
                  description: location.description || enrichedActivity.description,
                  category: location.category || enrichedActivity.category,
                  location: location.address || enrichedActivity.location,
                  timeSlot: location.timeSlot || enrichedActivity.timeSlot,
                  duration: location.duration || enrichedActivity.duration,
                  coordinates: location.coordinates,
                  order: location.order,
                  availability: enrichedActivity.availability || {
                    isAvailable: true,
                    availableTimeSlots: [location.timeSlot],
                    exactStartTimes: [],
                    timesByCategory: {
                      morning: [],
                      afternoon: [],
                      evening: []
                    },
                    realTimeVerification: {
                      verified: false,
                      exactStartTimes: [],
                      lastChecked: new Date().toISOString()
                    }
                  }
                };
              }

              // If no match found, try to find a similar activity to get availability data
              const similarActivity = enrichedActivities.find(a => 
                a.name.toLowerCase().includes(location.name.toLowerCase()) ||
                location.name.toLowerCase().includes(a.name.toLowerCase())
              );

              // Return location data with availability from similar activity if found
              return {
                name: location.name,
                description: location.description,
                category: location.category,
                location: location.address,
                timeSlot: location.timeSlot,
                duration: location.duration,
                coordinates: location.coordinates,
                order: location.order,
                dayNumber: day.dayNumber,
                date: transformedRequest.startDate,
                price: { amount: 0, currency: transformedRequest.currency },
                availability: similarActivity?.availability || {
                  isAvailable: true,
                  availableTimeSlots: [location.timeSlot],
                  exactStartTimes: [],
                  timesByCategory: {
                    morning: [],
                    afternoon: [],
                    evening: []
                  },
                  realTimeVerification: {
                    verified: false,
                    exactStartTimes: [],
                    lastChecked: new Date().toISOString()
                  }
                }
              };
            })
          })),
          tripOverview: agentResult.tripSummary?.overview || 'Trip overview not available',
          activityFitNotes: agentResult.organizationLogic?.overview || 'Activity fit notes not available',
          schedule: updatedDailyPlans.map(day => ({
            dayNumber: day.dayNumber,
            theme: safelyCallHelper(generateDayTheme, [day.activities], 'generateDayTheme', 'Mixed Activities'),
            mainArea: safelyCallHelper(determineMainArea, [day.activities], 'determineMainArea', 'City Center'),
            commentary: safelyCallHelper(generateDayCommentary, [day.activities, transformedRequest.preferences, day.dayNumber], 'generateDayCommentary', ''),
            highlights: safelyCallHelper(generateDayHighlights, [day.activities, transformedRequest.preferences], 'generateDayHighlights', []),
            activities: enrichedActivities.filter(activity => activity.dayNumber === day.dayNumber).map(activity => ({
              ...activity,
              timeSlot: activity.timeSlot,
              startTime: activity.startTime || activity.availability?.exactStartTimes?.[0],
              availability: activity.availability || {
                isAvailable: true,
                availableTimeSlots: [activity.timeSlot],
                exactStartTimes: activity.availability?.exactStartTimes || [],
                timesByCategory: {
                  morning: activity.availability?.timesByCategory?.morning || [],
                  afternoon: activity.availability?.timesByCategory?.afternoon || [],
                  evening: activity.availability?.timesByCategory?.evening || []
                },
                realTimeVerification: {
                  verified: activity.availability?.realTimeVerification?.verified || false,
                  exactStartTimes: activity.availability?.realTimeVerification?.exactStartTimes || [],
                  lastChecked: activity.availability?.realTimeVerification?.lastChecked || new Date().toISOString()
                }
              }
            })).sort((a, b) => {
              // Sort by time slot first
              const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
              const timeSlotDiff = timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
              if (timeSlotDiff !== 0) return timeSlotDiff;
              
              // Then by start time if available
              if (a.startTime && b.startTime) {
                const [aHour, aMin] = a.startTime.split(':').map(Number);
                const [bHour, bMin] = b.startTime.split(':').map(Number);
                return (aHour * 60 + aMin) - (bHour * 60 + bMin);
              }
              return 0;
            }),
            breaks: safelyCallHelper(generateBreakSchedule, [day.activities, transformedRequest.preferences], 'generateBreakSchedule', {
              morning: { startTime: '10:30', endTime: '11:00', duration: 30, suggestion: 'Coffee break' },
              lunch: { startTime: '12:30', endTime: '13:30', duration: 60, suggestion: 'Lunch break' },
              afternoon: { startTime: '15:30', endTime: '16:00', duration: 30, suggestion: 'Rest break' },
              dinner: { startTime: '18:30', endTime: '20:00', duration: 90, suggestion: 'Dinner' }
            }),
            logistics: safelyCallHelper(generateLogistics, [day.activities, transformedRequest.preferences], 'generateLogistics', {
              transportSuggestions: ['Use public transportation between major attractions'],
              walkingDistances: ['Average walking distance between activities: 15-20 minutes'],
              timeEstimates: ['Allow 30 minutes for transportation between activities']
            })
          })),
          dailyHighlights: agentResult.dayHighlights || [],
          totalBudget: transformedRequest.budget,
                metadata: {
            perplexityCalls: 0,
            scheduleGeneration: {
              source: 'budget_agent',
              timestamp: new Date().toISOString(),
              preferences: transformedRequest.preferences
            },
            enrichment: {
              totalActivities: enrichedActivities.length,
              enrichedCount: enrichedActivities.filter(a => a.enrichmentStatus === 'success').length,
              destinationId
            }
          }
        };
      })(),
      timeoutPromise
    ]);

    logger.info('[Budget Route] ====== END BUDGET CALCULATION ======');

    // Send the response
    return res.json(result);

  } catch (error) {
    logger.error('[Budget Route] Error in budget calculation:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return res.status(500).json({
        success: false,
      error: error instanceof Error ? error.message : 'Budget calculation failed',
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