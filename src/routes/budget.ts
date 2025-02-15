import express, { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus.js';
import { AirlineInfo } from '../types.js';
import { AmadeusSegment, AmadeusFare, AmadeusFareDetail, AmadeusFlightOffer } from '../types/amadeus.js';
import { AIRCRAFT_CODES as AIRCRAFT_CODE_MAP } from '../constants/aircraft.js';
import { normalizeCategory } from '../constants/categories.js';
import { rateLimit } from 'express-rate-limit';
import { logger } from '../utils/logger.js';

const router = Router();
const amadeusService = new AmadeusService();
const agent = new VacationBudgetAgent(amadeusService);
const prisma = new PrismaClient();

// Add rate limiter
const budgetLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    timestamp: new Date().toISOString()
  }
});

router.use(budgetLimiter);

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

const TIMEOUT = 120000; // Increase timeout to 120 seconds

// Add timeout promise helper
const withTimeout = (promise: Promise<any>, ms: number, context: string) => {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${context}`)), ms);
  });
  return Promise.race([promise, timeout]);
};

// Add validation function
const isValidBudgetRequest = (body: any): boolean => {
  const requiredFields = ['departureLocation', 'destinations', 'startDate', 'endDate', 'travelers'];
  return requiredFields.every(field => body[field]);
};

// Add budget calculation function
const calculateBudget = async (requestData: any) => {
  try {
    const transformedRequest = await transformRequest(requestData);
    return await agent.handleTravelRequest(transformedRequest);
  } catch (error) {
    logger.error('[Budget Calculation] Error in calculation:', error);
    throw error;
  }
};

// Add request transformation function
const transformRequest = async (data: any): Promise<TransformedRequest> => {
  const {
    departureLocation,
    destinations,
    startDate,
    endDate,
    travelers,
    budgetLimit,
    currency = 'USD'
  } = data;

  // Calculate number of days
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  return {
    type: 'vacation',
    departureLocation: {
      code: departureLocation.code,
      label: departureLocation.label,
      airport: getPrimaryAirportForCity(departureLocation.code),
      outboundDate: startDate,
      inboundDate: endDate,
      isRoundTrip: true
    },
    destinations: destinations.map((dest: any) => ({
      code: dest.code,
      label: dest.label,
      airport: getPrimaryAirportForCity(dest.code)
    })),
    country: destinations[0]?.label.split(',')[1]?.trim() || 'Unknown',
    travelers: parseInt(travelers),
    currency,
    budget: budgetLimit ? parseFloat(budgetLimit) : undefined,
    startDate,
    endDate,
    days
  };
};

// Calculate budget endpoint
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    logger.info('[Budget Route] ====== START BUDGET CALCULATION ======');
    logger.info('[Budget Route] Received request:', {
      body: JSON.stringify(req.body, null, 2),
      headers: req.headers,
      url: req.url,
      method: req.method
    });

    const { departureLocation, destinations, startDate, endDate, travelers, budgetLimit, currency } = req.body;

    // Validate required fields
    if (!departureLocation || !destinations || !startDate || !endDate || !travelers || !budgetLimit || !currency) {
      logger.error('[Budget Route] Missing required fields:', {
        hasDepartureLocation: !!departureLocation,
        hasDestinations: !!destinations,
        hasStartDate: !!startDate,
        hasEndDate: !!endDate,
        hasTravelers: !!travelers,
        hasBudgetLimit: !!budgetLimit,
        hasCurrency: !!currency
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }

    // Calculate budget breakdown
    const totalDays = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    const numTravelers = parseInt(travelers);

    const budgetBreakdown = {
      total: budgetLimit,
      perDay: budgetLimit / totalDays,
      perPerson: budgetLimit / numTravelers,
      perPersonPerDay: budgetLimit / (totalDays * numTravelers),
      categories: {
        flights: Math.round(budgetLimit * 0.4), // 40% for flights
        accommodation: Math.round(budgetLimit * 0.3), // 30% for accommodation
        activities: Math.round(budgetLimit * 0.15), // 15% for activities
        food: Math.round(budgetLimit * 0.1), // 10% for food
        transport: Math.round(budgetLimit * 0.05) // 5% for local transport
      }
    };

    logger.info('[Budget Route] Calculated budget breakdown:', budgetBreakdown);

    // Search for flights using Amadeus
    logger.info('[Budget Route] Starting flight search with Amadeus');
    
    // Get departure and destination airport codes
    const departureAirport = getPrimaryAirportForCity(departureLocation.code);
    const destinationAirport = getPrimaryAirportForCity(destinations[0].code);

    logger.info('[Budget Route] Using airports:', {
      departure: departureAirport,
      destination: destinationAirport,
      originalDeparture: departureLocation.code,
      originalDestination: destinations[0].code
    });

    // Search for flights
    const flightResults = await amadeusService.searchFlights({
      segments: [{
        originLocationCode: departureAirport,
        destinationLocationCode: destinationAirport,
        departureDate: startDate.split('T')[0]
      }],
      travelClass: 'ECONOMY',
      adults: numTravelers,
      max: 100
    });

    logger.info('[Budget Route] Flight search completed:', {
      resultsCount: flightResults?.length || 0,
      hasDictionaries: !!flightResults?.[0]?.dictionaries
    });

    // Group flights by tier
    const flightsByTier = {
      budget: { references: [] },
      medium: { references: [] },
      premium: { references: [] }
    };

    flightResults.forEach(flight => {
      const tier = amadeusService.determineTier(flight);
      if (flightsByTier[tier]) {
        flightsByTier[tier].references.push(flight);
      }
    });

    logger.info('[Budget Route] Flights grouped by tier:', {
      budget: flightsByTier.budget.references.length,
      medium: flightsByTier.medium.references.length,
      premium: flightsByTier.premium.references.length
    });

    return res.json({
      success: true,
      data: {
        budgetBreakdown,
        flights: flightsByTier,
        requestDetails: {
          departureLocation,
          destinations,
          startDate,
          endDate,
          travelers: numTravelers,
          currency
        },
        totalBudget: budgetLimit,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('[Budget Route] Error processing budget calculation:', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : 'Unknown error',
      timestamp: new Date().toISOString()
    });

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