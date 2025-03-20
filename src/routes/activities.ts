import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { ViatorService } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { Activity } from '../types/activity';
import { PerplexityService } from '../services/perplexity.js';

const activitiesRouter = Router();

// Initialize Viator service
const viatorService = new ViatorService();

// Add counter at the top of the file
let perplexityCallCounter = 0;

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

// Update Activity interface
interface Activity {
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
  };
  price?: {
    amount: number;
    currency: string;
  };
  rating?: number;
  numberOfReviews?: number;
  highlights?: string[];
  [key: string]: any;
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
  const slots = {};
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

// Add function for location validation
function validateLocation(bestMatch: any, destination: any): LocationValidationResult {
  const destinationName = (destination.label || destination).toLowerCase();
  const destinationParts = destinationName.split(/[,\s]+/)
    .filter((part: string) => part.length > 3) // Filter out short words and airport codes
    .map((part: string) => part.toLowerCase());

  // Get all possible location fields from the best match
  const locationSources = [
    bestMatch.location?.address,
    bestMatch.location?.meetingPoint,
    bestMatch.location?.coordinates?.description,
    bestMatch.destinations?.[0]?.name,
    bestMatch.location?.description,
    bestMatch.title,
    bestMatch.description
  ].filter(Boolean).map((loc: string) => loc.toLowerCase());

  // Extract location mentions from description
  const descriptionLocations = bestMatch.description?.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)*)/g) || [];
  const extractedLocations = descriptionLocations.map((loc: string) => 
    loc.replace(/^(?:in|at|near|around)\s+/, '').toLowerCase()
  );

  const allLocationSources = [...new Set([...locationSources, ...extractedLocations])];

  // Check if any location source contains any part of the destination
  const isLocationMatch = allLocationSources.some(loc => 
    destinationParts.some(part => loc.includes(part))
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

// Update the schedule creation to use the new grouping
function createBasicSchedule(activities: Activity[], days: number) {
  const groupedActivities = groupActivitiesByDayAndSlot(activities, days);
  const schedule = [];
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
      slot => !preselectedTimeSlots.has(slot)
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
      .filter(Boolean); // Remove null activities

    const dayActivities = [...preselectedForDay, ...additionalActivities];

    // Only add the day to schedule if it has activities with real availability
    if (dayActivities.length > 0) {
      schedule.push({
        dayNumber: day,
        theme: `Day ${day} Exploration`,
        mainArea: determineMainArea(dayActivities),
        commentary: generateDayCommentary(dayActivities, {}, day),
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
    tripOverview: 'Schedule created with verified real-time availability',
    activityFitNotes: 'Activities arranged based on actual available time slots'
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
      input_activities: schedule.reduce((sum, day) => sum + day.activities.length, 0),
      daily_breakdown: schedule.map(day => ({
        dayNumber: day.dayNumber,
        theme: day.theme,
        mainArea: day.mainArea,
        planningLogic: day.planningLogic || "15-30 minutes buffer between activities",
        activities: day.activities.map((activity: any) => ({
          ...activity,
          // Ensure we use the enriched availability data
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
            },
            timeSlotVerification: {
              requestedSlot: activity.timeSlot,
              availableSlots: activity.availability?.availableTimeSlots || [],
              realTimeVerification: activity.availability?.realTimeVerification || {}
            }
          }
        })),
        breaks: day.breaks,
        logistics: day.logistics,
        commentary: day.commentary,
        highlights: day.highlights,
        dailyStats: {
          totalDuration: day.activities.reduce((sum: number, a: any) => sum + (a.duration || 0), 0),
          averageRating: (day.activities.reduce((sum: number, a: any) => sum + (a.rating || 0), 0) / day.activities.length).toFixed(2),
          categoryDistribution: day.activities.reduce((acc: any, a: any) => {
            acc[a.category] = (acc[a.category] || 0) + 1;
            return acc;
          }, {}),
          preferenceMatchRate: `${((day.activities.filter((a: any) => a.matchedPreferences?.length > 0).length / day.activities.length) * 100).toFixed(1)}%`
        }
      })),
      schedule_metrics: {
        total_activities: schedule.reduce((sum, day) => sum + day.activities.length, 0),
        activities_by_category: schedule.reduce((acc: any, day) => {
          day.activities.forEach((a: any) => {
            acc[a.category] = (acc[a.category] || 0) + 1;
          });
          return acc;
        }, {}),
        activities_by_tier: schedule.reduce((acc: any, day) => {
          day.activities.forEach((a: any) => {
            acc[a.tier || 'unspecified'] = (acc[a.tier || 'unspecified'] || 0) + 1;
          });
          return acc;
        }, {}),
        enrichment_rate: `${((schedule.reduce((sum, day) => 
          sum + day.activities.filter((a: any) => a.availability?.realTimeVerification?.verified).length, 0) / 
          schedule.reduce((sum, day) => sum + day.activities.length, 0)) * 100).toFixed(1)}%`,
        preference_match_rate: `${((schedule.reduce((sum, day) => 
          sum + day.activities.filter((a: any) => a.matchedPreferences?.length > 0).length, 0) / 
          schedule.reduce((sum, day) => sum + day.activities.length, 0)) * 100).toFixed(1)}%`,
        average_rating: (schedule.reduce((sum, day) => 
          sum + day.activities.reduce((daySum: number, a: any) => daySum + (a.rating || 0), 0), 0) / 
          schedule.reduce((sum, day) => sum + day.activities.length, 0)).toFixed(2)
      },
      validation: {
        all_days_have_activities: schedule.every(day => day.activities.length > 0),
        activity_distribution_valid: schedule.every(day => {
          const activitiesBySlot = {
            morning: day.activities.filter((a: any) => a.timeSlot === 'morning').length,
            afternoon: day.activities.filter((a: any) => a.timeSlot === 'afternoon').length,
            evening: day.activities.filter((a: any) => a.timeSlot === 'evening').length
          };
          return Object.values(activitiesBySlot).every(count => count >= 1 && count <= 2) &&
                 day.activities.length <= 6;
        }),
        all_activities_have_required_fields: schedule.every(day => 
          day.activities.every((a: any) => 
            a.name && a.timeSlot && a.startTime && a.duration && a.location
          )
        ),
        all_activities_have_booking_details: schedule.every(day =>
          day.activities.every((a: any) => !!a.bookingDetails?.referenceUrl)
        ),
        all_activities_have_availability: schedule.every(day =>
          day.activities.every((a: any) => !!a.availability?.isAvailable)
        ),
        time_slot_verification: schedule.every(day =>
          day.activities.every((a: any) => 
            a.availability?.verifiedTimeSlot === a.timeSlot ||
            a.availability?.availableTimeSlots?.includes(a.timeSlot)
          )
        )
      }
    }
  };

  // Write detailed log to file
  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2));

  // Log concise summary to console
  logger.info('[Schedule Optimization] Results:', {
    timestamp,
    destination,
    days,
    summary: {
      total_activities: logEntry.optimization_results.schedule_metrics.total_activities,
      enrichment_rate: logEntry.optimization_results.schedule_metrics.enrichment_rate,
      preference_match_rate: logEntry.optimization_results.schedule_metrics.preference_match_rate,
      average_rating: logEntry.optimization_results.schedule_metrics.average_rating,
      validation: logEntry.optimization_results.validation
    }
  });
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

export function generateDayCommentary(activities: Activity[], preferences: any, dayNumber: number): string {
  const areas = [...new Set(activities.map(a => a.location))].filter(Boolean);
  const mainInterests = preferences?.interests || [];
  const matchedInterests = activities
    .filter(a => mainInterests.some(i => a.category.toLowerCase().includes(i.toLowerCase())))
    .length;

  return `Day ${dayNumber} features ${activities.length} curated activities across ${areas.join(', ')}, ` +
    `aligned with ${matchedInterests} of your interests. ` +
    `The day is organized with a ${preferences?.pacePreference || 'moderate'} pace, ` +
    `balancing ${activities.map(a => a.category).join(', ')} experiences.`;
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
      ...accessibilityNeeds.map(need => `${need} friendly transportation options available`),
      "Public transport and walking combinations"
    ].filter(Boolean),
    walkingDistances: [
      `Distances optimized for ${preferences?.pacePreference || 'moderate'} pace`,
      `Major segments: ${activities.map(a => a.location).join(' → ')}`
    ],
    timeEstimates: [
      "15-30 minutes buffer between activities",
      `Adjusted for ${preferences?.pacePreference || 'moderate'} pace preference`,
      ...accessibilityNeeds.map(need => `Extra time allocated for ${need} accessibility`)
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
    let remainingActivities = [...activities];
    
    // Initialize schedule array for each day
    const schedule = Array.from({ length: days }, (_, i) => {
      const dayNumber = i + 1;
      
      // Get activities for this day
      const dayActivities = remainingActivities.filter(activity => 
        !activity.dayNumber || activity.dayNumber === dayNumber
      );

      // Group activities by time slot
      const morningActivities = dayActivities.filter(activity => activity.timeSlot === 'morning');
      const afternoonActivities = dayActivities.filter(activity => activity.timeSlot === 'afternoon');
      const eveningActivities = dayActivities.filter(activity => activity.timeSlot === 'evening');

      // If no activities are assigned to slots, distribute them
      if (morningActivities.length === 0 && afternoonActivities.length === 0 && eveningActivities.length === 0) {
        dayActivities.forEach((activity, index) => {
          const timeSlot = determineTimeSlot(index % 3);
          activity.timeSlot = timeSlot;
          activity.startTime = determineStartTime(timeSlot, activity);
        });
      }

      // Sort activities by time slot and start time
      const sortedActivities = dayActivities.sort((a, b) => {
        const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
        const timeSlotDiff = timeSlotOrder[a.timeSlot || 'morning'] - timeSlotOrder[b.timeSlot || 'morning'];
        if (timeSlotDiff !== 0) return timeSlotDiff;
        
        if (a.startTime && b.startTime) {
          const [hoursA, minutesA] = a.startTime.split(':').map(Number);
          const [hoursB, minutesB] = b.startTime.split(':').map(Number);
          return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
        }
        return 0;
      });

      // Remove assigned activities from remaining pool
      sortedActivities.forEach(activity => {
        const index = remainingActivities.findIndex(a => a.name === activity.name);
        if (index > -1) {
          remainingActivities.splice(index, 1);
        }
      });

      // Generate comprehensive day plan
      return {
        dayNumber,
        theme: generateDayTheme(sortedActivities, preferences),
        mainArea: determineMainArea(sortedActivities),
        commentary: generateDayCommentary(sortedActivities, preferences, dayNumber),
        highlights: generateDayHighlights(sortedActivities, preferences),
        activities: sortedActivities.map(activity => ({
          ...activity,
          dayNumber,
          timeSlot: activity.timeSlot || determineTimeSlot(sortedActivities.indexOf(activity) % 3),
          startTime: activity.startTime || determineStartTime(activity.timeSlot, activity),
          availability: activity.availability || {
            isAvailable: true,
            availableTimeSlots: [activity.timeSlot || determineTimeSlot(sortedActivities.indexOf(activity) % 3)],
            exactStartTimes: [activity.startTime || determineStartTime(activity.timeSlot, activity)],
            timesByCategory: {
              morning: activity.timeSlot === 'morning' ? [activity.startTime] : [],
              afternoon: activity.timeSlot === 'afternoon' ? [activity.startTime] : [],
              evening: activity.timeSlot === 'evening' ? [activity.startTime] : []
            },
            realTimeVerification: {
              verified: true,
              exactStartTimes: [activity.startTime || determineStartTime(activity.timeSlot, activity)],
              lastChecked: new Date().toISOString()
            }
          }
        })),
        breaks: generateBreakSchedule(sortedActivities, preferences),
        logistics: generateLogistics(sortedActivities, preferences),
        availabilityStats: calculateAvailabilityStats(sortedActivities)
      };
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
    logger.error('[Schedule Optimization] Failed to optimize schedule', {
      error: error instanceof Error ? error.message : 'Unknown error',
      destination,
      days
    });
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

function calculateAvailabilityStats(activities: any[]): any {
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

async function enrichActivity(activity: Activity, destination: string): Promise<Activity> {
  logger.info(`[Activity] Enriching activity:`, {
    name: activity.name,
    destination
  });

  try {
    // Extract city name from destination (e.g., "Paris, Charles de Gaulle" -> "Paris")
    const cityName = destination.split(',')[0].trim();
    
    // First get the destination ID
    const destinationId = await viatorService.getDestinationId(cityName);
    if (!destinationId) {
      throw new Error(`Could not find destination ID for: ${cityName}`);
    }

    logger.info(`[Activity] Found destination ID for ${cityName}:`, {
      destinationId,
      activityName: activity.name
    });

    // Search for the activity by name to get product code
    const searchResults = await viatorService.searchActivity(activity.name, destinationId);
          if (!searchResults || searchResults.length === 0) {
      throw new Error(`No Viator activities found for: ${activity.name} in ${cityName}`);
          }

          // Use the first search result
          const bestMatch = searchResults[0];
          const locationValidation = validateLocation(bestMatch, destination);
          if (!locationValidation.isMatch) {
      throw new Error(`Location mismatch for activity: ${activity.name}. Expected: ${destination}, Found: ${locationValidation.locationSources.join(', ')}`);
    }

    // Extract and validate product code
    const productCode = bestMatch.productCode;
          if (!productCode) {
      throw new Error(`No product code found for activity: ${activity.name}`);
    }

    // Get availability schedule
    const availabilitySchedule = await viatorService.getAvailabilitySchedule(productCode);
    
    // Log availability data
    logger.info('[Activity] Availability data retrieved:', {
      activity: activity.name,
      availabilitySchedule: {
        hasSchedule: !!availabilitySchedule,
        timeSlots: availabilitySchedule?.extractedTimeSlots?.length || 0,
        operatingDays: availabilitySchedule?.extractedDaysOfWeek || []
      }
    });

    // Construct reference URL
    const referenceUrl = `https://www.viator.com/tours/${destination.replace(/\s+/g, '-')}/${productCode}`;

    return {
      ...activity,
      productCode,
      bookingDetails: {
        provider: 'Viator',
        productCode,
        referenceUrl,
        cancellationPolicy: availabilitySchedule?.extractedBookingInfo?.cancellationPolicy,
        instantConfirmation: availabilitySchedule?.extractedBookingInfo?.confirmationType === 'INSTANT',
        mobileTicket: availabilitySchedule?.extractedBookingInfo?.mobileTicketing,
        minParticipants: availabilitySchedule?.extractedBookingInfo?.minParticipants,
        maxParticipants: availabilitySchedule?.extractedBookingInfo?.maxParticipants
      },
      availability: {
        isAvailable: availabilitySchedule?.extractedTimeSlots?.length > 0 || false,
        availableTimeSlots: availabilitySchedule?.extractedTimeSlots || [],
        operatingHours: availabilitySchedule?.extractedOperatingHours 
          ? Object.entries(availabilitySchedule.extractedOperatingHours)
              .map(([day, hours]) => `${day}: ${hours.map(h => `${h.opensAt}-${h.closesAt}`).join(', ')}`)
              .join('; ')
          : undefined,
        realTimeVerification: {
          verified: false,
          exactStartTimes: availabilitySchedule?.extractedTimeSlots || [],
          lastChecked: new Date().toISOString()
        },
        tripPeriodAvailability: {
          availableDates: availabilitySchedule?.extractedDaysOfWeek || [],
          availabilityByDate: {
            [activity.date || new Date().toISOString().split('T')[0]]: 
              availabilitySchedule?.extractedTimeSlots || []
          },
          operatingDays: availabilitySchedule?.extractedDaysOfWeek || [],
          operatingHours: availabilitySchedule?.extractedOperatingHours || {}
        }
      },
      price: {
        amount: availabilitySchedule?.extractedPricing?.amount || activity.price?.amount || 0,
        currency: availabilitySchedule?.extractedPricing?.currency || activity.price?.currency || 'USD'
      },
      enrichmentStatus: 'success'
    };

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

activitiesRouter.post('/generate', async (req: Request, res: Response) => {
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

    // Single entry point for activity generation and enrichment
    const perplexityService = new PerplexityService();
    const result = await perplexityService.generateActivities({
      departureLocation,
      destinations,
      startDate,
      endDate,
      travelers,
      currency,
      budgetLimit,
      preferences
    });

    // First enrich all activities with Viator data
    const enrichedActivities = await Promise.all(
      result.activities.map(activity => 
        enrichActivity(activity, destinations[0].label)
      )
    );

    // Then optimize the schedule with enriched activities
    const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    const optimizedSchedule = await optimizeSchedule(
      enrichedActivities,
      days,
      destinations[0].label,
      preferences
    );

    // Only create the optimized_plan.log at the very end
    logOptimizedSchedule(optimizedSchedule.schedule, destinations[0].label, days);

    return res.json({
      success: true,
      data: {
        activities: enrichedActivities,
        schedule: optimizedSchedule.schedule,
        dailyHighlights: optimizedSchedule.dailyHighlights,
        tripOverview: optimizedSchedule.tripOverview
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

// Add availability check endpoint
activitiesRouter.post('/availability/:productCode', async (req: Request, res: Response) => {
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