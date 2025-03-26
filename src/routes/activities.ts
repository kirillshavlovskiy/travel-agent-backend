import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { ViatorService } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { Activity as BaseActivity } from '../types/activity';
import { PerplexityService } from '../services/perplexity.js';

const activitiesRouter = Router();

// Initialize Viator service
const viatorService = new ViatorService();

// Add counter at the top of the file
let perplexityCallCounter = 0;

// Extend the base Activity interface
interface Activity extends BaseActivity {
  id: string;
  name: string;
  description: string;
  category: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  dayNumber: number;
  startTime: string;
  duration: number;
  location: string;
  selected?: boolean;
  bookingDetails?: {
    provider: string;
    productCode: string;
    referenceUrl: string;
    cancellationPolicy?: string;
    instantConfirmation?: boolean;
    mobileTicket?: boolean;
    minParticipants?: number;
    maxParticipants?: number;
    [key: string]: any;
  };
  availability?: {
    isAvailable: boolean;
    availableTimeSlots: string[];
    operatingHours?: string;
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
    realTimeVerification: {
      verified: boolean;
      exactStartTimes: string[];
      lastChecked: string;
      pricing?: {
        fromPrice: number;
        currency: string;
      };
      reason?: string;
    };
    tripPeriodAvailability: {
      availableDates: string[];
      availabilityByDate: Record<string, string[]>;
      operatingDays: string[];
      operatingHours: Record<string, { opensAt: string; closesAt: string }[]>;
    };
    timesByCategory?: Record<string, string[]>;
  };
  price?: {
    amount: number;
    currency: string;
  };
  rating?: number;
  numberOfReviews?: number;
  highlights?: string[];
  enrichmentStatus?: 'success' | 'failed';
  enrichmentDuration?: number;
  [key: string]: any;
}

// Add new interface for activity scoring
interface ActivityScore {
  preferenceScore: number;
  matchedPreferences: string[];
  scoringReason: string;
}

// Add interface for preferences structure
interface TravelPreferences {
  travelStyle: string;
  pacePreference: string;
  interests: string[];
  accessibility: string[];
  dietaryRestrictions: string[];
}

// Add default preferences constant
const DEFAULT_PREFERENCES: TravelPreferences = {
  travelStyle: 'medium',
  pacePreference: 'moderate',
  interests: ['Cultural & Historical', 'Nature & Adventure'],
  accessibility: [],
  dietaryRestrictions: []
};

// Update validation function to use defaults
function validatePreferences(preferences: any): TravelPreferences {
  if (!preferences) {
    logger.warn('No preferences provided, using defaults');
    return DEFAULT_PREFERENCES;
  }
  
  // Create a new preferences object with defaults for missing fields
  const validatedPreferences: TravelPreferences = {
    travelStyle: typeof preferences.travelStyle === 'string' ? preferences.travelStyle : DEFAULT_PREFERENCES.travelStyle,
    pacePreference: typeof preferences.pacePreference === 'string' ? preferences.pacePreference : DEFAULT_PREFERENCES.pacePreference,
    interests: Array.isArray(preferences.interests) ? preferences.interests : DEFAULT_PREFERENCES.interests,
    accessibility: Array.isArray(preferences.accessibility) ? preferences.accessibility : DEFAULT_PREFERENCES.accessibility,
    dietaryRestrictions: Array.isArray(preferences.dietaryRestrictions) ? preferences.dietaryRestrictions : DEFAULT_PREFERENCES.dietaryRestrictions
  };

  logger.info('Using preferences:', validatedPreferences);
  return validatedPreferences;
}

// Add scoring calculation function
function calculateActivityScore(
  activity: any,
  preferences: TravelPreferences
): ActivityScore {
  let score = 0;
  const matchedPreferences: string[] = [];
  const scoringReasons: string[] = [];

  // Base score for having reviews
  if (activity.numberOfReviews > 50) {
    score += 1;
    scoringReasons.push('Well-reviewed activity');
  }

  // Score based on rating
  if (activity.rating) {
    if (activity.rating >= 4.5) {
      score += 2;
      scoringReasons.push('Highly rated');
    } else if (activity.rating >= 4.0) {
      score += 1;
      scoringReasons.push('Good rating');
    }
  }

  // Match interests
  preferences.interests.forEach((interest: string) => {
    const interestLower = interest.toLowerCase();
    if (
      activity.description?.toLowerCase().includes(interestLower) ||
      activity.category?.toLowerCase().includes(interestLower)
    ) {
      score += 1;
      matchedPreferences.push(interest);
      scoringReasons.push(`Matches ${interest} interest`);
    }
  });

  // Match travel style
  const price = activity.price?.amount || 0;
  const tier = price <= 50 ? 'budget' : price <= 150 ? 'medium' : 'premium';
  if (tier === preferences.travelStyle.toLowerCase()) {
    score += 1;
    matchedPreferences.push(`${preferences.travelStyle} travel style`);
    scoringReasons.push('Matches travel style preference');
  }

  // Match accessibility needs
  preferences.accessibility.forEach((need: string) => {
    if (activity.description?.toLowerCase().includes(need.toLowerCase())) {
      score += 1;
      matchedPreferences.push(need);
      scoringReasons.push(`Accommodates ${need}`);
    }
  });

  // Match dietary restrictions
  preferences.dietaryRestrictions.forEach((restriction: string) => {
    if (activity.description?.toLowerCase().includes(restriction.toLowerCase())) {
      score += 1;
      matchedPreferences.push(restriction);
      scoringReasons.push(`Suitable for ${restriction} diet`);
    }
  });

  return {
    preferenceScore: score,
    matchedPreferences,
    scoringReason: scoringReasons.join('. ')
  };
}

// Add deduplication function
function deduplicateActivities(activities: Activity[]): Activity[] {
      // Only deduplicate exact duplicates (same name AND product code)
      const seen = new Set<string>();
      const uniqueActivities = activities.filter(activity => {
        const key = `${activity.name}|${activity.bookingInfo?.productCode || ''}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      logger.info('Activities after deduplication:', {
        originalCount: activities.length,
        uniqueCount: uniqueActivities.length,
        removedCount: activities.length - uniqueActivities.length
      });

      return uniqueActivities;
}

// Update GroupedActivities interface
interface GroupedActivities {
  [key: number]: {
    morning: Activity[];
    afternoon: Activity[];
    evening: Activity[];
  };
}

// Add helper function to initialize day slots
function initializeDaySlots(days: number): GroupedActivities {
  const slots: Record<number, { morning: Activity[]; afternoon: Activity[]; evening: Activity[]; }> = {};
  for (let day = 1; day <= days; day++) {
    slots[day] = {
      morning: [],
      afternoon: [],
      evening: []
    };
  }
  return slots;
}

// Add interface for location validation
interface LocationValidationResult {
  isMatch: boolean;
  locationSources: string[];
  destinationParts: string[];
}

function validateLocation(bestMatch: any, destination: any): LocationValidationResult {
  const destinationName = (destination.label || destination).toLowerCase();
  const destinationParts = destinationName.split(/[,\s]+/)
    .filter((part: string) => part.length > 3)
    .map((part: string) => part.toLowerCase());

  const locationSources = [
    bestMatch.location?.address,
    bestMatch.location?.meetingPoint,
    bestMatch.location?.coordinates?.description,
    bestMatch.destinations?.[0]?.name,
    bestMatch.location?.description,
    bestMatch.title,
    bestMatch.description
  ].filter(Boolean).map((loc: string) => loc.toLowerCase());

  const descriptionLocations = bestMatch.description?.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)*)/g) || [];
  const extractedLocations = descriptionLocations.map((loc: string) => 
    loc.replace(/^(?:in|at|near|around)\s+/, '').toLowerCase()
  );

  const allLocationSources = [...new Set([...locationSources, ...extractedLocations])];

  const isLocationMatch = allLocationSources.some(loc => 
    destinationParts.some((part: string) => loc.includes(part))
  );

  return {
    isMatch: isLocationMatch,
    locationSources: allLocationSources,
    destinationParts
  };
}

// Update the activity grouping logic
function groupActivitiesByDayAndSlot(activities: Activity[], days: number): GroupedActivities {
  // Initialize the structure with all days and time slots
  const slots: GroupedActivities = {};
  for (let day = 1; day <= days; day++) {
    slots[day] = {
      morning: [],
      afternoon: [],
      evening: []
    };
  }
  
  // Group activities
  activities.forEach(activity => {
    const day = activity.dayNumber || 1;
    const slot = activity.timeSlot || 'morning';
    
    // Ensure the day and slot exist
    if (!slots[day]) {
      slots[day] = { morning: [], afternoon: [], evening: [] };
    }
    if (!slots[day][slot]) {
      slots[day][slot] = [];
    }
    
    slots[day][slot].push(activity);
  });
  
  return slots;
}

// Add interface for schedule
interface Schedule {
  dayNumber: number;
  theme: string;
  mainArea: string;
  commentary: string;
  highlights: string[];
  activities: Activity[];
  breaks: {
    morning: { startTime: string; endTime: string; duration: number; suggestion: string };
    lunch: { startTime: string; endTime: string; duration: number; suggestion: string };
    afternoon: { startTime: string; endTime: string; duration: number; suggestion: string };
    dinner: { startTime: string; endTime: string; duration: number; suggestion: string };
  };
  logistics: {
    transportSuggestions: string[];
    walkingDistances: string[];
    timeEstimates: string[];
  };
  availabilityStats: {
    verifiedActivities: number;
    totalActivities: number;
    realTimeAvailabilityRate: string;
  };
}

interface OptimizedSchedule {
  schedule: Schedule[];
  dailyHighlights: Array<{
    dayNumber: number;
    theme: string;
    highlights: string[];
  }>;
  tripOverview: string;
}

// Update the schedule creation function
function createBasicSchedule(activities: Activity[], days: number): OptimizedSchedule {
  const groupedActivities = groupActivitiesByDayAndSlot(activities, days);
  const schedule: Schedule[] = [];
  const preselectedByDay = new Map<number, Activity[]>();
  const unselectedActivities = activities.filter(a => !a.selected);

  // First, group preselected activities by day
  activities.filter(a => a.selected).forEach(activity => {
    if (!preselectedByDay.has(activity.dayNumber)) {
      preselectedByDay.set(activity.dayNumber, []);
    }
    preselectedByDay.get(activity.dayNumber)?.push(activity);
  });

  // Calculate how many additional activities we need per day
  const targetActivitiesPerDay = 3; // morning, afternoon, evening

  for (let day = 1; day <= days; day++) {
    const preselectedForDay = preselectedByDay.get(day) || [];
    const preselectedTimeSlots = new Set(preselectedForDay.map(a => a.timeSlot));
    
    // Calculate how many more activities we need for this day
    const neededActivities = targetActivitiesPerDay - preselectedForDay.length;
    
    // Get available time slots for this day
    const availableTimeSlots = ['morning', 'afternoon', 'evening'].filter(
      (slot): slot is 'morning' | 'afternoon' | 'evening' => !preselectedTimeSlots.has(slot as any)
    );

    // Select additional activities for available time slots
    const additionalActivities = unselectedActivities
      .filter(activity => !activity.selected && activity.availability?.realTimeVerification?.exactStartTimes?.length > 0)
      .slice(0, neededActivities)
      .map((activity, index) => {
        const timeSlot = availableTimeSlots[index] || 'morning';
        const availableTimes = activity.availability?.realTimeVerification?.exactStartTimes || [];
        const timesByCategory = activity.availability?.timesByCategory || {};
        
        // Get available times for the desired time slot
        const slotTimes = timesByCategory[timeSlot] || [];
        
        // If no times available for desired slot, try to find times in other slots
        if (slotTimes.length === 0) {
          logger.warn(`No available times found for ${activity.name} in slot ${timeSlot}, skipping activity`);
          return null;
        }

        // Select the first available time for the slot
        const startTime = slotTimes[0];

        return {
          ...activity,
          timeSlot,
          startTime,
          dayNumber: day,
          availability: {
            ...activity.availability,
            isAvailable: true,
            availableTimeSlots: Object.keys(timesByCategory).filter(slot => timesByCategory[slot].length > 0),
            exactStartTimes: availableTimes,
            timesByCategory,
            realTimeVerification: {
              verified: true,
              exactStartTimes: availableTimes,
              lastChecked: new Date().toISOString()
            }
          }
        };
      })
      .filter((activity): activity is Activity => activity !== null);

    const dayActivities = [...preselectedForDay, ...additionalActivities];

    // Only add the day to schedule if it has activities with real availability
    if (dayActivities.length > 0) {
      schedule.push({
        dayNumber: day,
        theme: `Day ${day} Exploration`,
        mainArea: determineMainArea(dayActivities),
        commentary: generateDayCommentary(dayActivities, day),
        highlights: generateDayHighlights(dayActivities, {}),
        activities: dayActivities,
        breaks: generateBreakSchedule(dayActivities, {}),
        logistics: generateLogistics(dayActivities, {}),
        availabilityStats: calculateAvailabilityStats(dayActivities)
      });
    }
  }

  return {
    schedule,
    dailyHighlights: schedule.map(day => ({
      dayNumber: day.dayNumber,
      theme: day.theme,
      highlights: day.highlights
    })),
    tripOverview: 'Schedule created with verified real-time availability'
  };
}

// Update the OptimizedSchedule interface first
interface OptimizedSchedule {
  schedule: Array<{
    dayNumber: number;
    theme: string;
    mainArea: string;
    commentary: string;
    highlights: string[];
    activities: Array<{
      id: string;
      name: string;
      description: string;
      timeSlot: string;
      startTime: string;
      duration: number;
      category: string;
      location: string;
      bookingDetails?: any;
    }>;
    breaks: {
      morning: { startTime: string; endTime: string; duration: number; suggestion: string };
      lunch: { startTime: string; endTime: string; duration: number; suggestion: string };
      afternoon: { startTime: string; endTime: string; duration: number; suggestion: string };
      dinner: { startTime: string; endTime: string; duration: number; suggestion: string };
    };
    logistics: {
      transportSuggestions: string[];
      walkingDistances: string[];
      timeEstimates: string[];
    };
    availabilityStats: {
      verifiedActivities: number;
      totalActivities: number;
      realTimeAvailabilityRate: string;
    };
  }>;
  dailyHighlights: Array<{
    dayNumber: number;
    theme: string;
    highlights: string[];
  }>;
  tripOverview: string;
}

// Add function to log optimized schedule
function logOptimizedSchedule(schedule: any[], destination: string, days: number) {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'optimized_plan.log');
    const timestamp = new Date().toISOString();

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = {
      timestamp,
      destination,
      days,
      optimization_results: {
        input_activities: schedule.reduce((sum, day) => sum + (day.activities?.length || 0), 0),
        daily_breakdown: schedule.map(day => ({
          dayNumber: day.dayNumber || 0,
          theme: day.theme || 'Unspecified Theme',
          mainArea: day.mainArea || 'City Center',
          planningLogic: day.planningLogic || "15-30 minutes buffer between activities",
          activities: (day.activities || []).map((activity: any) => ({
            name: activity.name,
            description: activity.description,
            category: activity.category,
            timeSlot: activity.timeSlot,
            dayNumber: activity.dayNumber,
            duration: activity.duration,
            price: activity.price,
            location: activity.location,
            rating: activity.rating,
            numberOfReviews: activity.numberOfReviews,
            bookingDetails: activity.bookingDetails,
            availability: {
              isAvailable: activity.availability?.isAvailable || false,
              availableTimeSlots: activity.availability?.availableTimeSlots || [],
              exactStartTimes: activity.availability?.realTimeVerification?.exactStartTimes || [],
              timesByCategory: activity.availability?.timesByCategory || {
                morning: [],
                afternoon: [],
                evening: []
              },
              realTimeVerification: {
                verified: activity.availability?.realTimeVerification?.verified || false,
                exactStartTimes: activity.availability?.realTimeVerification?.exactStartTimes || [],
                lastChecked: activity.availability?.realTimeVerification?.lastChecked || timestamp,
                reason: activity.availability?.realTimeVerification?.reason
              }
            }
          })),
          breaks: day.breaks || {
            morning: { startTime: "", endTime: "", duration: 0, suggestion: "" },
            lunch: { startTime: "", endTime: "", duration: 0, suggestion: "" },
            afternoon: { startTime: "", endTime: "", duration: 0, suggestion: "" },
            dinner: { startTime: "", endTime: "", duration: 0, suggestion: "" }
          },
          logistics: day.logistics || {
            transportSuggestions: [],
            walkingDistances: [],
            timeEstimates: []
          },
          commentary: day.commentary || 'No commentary available',
          highlights: day.highlights || [],
          dailyStats: {
            totalDuration: (day.activities || []).reduce((sum: number, a: any) => sum + (a.duration || 0), 0),
            averageRating: ((day.activities || []).reduce((sum: number, a: any) => sum + (a.rating || 0), 0) / (day.activities?.length || 1)).toFixed(2),
            categoryDistribution: (day.activities || []).reduce((acc: any, a: any) => {
              acc[a.category || 'unspecified'] = (acc[a.category || 'unspecified'] || 0) + 1;
              return acc;
            }, {}),
            preferenceMatchRate: `${(((day.activities || []).filter((a: any) => a.matchedPreferences?.length > 0).length / (day.activities?.length || 1)) * 100).toFixed(1)}%`
          }
        }))
      }
    };

    // Append to log file instead of overwriting
    const logString = JSON.stringify(logEntry, null, 2) + '\n---\n';
    fs.appendFileSync(logFile, logString);

    // Log concise summary to console
    logger.info('[Schedule Optimization] Results:', {
      timestamp,
      destination,
      days,
      total_activities: logEntry.optimization_results.input_activities,
      daily_breakdown: logEntry.optimization_results.daily_breakdown.map(day => ({
        dayNumber: day.dayNumber,
        activities: day.activities.length,
        highlights: day.highlights
      }))
    });
  } catch (error) {
    logger.error('[Schedule Optimization] Failed to log schedule:', error);
  }
}

// Add at the top of the file after imports
interface GeographicCluster {
  name: string;
  activities: Activity[];
  score: number;
}

interface ActivityWithScore extends Activity {
  preferenceScore?: number;
  geographicCluster?: GeographicCluster;
  categoryBalance?: {
    category: string;
    count: number;
    ratio: number;
  };
  assigned?: boolean;
}

// Helper functions for schedule generation
export function generateDayTheme(activities: Activity[], preferences: any): string {
  const categories = activities.map(a => a.category).filter(Boolean);
  const mainCategory = mode(categories);
  const style = preferences?.travelStyle || 'balanced';
  return `${style.charAt(0).toUpperCase() + style.slice(1)} ${mainCategory} Exploration Day`;
}

export function generateDayCommentary(activities: Activity[], dayNumber: number): string {
  if (!Array.isArray(activities)) {
    logger.warn('[Schedule] Invalid activities array in generateDayCommentary', {
      dayNumber,
      receivedType: typeof activities,
      activities
    });
    return `Day ${dayNumber} activities`;
  }

  const sortedActivities = activities.sort((a, b) => {
    const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
    return timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
  });

  const timeSlots = {
    morning: sortedActivities.filter(a => a.timeSlot === 'morning'),
    afternoon: sortedActivities.filter(a => a.timeSlot === 'afternoon'),
    evening: sortedActivities.filter(a => a.timeSlot === 'evening')
  };

  const parts = [];

  if (timeSlots.morning.length > 0) {
    parts.push(`Start your day with ${timeSlots.morning.map(a => a.name).join(' and ')}`);
  }

  if (timeSlots.afternoon.length > 0) {
    parts.push(`continue with ${timeSlots.afternoon.map(a => a.name).join(' and ')}`);
  }

  if (timeSlots.evening.length > 0) {
    parts.push(`end your day experiencing ${timeSlots.evening.map(a => a.name).join(' and ')}`);
  }

  return parts.join(' ');
}

export function generateDayHighlights(activities: Activity[], preferences: any): string[] {
  const highlights = [];
  
  // Geographic organization
  const areas = [...new Set(activities.map(a => a.location))].filter(Boolean);
  if (areas.length > 1) {
    highlights.push(`Efficiently organized route through ${areas.join(' → ')}`);
  }

  // Activity highlights with preference matching
  activities.forEach(activity => {
    const matchedPreferences = preferences?.interests?.filter(
      (interest: string) => activity.category.toLowerCase().includes(interest.toLowerCase())
    ) || [];
    
    const highlight = `${activity.timeSlot.charAt(0).toUpperCase() + activity.timeSlot.slice(1)}: ` +
      `${activity.name} (${activity.duration} mins) - ` +
      `${matchedPreferences.length ? `Matches your ${matchedPreferences.join(', ')} interests` : 'General interest'}`;
    
    highlights.push(highlight);
  });

  return highlights;
}

export function generateBreakSchedule(activities: Activity[], preferences: any): any {
  const paceAdjustment = preferences?.pacePreference === 'relaxed' ? 30 : 
                        preferences?.pacePreference === 'intense' ? -15 : 0;

  return {
    morning: { 
      startTime: "10:30", 
      endTime: "11:00", 
      duration: 30 + paceAdjustment, 
      suggestion: `Coffee break with ${preferences?.travelStyle || 'local'} ambiance` 
    },
    lunch: { 
      startTime: "12:30", 
      endTime: "13:30", 
      duration: 60 + paceAdjustment, 
      suggestion: preferences?.dietaryRestrictions?.length ? 
        `Lunch break (${preferences.dietaryRestrictions.join(', ')} options available)` : 
        "Lunch break at local restaurant" 
    },
    afternoon: { 
      startTime: "15:30", 
      endTime: "16:00", 
      duration: 30 + paceAdjustment, 
      suggestion: "Rest and refresh" 
    },
    dinner: { 
      startTime: "18:30", 
      endTime: "20:00", 
      duration: 90 + paceAdjustment, 
      suggestion: preferences?.interests?.includes('Food & Wine') ? 
        "Culinary experience dinner" : "Dinner break" 
    }
  };
}

export function generateLogistics(activities: Activity[], preferences: any): any {
  const areas = [...new Set(activities.map(a => a.location))].filter(Boolean);
  const accessibilityNeeds = preferences?.accessibility || [];
  
  return {
    transportSuggestions: [
      `Optimal route connecting ${areas.join(' → ')}`,
      ...accessibilityNeeds.map((need: string) => `${need} friendly transportation options available`),
      "Public transport and walking combinations"
    ].filter(Boolean),
    walkingDistances: [
      `Distances optimized for ${preferences?.pacePreference || 'moderate'} pace`,
      `Major segments: ${activities.map(a => a.location).join(' → ')}`
    ],
    timeEstimates: [
      "15-30 minutes buffer between activities",
      `Adjusted for ${preferences?.pacePreference || 'moderate'} pace preference`,
      ...accessibilityNeeds.map((need: string) => `Extra time allocated for ${need} accessibility`)
    ].filter(Boolean)
  };
}

export async function optimizeSchedule(
  activities: Activity[] | EnrichedActivityResult[],
  days: number,
  destination: string,
  preferences?: any
): Promise<OptimizedSchedule> {
  try {
    logger.info('[Schedule Optimization] Starting schedule optimization', {
      totalActivities: activities.length,
      days,
      destination,
      preferences
    });

    // Create a copy of activities to work with
    let remainingActivities = activities.map(activity => ({
      ...activity,
      location: activity.location || destination || 'City Center',
      // Ensure all required fields are present
      id: activity.id || activity.bookingDetails?.productCode || `local-${activity.name}-${activity.dayNumber}`,
      name: activity.name || `${activity.category} Experience`,
      duration: activity.duration,
      category: activity.category,
      timeSlot: activity.timeSlot,
      startTime: activity.startTime,
      selected: activity.selected,
      description: activity.description || `Explore the city at your own pace`,
      price: activity.price,
      rating: activity.rating || 0,
      numberOfReviews: activity.numberOfReviews || 0,
      bookingDetails: activity.bookingDetails,
      dayNumber: activity.dayNumber,
      // Preserve enrichment data
      enrichmentStatus: activity.enrichmentStatus,
      enrichmentDuration: activity.enrichmentDuration,
      availability: activity.availability,
      commentary: generateDayCommentary(activity, activity.dayNumber || 1),
      highlights: activity.highlights || [],
      // Additional fields
      coordinates: activity.coordinates,
      order: activity.order
    }));

    // Initialize schedule array for each day
    const schedule = Array.from({ length: days }, (_, i) => {
      const dayNumber = i + 1;
      
      // Get activities for this day
      const dayActivities = remainingActivities.filter(activity => 
        activity.dayNumber === dayNumber
      );

      // Generate theme and other day-specific data
      const theme = generateDayTheme(dayActivities, preferences);
      const mainArea = determineMainArea(dayActivities);
      const breaks = generateBreakSchedule(dayActivities, preferences);
      const logistics = generateLogistics(dayActivities, preferences);
      const commentary = generateDayCommentary(dayActivities, dayNumber);
      const highlights = generateDayHighlights(dayActivities, preferences);

      return {
        dayNumber,
        theme,
        mainArea,
        activities: dayActivities,
        breaks,
        logistics,
        commentary,
        highlights
      };
    });

    // Log optimization results
    logger.info('[Schedule Optimization] Completed schedule optimization', {
      totalDays: schedule.length,
      totalActivities: schedule.reduce((sum, day) => sum + day.activities.length, 0),
      activitiesByDay: schedule.map(day => ({
        dayNumber: day.dayNumber,
        activityCount: day.activities.length,
        theme: day.theme
      }))
    });

    return {
      schedule,
      dailyHighlights: schedule.map(day => ({
        dayNumber: day.dayNumber,
        theme: day.theme,
        highlights: day.highlights
      })),
      tripOverview: generateTripOverview(schedule, destination)
    };
  } catch (error) {
    logger.error('[Schedule Optimization] Error:', error);
    throw error;
  }
}

function determineTimeSlot(index: number): string {
  switch(index) {
    case 0: return 'morning';
    case 1: return 'afternoon';
    case 2: return 'evening';
    default: return 'morning';
  }
}

function determineStartTime(timeSlot: string, activity: Activity): string | null {
  if (!activity.availability?.realTimeVerification?.exactStartTimes) {
    return null;
  }

  const timesByCategory = activity.availability.timesByCategory || {};
  const slotTimes = timesByCategory[timeSlot] || [];
  
  if (slotTimes.length === 0) {
    return null;
  }

  return slotTimes[0];
}

function calculateAvailabilityStats(activities: Activity[]): any {
  return {
    verifiedActivities: activities.filter(a => a.availability?.isAvailable && a.bookingDetails?.productCode).length,
    totalActivities: activities.length,
    realTimeAvailabilityRate: `${((activities.filter(a => a.availability?.isAvailable).length / activities.length) * 100).toFixed(1)}%`
  };
}

function generateTripOverview(schedule: any[], destination: string): string {
  const totalActivities = schedule.reduce((sum, day) => sum + day.activities.length, 0);
  const days = schedule.length;
  return `${days}-day trip to ${destination} featuring ${totalActivities} activities evenly distributed across all days`;
}

function mode(arr: string[]): string {
  return arr.sort((a,b) =>
    arr.filter(v => v === a).length - arr.filter(v => v === b).length
  ).pop() || '';
}

// Update the activity mapping in the enrichment process
interface EnrichedActivityResult {
  name: string;
  description: string;
  bookingDetails?: {
    provider: string;
    productCode: string;
    referenceUrl: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// Add type for the activity parameter in the map function
interface ActivityToProcess {
  name: string;
  description?: string;
  timeSlot?: string;
  dayNumber?: number;
  selected?: boolean;
  [key: string]: any;
}

// Add function to clean JSON response
function cleanPerplexityResponse(response: string): string {
  // Remove markdown code blocks if present
  let cleaned = response.replace(/```json\n|\n```/g, '');
  
  // Remove any comments (both # and //)
  cleaned = cleaned.replace(/\s*#.*$/gm, '');
  cleaned = cleaned.replace(/\s*\/\/.*$/gm, '');
  
  // Remove any trailing commas before closing brackets/braces
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  
  return cleaned;
}

// Add interface for Viator availability schedule
interface ViatorAvailabilitySchedule {
  extractedTimeSlots?: string[];
  extractedDaysOfWeek?: string[];
  extractedOperatingHours?: Record<string, { opensAt: string; closesAt: string }[]>;
  extractedUnavailableDates?: string[];
  extractedPricing?: {
    amount: number;
    currency: string;
  };
  extractedBookingInfo?: {
    cancellationPolicy?: string;
    confirmationType?: 'INSTANT' | 'MANUAL';
    mobileTicketing?: boolean;
    minParticipants?: number;
    maxParticipants?: number;
  };
}

// Update enrichActivity function signature
async function enrichActivity(activity: Activity, destination: string): Promise<Activity> {
  logger.info(`[Activity] Enriching activity:`, {
    name: activity.name,
    destination
  });

  try {
    const destinationId = await viatorService.getDestinationId(destination);
    if (!destinationId) {
      throw new Error(`Could not find destination ID for: ${destination}`);
    }

    logger.info(`[Activity] Found destination ID for ${destination}:`, {
      destinationId,
      activityName: activity.name
    });

    const searchResults = await viatorService.searchActivity(activity.name, destinationId);
    if (!searchResults || searchResults.length === 0) {
      throw new Error(`No Viator activities found for: ${activity.name} in ${destination}`);
    }

    const bestMatch = searchResults[0];
    const locationValidation = validateLocation(bestMatch, destination);
    if (!locationValidation.isMatch) {
      throw new Error(`Location mismatch for activity: ${activity.name}. Expected: ${destination}, Found: ${locationValidation.locationSources.join(', ')}`);
    }

    const productCode = bestMatch.productCode;
    if (!productCode) {
      throw new Error(`No product code found for activity: ${activity.name}`);
    }

    const availabilitySchedule = await viatorService.getAvailabilitySchedule(productCode);
    const referenceUrl = `https://www.viator.com/tours/${destination.replace(/\s+/g, '-')}/${productCode}`;

    const enrichedActivity: Activity = {
      ...activity,
      location: destination,
      productCode,
      bookingDetails: {
        provider: 'Viator',
        productCode,
        referenceUrl,
        cancellationPolicy: availabilitySchedule.extractedBookingInfo?.cancellationPolicy,
        instantConfirmation: availabilitySchedule.extractedBookingInfo?.confirmationType === 'INSTANT',
        mobileTicket: availabilitySchedule.extractedBookingInfo?.mobileTicketing,
        minParticipants: availabilitySchedule.extractedBookingInfo?.minParticipants,
        maxParticipants: availabilitySchedule.extractedBookingInfo?.maxParticipants
      },
      availability: {
        isAvailable: availabilitySchedule.extractedTimeSlots?.length > 0 || false,
        availableTimeSlots: availabilitySchedule.extractedTimeSlots || [],
        operatingHours: availabilitySchedule.extractedOperatingHours 
          ? Object.entries(availabilitySchedule.extractedOperatingHours)
              .map(([day, hours]) => `${day}: ${hours.map(h => `${h.opensAt}-${h.closesAt}`).join(', ')}`)
              .join('; ')
          : undefined,
        realTimeVerification: {
          verified: true,
          exactStartTimes: availabilitySchedule.extractedTimeSlots || [],
          lastChecked: new Date().toISOString()
        },
        tripPeriodAvailability: {
          availableDates: availabilitySchedule.extractedDaysOfWeek || [],
          availabilityByDate: {
            [activity.date || new Date().toISOString().split('T')[0]]: 
              availabilitySchedule.extractedTimeSlots || []
          },
          operatingDays: availabilitySchedule.extractedDaysOfWeek || [],
          operatingHours: availabilitySchedule.extractedOperatingHours || {}
        },
        timesByCategory: {
          morning: availabilitySchedule.extractedTimeSlots?.filter(time => {
            const hour = parseInt(time.split(':')[0]);
            return hour >= 9 && hour < 13;
          }) || [],
          afternoon: availabilitySchedule.extractedTimeSlots?.filter(time => {
            const hour = parseInt(time.split(':')[0]);
            return hour >= 13 && hour < 18;
          }) || [],
          evening: availabilitySchedule.extractedTimeSlots?.filter(time => {
            const hour = parseInt(time.split(':')[0]);
            return hour >= 18;
          }) || []
        }
      },
      price: {
        amount: availabilitySchedule.extractedPricing?.amount || activity.price?.amount || 0,
        currency: availabilitySchedule.extractedPricing?.currency || activity.price?.currency || 'USD'
      },
      enrichmentStatus: 'success',
      enrichmentDuration: Date.now() - new Date(activity.enrichmentStartTime || Date.now()).getTime()
    };

    return enrichedActivity;

  } catch (error) {
    logger.error(`[Activity] Error enriching activity:`, {
      name: activity.name,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return {
      ...activity,
      enrichmentStatus: 'failed',
      availability: {
        isAvailable: false,
        availableTimeSlots: [],
        realTimeVerification: {
          verified: false,
          exactStartTimes: [],
          lastChecked: new Date().toISOString()
        },
        tripPeriodAvailability: {
          availableDates: [],
          availabilityByDate: {},
          operatingDays: [],
          operatingHours: {}
        },
        timesByCategory: {
          morning: [],
          afternoon: [],
          evening: []
        }
      }
    };
  }
}

// Add at the top of the file after imports
interface PerplexityMetrics {
  totalCalls: number;
  totalTokens: number;
  lastCallTimestamp: string;
}

// Add after the perplexityCallCounter
let perplexityMetrics: PerplexityMetrics = {
  totalCalls: 0,
  totalTokens: 0,
  lastCallTimestamp: new Date().toISOString()
};

export function determineMainArea(activities: Activity[]): string {
  if (!activities || activities.length === 0) {
    return 'City Center';
  }

  // Count occurrences of each area
  const areaCount = activities.reduce((count, activity) => {
    const area = activity.location?.split(',')[0]?.trim() || 'City Center';
    count[area] = (count[area] || 0) + 1;
    return count;
  }, {} as Record<string, number>);

  // Find the area with the most activities
  const mainArea = Object.entries(areaCount)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([area]) => area)[0] || 'City Center';

  return mainArea;
}

// Helper function to get default start time for a time slot
function getDefaultStartTime(timeSlot: string): string {
  const defaultTimes = {
    morning: '09:00',
    afternoon: '14:00',
    evening: '19:00'
  };
  return defaultTimes[timeSlot as keyof typeof defaultTimes] || '09:00';
}

// Add interface for request body
interface GenerateActivitiesRequest {
  departureLocation: {
    code: string;
    label: string;
  };
  destinations: Array<{
    code: string;
    label: string;
    cityName?: string;
  }>;
  startDate: string;
  endDate: string;
  travelers: number;
  currency: string;
  budgetLimit: number;
  preferences: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  };
}

// Update route handler
activitiesRouter.post('/generate', async (req: Request<{}, {}, GenerateActivitiesRequest>, res: Response) => {
  try {
    const {
      departureLocation,
      destinations,
      startDate,
      endDate,
      travelers,
      currency,
      budgetLimit,
      preferences
    } = req.body;

    // Validate required parameters
    if (!destinations || !destinations.length || !destinations[0].code) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: {
          destinations: !destinations ? 'Missing destinations' : 'Invalid destination format'
        }
      });
    }

    // Use cityName from the transformed request
    const cityName = destinations[0].cityName || destinations[0].label.split(',')[0].trim();

    // Generate activities with clean city name
    const perplexityService = new PerplexityService();
    const result = await perplexityService.generateActivities({
      departureLocation,
      destinations: [{
        ...destinations[0],
        label: cityName // Use clean city name for activities
      }],
      startDate,
      endDate,
      travelers,
      currency,
      budgetLimit,
      preferences
    });

    // Enrich activities with clean city name
    const enrichedActivities = await Promise.all(
      result.activities.map((activity: Activity) => 
        enrichActivity(activity, cityName)
      )
    );

    // Optimize schedule with clean city name
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    const optimizedSchedule = await optimizeSchedule(
      enrichedActivities,
      days,
      cityName,
      preferences
    );

    // Log with clean city name and full label for reference
    logOptimizedSchedule(optimizedSchedule.schedule, cityName, days);

    return res.json({
      success: true,
      data: {
        activities: enrichedActivities,
        schedule: optimizedSchedule.schedule,
        dailyHighlights: optimizedSchedule.dailyHighlights,
        tripOverview: optimizedSchedule.tripOverview,
        destination: {
          cityName: cityName,
          fullLabel: destinations[0].label
        }
      }
    });

  } catch (error) {
    logger.error('[Activities] Generation failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to generate activities',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add interface for availability request
interface AvailabilityRequest {
  date: string;
}

// Update availability check endpoint
activitiesRouter.post('/availability/:productCode', async (req: Request<{productCode: string}, {}, AvailabilityRequest>, res: Response) => {
  const { productCode } = req.params;
  const { date } = req.body;

  try {
    if (!productCode) {
      return res.status(400).json({
        error: 'Product code is required'
      });
    }

    if (!date) {
      return res.status(400).json({
        error: 'Date is required'
      });
    }

    // Get the general availability schedule
    const availabilitySchedule = await viatorService.getAvailabilitySchedule(productCode);

    // Extract operating days and hours
    const operatingDays = availabilitySchedule.extractedDaysOfWeek || [];
    const operatingHours = availabilitySchedule.extractedOperatingHours || {};
    const timeSlots = availabilitySchedule.extractedTimeSlots || [];
    const unavailableDates = availabilitySchedule.extractedUnavailableDates || [];

    return res.json({
      operatingDays,
      operatingHours,
      timeSlots,
      unavailableDates,
      pricing: availabilitySchedule.extractedPricing
    });
  } catch (error) {
    logger.error('[Activities] Error checking availability:', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return res.status(500).json({
      error: 'Failed to check availability',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { activitiesRouter };