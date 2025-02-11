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

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const TIMEOUT = 30000; // 30 seconds

const calculateBudgetWithRetry = async (req: Request) => {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const budgetCalculation = calculateBudget(req.body);
        setTimeout(() => reject(new Error('Request timeout')), TIMEOUT);
        budgetCalculation.then(resolve).catch(reject);
      });

              return result;
            } catch (error) {
      lastError = error;
      console.warn(`[Budget Route] Attempt ${attempt} failed:`, {
        message: error.message,
        code: error.code,
        response: error.response ? {
          status: error.response.statusCode,
          data: error.response.data
        } : undefined
      });
      
      if (error.response?.statusCode === 429) {
        // Rate limit hit, wait longer
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        continue;
      }
      
      // For other errors, break immediately
      break;
    }
  }
  
  throw lastError;
};

router.post('/calculate', async (req: Request, res: Response) => {
  try {
    console.log('[Budget Route] ====== START BUDGET CALCULATION ======');
    // Only log relevant request properties
    console.log('[Budget Route] Received request:', {
      body: req.body,
      query: req.query,
      params: req.params,
      method: req.method,
      path: req.path
    });
    
    const result = await calculateBudgetWithRetry(req);
    res.json(result);
    } catch (error) {
    console.error('[Budget Route] Error processing budget calculation:', {
        message: error.message,
        stack: error.stack,
      code: error.code
    });
    res.status(500).json({ error: 'Failed to calculate budget' });
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

    if (!params.destinations || !params.destinations.length) {
      logger.error('No destinations provided for activity generation', { params });
      throw new Error('No destinations provided');
    }

    logger.info('Preparing activity generation request:', {
      startDate: params.startDate,
      endDate: params.endDate,
      calculatedDays: days,
      destination: params.destinations[0].label
    });

    const requestBody = {
      destination: params.destinations[0].label,
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