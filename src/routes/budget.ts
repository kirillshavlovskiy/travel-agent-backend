import express, { Router, Request, Response } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus';
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
  optimizeSchedule,
  getDefaultStartTime
} from './activities.js';
import { DestinationsService } from '../services/destinations.js';
import { ViatorService, ViatorAvailabilityResponse } from '../services/viator.js';
import * as fs from 'fs';
import * as path from 'path';
import { enhanceDailyPlansWithPreferences } from '../utils/itinerary';
import { createProximityBasedSchedule } from '../utils/proximity';
import amadeusService from '../services/amadeus';

const router = Router();
const amadeusService = new AmadeusService();
const agent = new VacationBudgetAgent(new FlightService());
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

// Add at the top of the file where other constants are defined, typically after the imports
// Near line 49 where TIMEOUT is defined
const TIMEOUT = 600000; // 10 minutes to account for multiple flight searches
const SEARCH_TIMEOUT = 120000; // 2 minutes per search

interface Activity {
  id?: string;
  name: string;
  duration: number;
  category: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  startTime: string;
  selected: boolean;
  description: string;
  location: string;
  price: {
    amount: number;
    currency: string;
  };
  rating: number;
  numberOfReviews: number;
  bookingDetails: {
    provider: string;
    productCode?: string;
    referenceUrl?: string;
    instantConfirmation: boolean;
    cancellationPolicy?: string;
  };
  dayNumber: number;
  enrichmentStatus?: 'success' | 'failed';
  date?: string;
  commentary?: string;
  itineraryHighlight?: string;
  availability?: ActivityAvailability;
  coordinates?: {
    lat: number;
    lng: number;
  };
  order?: number;
  highlights?: string[];
  enrichmentDuration?: number;
}

interface DailyPlan {
  dayNumber: number;
  activities: Activity[];
  mapData: {
    locations: Array<{
      name: string;
      description?: string;
      category?: string;
      address?: string;
      timeSlot?: string;
      duration?: number;
      coordinates?: {
        lat: number;
        lng: number;
      };
      order?: number;
    }>;
  };
}

interface CategoryTier<T> {
  references: T[];
}

interface ActivityReference extends Activity {
  tier: 'budget' | 'medium' | 'premium';
}

interface AgentResult {
  activities?: {
    budget: CategoryTier<ActivityReference>;
    medium: CategoryTier<ActivityReference>;
    premium: CategoryTier<ActivityReference>;
  } | Activity[];
  enrichedActivities?: Activity[];
  dailyPlans?: DailyPlan[];
  tripSummary?: {
    overview: string;
  };
  organizationLogic?: {
    overview: string;
  };
  dayHighlights?: string[];
}

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

// Update the ViatorSearchResult interface
interface ViatorSearchResult {
  title: string;
  productCode: string;
  description?: string;
  location?: string;
  rating?: number;
  numberOfReviews?: number;
  highlights?: string[];
  pricing?: {
    summary?: {
      fromPrice?: number;
    };
    currency?: string;
  };
}

// Update the RealTimeCheck interface
interface RealTimeCheck {
  available: boolean;
  schedule: {
    availableTimeSlots: string[];
    openingHours?: string[];
  };
  pricing?: {
    fromPrice?: number;
    currency?: string;
  };
  operatingDays?: string[];
  timeSlots?: string[];
  unavailableDatesCount?: number;
  source?: string;
  bookableItems?: number;
}

// Add these type declarations
interface TimeSlots {
  morning: string[];
  afternoon: string[];
  evening: string[];
}

interface ActivityAvailability {
  isAvailable: boolean;
  availableTimeSlots: ('morning' | 'afternoon' | 'evening')[];
  exactStartTimes: string[];
  timesByCategory: TimeSlots;
  realTimeVerification: {
    verified: boolean;
    exactStartTimes: string[];
    lastChecked: string;
    pricing?: any;
  };
  operatingHours?: string;
}

// Add at the beginning of the file, after imports
const usedProductCodes = new Set<string>();

// Add function to reset product codes at the start of each request
function resetProductCodes() {
  usedProductCodes.clear();
  viatorService.resetProductCodes(); // Reset the service's tracking as well
  logger.info('[Budget] Reset product code tracking');
}

// Helper function to transform budget request
function transformBudgetRequest(requestBody: any): TransformedRequest {
  // Extract dates
  const startDate = requestBody.startDate || new Date().toISOString().split('T')[0];
  const endDate = requestBody.endDate || new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Calculate number of days
  const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));

  // Transform departure location - handle both string and object formats
  const departureLocation = {
    code: typeof requestBody.departureLocation === 'string' 
      ? requestBody.departureLocation.split(',')[1]?.trim() || ''
      : requestBody.departureLocation?.code || '',
    label: typeof requestBody.departureLocation === 'string'
      ? requestBody.departureLocation
      : requestBody.departureLocation?.label || '',
    airport: getPrimaryAirportForCity(typeof requestBody.departureLocation === 'string'
      ? requestBody.departureLocation.split(',')[1]?.trim() || ''
      : requestBody.departureLocation?.code || ''),
    outboundDate: startDate,
    inboundDate: endDate,
    isRoundTrip: true
  };

  // Transform destinations - handle both string and object formats
  const destinations = (Array.isArray(requestBody.destinations) ? requestBody.destinations : [requestBody.destination])
    .map((dest: any) => ({
      code: typeof dest === 'string' ? dest.split(',')[1]?.trim() || '' : dest.code || '',
      label: typeof dest === 'string' ? dest : dest.label || '',
      airport: getPrimaryAirportForCity(typeof dest === 'string' ? dest.split(',')[1]?.trim() || '' : dest.code || '')
  }));

  // Transform preferences
  const preferences = {
    travelStyle: requestBody.travelPreferences?.travelStyle || 'balanced',
    pacePreference: requestBody.travelPreferences?.pace || 'moderate',
    interests: requestBody.travelPreferences?.interests || [],
    accessibility: requestBody.travelPreferences?.accessibility || [],
    dietaryRestrictions: requestBody.travelPreferences?.dietaryRestrictions || []
  };

  return {
    type: 'vacation',
    departureLocation,
    destinations,
    country: destinations[0]?.label?.split(',')[0] || '',
    travelers: requestBody.numberOfTravelers || 1,
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

// Update the validateEnrichedActivity function
function validateEnrichedActivity(activity: Activity): boolean {
  const hasValidBookingDetails = activity.bookingDetails && 
    activity.bookingDetails.productCode &&
    activity.bookingDetails.provider === 'Viator';

  const hasValidAvailability = activity.availability &&
    Array.isArray(activity.availability.availableTimeSlots) &&
    activity.availability.realTimeVerification?.verified === true;

  const hasValidPrice = activity.price &&
    typeof activity.price.amount === 'number' &&
    activity.price.amount > 0 &&
    typeof activity.price.currency === 'string';

  return Boolean(hasValidBookingDetails && hasValidAvailability && hasValidPrice);
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

// Update the availability transformation
const transformAvailability = (realTimeCheck: RealTimeCheck): ActivityAvailability => {
  const timesByCategory: TimeSlots = {
    morning: [],
    afternoon: [],
    evening: []
  };

  const availableTimeSlots = realTimeCheck.schedule.availableTimeSlots.map(time => {
    const hour = parseInt(time.split(':')[0]);
    const slot = hour >= 6 && hour < 12 ? 'morning' :
      hour >= 12 && hour < 17 ? 'afternoon' : 'evening';
    timesByCategory[slot].push(time);
    return slot;
  });

  return {
    isAvailable: realTimeCheck.available,
    availableTimeSlots: Array.from(new Set(availableTimeSlots)) as ('morning' | 'afternoon' | 'evening')[],
    exactStartTimes: realTimeCheck.schedule.availableTimeSlots,
    timesByCategory,
    realTimeVerification: {
      verified: true,
      exactStartTimes: realTimeCheck.schedule.availableTimeSlots,
      lastChecked: new Date().toISOString(),
      pricing: realTimeCheck.pricing
    },
    operatingHours: realTimeCheck.schedule.openingHours?.join(', ')
  };
};

// Add calculateDays function if it's not available elsewhere
function calculateDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
}

// Calculate budget endpoint
router.post('/calculate', async (req: Request, res: Response) => {
  // Reset product codes at the start of each request
  resetProductCodes();
  
  // Increase timeout for the entire request
  req.setTimeout(600000);  // 10 minutes
  res.setTimeout(600000);  // 10 minutes

  try {
    logger.info('[Budget Route] ====== START BUDGET CALCULATION ======');
    logger.info('[Budget Route] Received request:', {
      body: req.body,
        timestamp: new Date().toISOString()
      });

    // Transform request
    const transformedRequest = transformBudgetRequest(req.body);
    logger.info('[Budget Route] Transformed request:', transformedRequest);

    // First search for real-time flights with Amadeus
    logger.info('[Budget Route] Searching for real-time flights with Amadeus...');
    const formattedDepartureDate = transformedRequest.startDate.split('T')[0];
    const formattedReturnDate = transformedRequest.endDate.split('T')[0];

    // Search for flights in all cabin classes with individual timeouts
    const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
    const searchPromises = cabinClasses.map(async cabinClass => {
      try {
        const searchPromise = amadeusService.searchFlights({
          segments: [{
            originLocationCode: transformedRequest.departureLocation.airport,
            destinationLocationCode: transformedRequest.destinations[0].airport,
            departureDate: formattedDepartureDate
          }, {
            originLocationCode: transformedRequest.destinations[0].airport,
            destinationLocationCode: transformedRequest.departureLocation.airport,
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
        logger.warn(`[Budget Route] Search failed for ${cabinClass}:`, error);
        return [];
      }
    });

    // Wait for all searches to complete
    const allFlights = (await Promise.all(searchPromises)).flat();

    if (allFlights.length === 0) {
      logger.warn('[Budget Route] No flights found for any cabin class');
    } else {
      logger.info('[Budget Route] Flight search results:', {
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
        },
        priceRange: allFlights.length > 0 ? {
          min: Math.min(...allFlights.map((f: AmadeusFlightOffer) => parseFloat(f.price.total))),
          max: Math.max(...allFlights.map((f: AmadeusFlightOffer) => parseFloat(f.price.total))),
          currency: allFlights[0].price.currency
        } : null
      });

      // Add flight data to the transformed request
      transformedRequest.flightData = allFlights;
    }

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Budget calculation timed out')), 590000);  // 9.8 minutes
    });

    const result = await Promise.race([
      (async () => {
        try {
          let agentResult: AgentResult;

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
          }) as AgentResult;

          logger.info('[Budget Route] Received agent result:', {
            hasActivities: !!agentResult?.activities,
            hasEnrichedActivities: !!agentResult?.enrichedActivities,
            activitiesCount: Array.isArray(agentResult?.activities) ? agentResult.activities.length : 
              agentResult?.activities ? Object.values(agentResult.activities).reduce((acc, tier) => acc + (tier.references?.length || 0), 0) : 0,
            enrichedCount: agentResult?.enrichedActivities?.length || 0
          });

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
          const activitiesArray: Activity[] = agentResult.enrichedActivities || 
          (Array.isArray(agentResult.activities) ? agentResult.activities : 
            agentResult.activities ? Object.values(agentResult.activities).flatMap(tier => tier.references || []) : []);

          // Format existing activities properly before passing them
          const formattedActivities: Activity[] = activitiesArray.map(activity => {
            const base = { ...activity };
            const duration = typeof base.duration === 'string' ? 
              parseInt((base.duration as string).replace(/[^0-9]/g, '')) : 
              (typeof base.duration === 'number' ? base.duration : 120);
            
            // Get the first available time or use a default
            const firstAvailableTime = base.availability?.realTimeVerification?.exactStartTimes?.[0];
            const defaultStartTime = base.startTime || firstAvailableTime || '09:00';
            
          return {
              ...base,
              name: base.name || 'Explore Local Attractions',
              duration,
              category: base.category || 'Sightseeing',
              timeSlot: base.timeSlot || 'morning',
              startTime: defaultStartTime,  // Always provide a startTime
              selected: typeof base.selected === 'boolean' ? base.selected : false,
              description: base.description || 'Discover the local culture and attractions in this vibrant city.',
              location: base.location || 'City Center',
              price: base.price || {
                amount: 0,
                currency: 'USD'
              },
              rating: base.rating || 4.5,
              numberOfReviews: base.numberOfReviews || 100,
              bookingDetails: {
                provider: base.bookingDetails?.provider || 'Local',
                productCode: base.bookingDetails?.productCode,
                referenceUrl: base.bookingDetails?.referenceUrl,
                instantConfirmation: base.bookingDetails?.instantConfirmation || true,
                cancellationPolicy: base.bookingDetails?.cancellationPolicy || 'Flexible'
              },
              dayNumber: base.dayNumber || 1,
              enrichmentStatus: base.enrichmentStatus || 'success'
            } as Activity;
          });

          // Validate and deduplicate activities using a more specific key
          const uniqueActivities = formattedActivities.reduce((acc, activity) => {
            const key = `${activity.name}-${activity.dayNumber}-${activity.timeSlot}-${activity.bookingDetails?.productCode || 'local'}-${activity.location}-${activity.category}-${activity.price?.amount}`;
            if (!acc.has(key)) {
              acc.set(key, activity);
            } else {
              logger.warn('[Budget] Duplicate activity detected:', {
                activityName: activity.name,
                existingKey: key,
                existingActivity: acc.get(key),
                newActivity: activity
              });
            }
            return acc;
          }, new Map<string, Activity>());

          const deduplicatedActivities = Array.from(uniqueActivities.values());

          logger.info('[Budget] Activities formatting completed', {
            originalCount: activitiesArray.length,
            formattedCount: deduplicatedActivities.length,
            firstActivity: deduplicatedActivities[0] ? {
              name: deduplicatedActivities[0].name,
              duration: deduplicatedActivities[0].duration,
              timeSlot: deduplicatedActivities[0].timeSlot,
              category: deduplicatedActivities[0].category,
              price: deduplicatedActivities[0].price,
              bookingDetails: deduplicatedActivities[0].bookingDetails ? {
                provider: deduplicatedActivities[0].bookingDetails.provider,
                productCode: deduplicatedActivities[0].bookingDetails.productCode
              } : undefined
            } : null,
            hasEnrichedActivities: !!agentResult.enrichedActivities,
            enrichedActivitiesCount: agentResult.enrichedActivities?.length
          });

          // If we have valid activities from the budget agent, use them directly
          if (deduplicatedActivities.length > 0) {
            logger.info('[Budget] Using activities from budget agent, skipping activities generation');
            // Create themed activities based on preferences
        const destination = transformedRequest.destinations[0];
        const cityName = destination.label.split(',')[0].trim();
            const themedActivities: Activity[] = deduplicatedActivities.map((activity, index) => {
              const timeSlot = index % 3 === 0 ? 'morning' :
                index % 3 === 1 ? 'afternoon' : 'evening';
              const category = req.body.preferences?.interests?.[index % req.body.preferences.interests.length] || 'Culture';
              return {
                ...activity,
                name: activity.name || `${category} Experience in ${cityName}`,
                timeSlot,
                category,
                description: activity.description || `Enjoy a ${req.body.preferences?.travelStyle || 'luxury'} ${category.toLowerCase()} experience in ${cityName}.`,
                location: cityName,
                commentary: `This activity is perfect for travelers interested in ${category.toLowerCase()} with a ${req.body.preferences?.pacePreference || 'moderate'} pace.`,
                itineraryHighlight: `A ${timeSlot} activity focusing on ${category.toLowerCase()} aspects of the city.`
              };
            });

        // Get destination ID from Viator
            let destinationId: string | undefined;
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
              themedActivities.map(async (activity) => {
                try {
                  logger.info('[Budget] Starting activity enrichment:', {
                    activityName: activity.name,
                    dayNumber: activity.dayNumber,
                    timeSlot: activity.timeSlot,
                    category: activity.category,
                    location: cityName,
                date: transformedRequest.startDate,
                    stage: 'enrichment_start'
              });

                  // Search for matching activities
              const searchResults = await viatorService.searchActivity(
                activity.name,
                destinationId,
                    transformedRequest.startDate
              );

                  if (!searchResults?.length) {
                    logger.warn('[Budget] No search results found for activity:', {
                  name: activity.name,
                      location: cityName
                    });
                    return activity;
                  }

                  // Find best unused match
                  let bestMatch = null;
                  for (const result of searchResults) {
                    if (!usedProductCodes.has(result.productCode)) {
                      bestMatch = result;
                      break;
                    }
                  }

                  if (!bestMatch) {
                    logger.warn('[Budget] All matching product codes already used:', {
                      activity: activity.name,
                      usedCodes: Array.from(usedProductCodes)
                    });
                    return activity;
                  }

                  // Track the product code
                  usedProductCodes.add(bestMatch.productCode);
                  logger.info('[Budget] Reserved product code:', {
                  productCode: bestMatch.productCode,
                    activity: activity.name
                  });

                  // Enrich the activity
              const enriched = await viatorService.enrichActivityDetails({
                ...activity,
                    name: bestMatch.title,
                    description: bestMatch.description,
                bookingDetails: {
                  provider: 'Viator',
                  productCode: bestMatch.productCode,
                      referenceUrl: `https://www.viator.com/tours/${cityName.replace(/\s+/g, '-')}/${bestMatch.productCode}`
                    }
                  });

                  return enriched || activity;
        } catch (error) {
                  logger.error('[Budget] Failed to enrich activity:', {
                    activity: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
                  return activity;
            }
          })
        );

            // Add validation for product codes
            const productCodeMap = new Map<string, string>();
            const duplicates: Array<{code: string, activities: string[]}> = [];

            enrichedActivities.forEach(activity => {
              const productCode = activity.bookingDetails?.productCode;
              if (productCode) {
                if (productCodeMap.has(productCode)) {
                  duplicates.push({
                    code: productCode,
                    activities: [productCodeMap.get(productCode)!, activity.name]
                  });
                } else {
                  productCodeMap.set(productCode, activity.name);
                }
              }
            });

            if (duplicates.length > 0) {
              logger.error('[Budget] Duplicate product codes detected:', {
                duplicates,
                totalActivities: enrichedActivities.length,
                uniqueProductCodes: productCodeMap.size
              });
            }

            // Add summary logging for all activities
            logger.info('[Budget] Activity enrichment summary:', {
              totalActivities: enrichedActivities.length,
              enrichmentStats: {
                success: enrichedActivities.filter(a => a.enrichmentStatus === 'success').length,
                notFound: enrichedActivities.filter(a => a.enrichmentStatus === 'not_found').length,
                failed: enrichedActivities.filter(a => a.enrichmentStatus === 'failed').length
              },
              priceRange: {
                min: Math.min(...enrichedActivities.map(a => a.price?.amount || 0)),
                max: Math.max(...enrichedActivities.map(a => a.price?.amount || 0)),
                average: enrichedActivities.reduce((acc, a) => acc + (a.price?.amount || 0), 0) / enrichedActivities.length
              },
              categoryDistribution: enrichedActivities.reduce((acc, a) => {
                acc[a.category] = (acc[a.category] || 0) + 1;
                return acc;
              }, {} as Record<string, number>),
              stage: 'enrichment_summary'
            });

        // First, we'll declare the variable outside the if/else block
        let optimizationResult;

        // Then in the if block
        if (req.body.preferences.accessibility?.length || req.body.preferences.dietaryRestrictions?.length) {
          logger.info('[Budget Route] Filtering activities based on accessibility and dietary preferences', {
            accessibility: req.body.preferences.accessibility || [],
            dietaryRestrictions: req.body.preferences.dietaryRestrictions || []
          });
          
          // Filter enriched activities
          const requirementsFilter = {
            accessibility: req.body.preferences.accessibility,
            dietaryRestrictions: req.body.preferences.dietaryRestrictions
          };
          
          const filteredActivities = viatorService.filterActivitiesByRequirements(
            enrichedActivities,
            requirementsFilter
          );

          logger.info('[Budget Route] Activity filtering results', {
            totalActivities: enrichedActivities.length,
            filteredActivities: filteredActivities.length,
            filteredOut: enrichedActivities.length - filteredActivities.length
          });
          
          // Now apply proximity-based scheduling if accessibility needs or pace preferences are specified
          if (req.body.preferences.accessibility?.length || 
              req.body.preferences.pacePreference) {
            
            logger.info('[Budget Route] Using proximity-based scheduling with pace:', {
              pacePreference: req.body.preferences.pacePreference || 'moderate',
              accessibility: (req.body.preferences.accessibility || []).length > 0
            });
            
            // Determine number of days
            const days = calculateDays(transformedRequest.startDate, transformedRequest.endDate);
            
            // Apply proximity-based scheduling with pace preference
            const proximityScheduledActivities = createProximityBasedSchedule(
              filteredActivities,
              days,
              req.body.preferences.accessibility || [],
              req.body.preferences.pacePreference || 'moderate'
            );
            
            logger.info('[Budget Route] Created proximity-based schedule', {
              totalActivities: proximityScheduledActivities.length,
              days,
              pacePreference: req.body.preferences.pacePreference || 'moderate'
            });
            
            // Use these activities for the schedule optimization
            optimizationResult = await optimizeSchedule(
              proximityScheduledActivities,
              days,
              transformedRequest.startDate
            );
          } else {
            // Use filtered activities without proximity scheduling
            optimizationResult = await optimizeSchedule(
              filteredActivities,
              calculateDays(transformedRequest.startDate, transformedRequest.endDate),
              transformedRequest.startDate
            );
          }
        } else {
          // Original code to execute if no filtering needed
          optimizationResult = await optimizeSchedule(
            enrichedActivities,
            calculateDays(transformedRequest.startDate, transformedRequest.endDate),
            transformedRequest.startDate
          );
        }

        // Make sure we have a valid result before enhancing plans
        if (!optimizationResult) {
          throw new Error('Failed to optimize schedule');
        }

        // Enhance daily plans with preference-specific information
        if (optimizationResult?.schedule?.length) {
          logger.info('[Budget Route] Enhancing daily plans with preference-specific information');
          optimizationResult.schedule = enhanceDailyPlansWithPreferences(
            optimizationResult.schedule,
            {
              accessibility: req.body.preferences.accessibility,
              dietaryRestrictions: req.body.preferences.dietaryRestrictions,
              pacePreference: req.body.preferences.pacePreference
            }
          );
        }

        // Update daily plans with optimized schedule
        const updatedDailyPlans = optimizationResult.schedule.map(day => ({
          ...day,
          activities: day.activities?.map((activity) => {
            const enriched = enrichedActivities.find(
              (ea) => ea.name === activity.name && ea.dayNumber === day.dayNumber
            );
            return enriched || activity;
          }) || []
        })) || [];

        // Log the optimized plan to a file
        const logEntry = {
          timestamp: new Date().toISOString(),
          destination: transformedRequest.destinations[0].label,
          days: transformedRequest.days,
          input_activities: enrichedActivities.length,
          optimized_schedule: optimizationResult
        };

        const logDir = path.join(process.cwd(), 'logs');
        const logFile = path.join(logDir, 'optimized_plan.log');

        fs.appendFileSync(logFile, JSON.stringify(logEntry, null, 2) + '\n');
        logger.info(`Optimized plan logged to ${logFile}`);

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
              dailyPlans: updatedDailyPlans,
          tripOverview: optimizationResult.tripOverview || agentResult.tripSummary?.overview || 'Trip overview not available',
          activityFitNotes: optimizationResult.activityFitNotes || agentResult.organizationLogic?.overview || 'Activity fit notes not available',
          schedule: optimizationResult.schedule.map(day => {
            // Calculate the date for this day
            const startDate = new Date(transformedRequest.startDate);
            const dayDate = new Date(startDate);
            dayDate.setDate(startDate.getDate() + (day.dayNumber - 1));
            const date = dayDate.toISOString().split('T')[0];

                return {
                dayNumber: day.dayNumber,
              date,
              theme: day.theme || safelyCallHelper(generateDayTheme, [day.activities], 'generateDayTheme', 'Mixed Activities'),
              mainArea: day.mainArea || safelyCallHelper(determineMainArea, [day.activities], 'determineMainArea', 'City Center'),
              commentary: day.commentary || safelyCallHelper(generateDayCommentary, [day.activities, day.dayNumber], 'generateDayCommentary', ''),
              highlights: day.highlights || safelyCallHelper(generateDayHighlights, [day.activities, transformedRequest.preferences], 'generateDayHighlights', []),
              activities: day.activities.map(activity => ({
              ...activity,
                date,  // Ensure each activity has the correct date
                startTime: activity.startTime || getDefaultStartTime(activity.timeSlot)
            })).sort((a, b) => {
              if (a.startTime && b.startTime) {
                const [aHour, aMin] = a.startTime.split(':').map(Number);
                const [bHour, bMin] = b.startTime.split(':').map(Number);
                return (aHour * 60 + aMin) - (bHour * 60 + bMin);
              }
              return 0;
            }),
              breaks: day.breaks || safelyCallHelper(generateBreakSchedule, [day.activities, transformedRequest.preferences], 'generateBreakSchedule', {
              morning: { startTime: '10:30', endTime: '11:00', duration: 30, suggestion: 'Coffee break' },
              lunch: { startTime: '12:30', endTime: '13:30', duration: 60, suggestion: 'Lunch break' },
              afternoon: { startTime: '15:30', endTime: '16:00', duration: 30, suggestion: 'Rest break' },
              dinner: { startTime: '18:30', endTime: '20:00', duration: 90, suggestion: 'Dinner' }
            }),
              logistics: day.logistics || safelyCallHelper(generateLogistics, [day.activities, transformedRequest.preferences], 'generateLogistics', {
              transportSuggestions: ['Use public transportation between major attractions'],
              walkingDistances: ['Average walking distance between activities: 15-20 minutes'],
              timeEstimates: ['Allow 30 minutes for transportation between activities']
              }),
              availabilityStats: day.availabilityStats
            };
          }),
          dailyHighlights: optimizationResult.dailyHighlights || agentResult.dayHighlights || [],
          unscheduledActivities: optimizationResult.unscheduledActivities || [],
          statistics: optimizationResult.statistics || {
            totalScheduled: 0,
            totalUnscheduled: 0,
            scheduledByDay: []
          },
          totalBudget: transformedRequest.budget,
          // Add flights data to the response
          flights: {
            all: transformedRequest.flightData || [],
            stats: {
              totalFlights: transformedRequest.flightData?.length || 0,
              byClass: {
                economy: transformedRequest.flightData?.filter(f => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'ECONOMY').length || 0,
                premiumEconomy: transformedRequest.flightData?.filter(f => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'PREMIUM_ECONOMY').length || 0,
                business: transformedRequest.flightData?.filter(f => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'BUSINESS').length || 0,
                first: transformedRequest.flightData?.filter(f => 
                  f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'FIRST').length || 0
              }
            }
          },
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
          }
        } catch (error) {
          logger.error('[Budget Route] Error in budget agent:', error);
          throw error;
        }
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