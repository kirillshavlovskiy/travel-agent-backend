import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { ViatorService } from '../services/viator';
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
  id?: string;
  name: string;
  description: string;
  category: string;
  timeSlot: 'morning' | 'afternoon' | 'evening';
  dayNumber: number;
  startTime: string;
  duration: number;
  location: string;
  price: { amount: number; currency: string };
  selected: boolean;
  bookingDetails?: {
    provider: string;
    productCode: string;
    referenceUrl: string;
    cancellationPolicy?: string;
    instantConfirmation?: boolean;
    mobileTicket?: boolean;
    languages?: string[];
    minParticipants?: number;
    maxParticipants?: number;
    pickupIncluded?: boolean;
    pickupLocation?: string;
    accessibility?: string;
    restrictions?: string[];
  };
  availability?: {
    isAvailable: boolean;
    availableTimeSlots: ('morning' | 'afternoon' | 'evening')[];
    exactStartTimes: string[];
    timesByCategory: {
      morning: string[];
      afternoon: string[];
      evening: string[];
    };
    realTimeVerification: {
      verified: boolean;
      exactStartTimes: string[];
      lastChecked: string;
      reason?: string;
      pricing?: {
        fromPrice: number;
        currency: string;
      };
    };
    operatingHours?: string;
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
  };
  rating?: number;
  numberOfReviews?: number;
  highlights?: string[];
  date?: string;
  locationDetails?: {
    coordinates?: {
      lat: number;
      lng: number;
    };
    address?: string;
  };
  enrichmentStatus?: 'success' | 'failed';
  enrichmentError?: string;
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
  date: string;
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
  unscheduledActivities?: Activity[];
  statistics?: {
    totalScheduled: number;
    totalUnscheduled: number;
    scheduledByDay: number[];
  };
}

// Update the schedule creation function
export async function optimizeSchedule(
  activities: Activity[],
  days: number,
  destination: string,
  preferences?: any,
  startDate?: string
): Promise<OptimizedSchedule> {
  logger.info(`[Schedule] Starting schedule optimization for ${days} days in ${destination}`);

  // Validate and parse start date
  const parsedStartDate = startDate ? new Date(startDate) : new Date();
  if (isNaN(parsedStartDate.getTime())) {
    logger.error('[Schedule] Invalid start date provided:', startDate);
    throw new Error('Invalid start date');
  }

  // Initialize schedule array with proper dates
  const schedule: Schedule[] = Array.from({ length: days }, (_, i) => {
    const currentDate = new Date(parsedStartDate);
    currentDate.setDate(parsedStartDate.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];
    
    return {
      dayNumber: i + 1,
      date: dateStr,
      theme: '',
      mainArea: '',
      commentary: '',
      highlights: [],
      activities: [],
      breaks: generateBreakSchedule([], preferences),
      logistics: generateLogistics([], preferences),
      availabilityStats: {
        verifiedActivities: 0,
        totalActivities: 0,
        realTimeAvailabilityRate: '0%'
      }
    };
  });

  // Validate and prepare activities
  const validActivities = activities.map(activity => {
    // Ensure activity has a valid time slot
    if (!validateTimeSlot(activity)) {
      activity.timeSlot = determineTimeSlot(activity.startTime, activity.duration);
      logger.info(`[Schedule] Assigned time slot ${activity.timeSlot} to "${activity.name}"`);
    }
    return activity;
  });

  // Sort activities by selection status, duration, and combined score
  validActivities.sort((a, b) => {
    if (a.selected !== b.selected) return b.selected ? 1 : -1;
    if (a.duration !== b.duration) return b.duration - a.duration;
    const scoreA = (a.rating || 0) * (a.preferenceScore || 1);
    const scoreB = (b.rating || 0) * (b.preferenceScore || 1);
    return scoreB - scoreA;
  });

  const remainingActivities: Activity[] = [];
  const occupiedTimeSlots: Record<string, Array<{ startTime: string; endTime: string }>> = {};

  // Helper function to check time conflicts
  const hasTimeConflict = (activity: Activity, date: string): boolean => {
    if (!occupiedTimeSlots[date]) return false;

    const activityStart = new Date(`${date}T${activity.startTime}`);
    const activityEnd = new Date(activityStart.getTime() + activity.duration * 60 * 1000);

    return occupiedTimeSlots[date].some(slot => {
      const slotStart = new Date(`${date}T${slot.startTime}`);
      const slotEnd = new Date(`${date}T${slot.endTime}`);
      return (activityStart < slotEnd && activityEnd > slotStart);
    });
  };

  // Helper function to check for redundant activities
  const isRedundantActivity = (activity: Activity, existingActivities: Activity[]): boolean => {
    return existingActivities.some(existing => 
      existing.name === activity.name && 
      existing.dayNumber === activity.dayNumber
    );
  };

  // Helper function to add activity to schedule
  const scheduleActivity = (activity: Activity, dayIndex: number): boolean => {
    const currentDate = schedule[dayIndex].date;
    
    // Check constraints
    if (schedule[dayIndex].activities.length >= 5) {
      logger.info(`[Schedule] Day ${dayIndex + 1} already has maximum activities`);
      return false;
    }

    // Check for redundant activities
    if (isRedundantActivity(activity, schedule[dayIndex].activities)) {
      logger.info(`[Schedule] Redundant activity detected for "${activity.name}" on ${currentDate}`);
      return false;
    }

    const totalDuration = schedule[dayIndex].activities.reduce((sum, a) => sum + a.duration, 0);
    if (totalDuration + activity.duration > 12 * 60) {
      logger.info(`[Schedule] Day ${dayIndex + 1} would exceed maximum duration`);
      return false;
    }

    if (hasTimeConflict(activity, currentDate)) {
      logger.info(`[Schedule] Time conflict detected for "${activity.name}" on ${currentDate}`);
      return false;
    }

    // Add activity to schedule with proper date assignment
    const scheduledActivity = {
      ...activity,
      date: currentDate,
      dayNumber: dayIndex + 1
    };

    // Update the activity's date in the original array to maintain consistency
    const originalIndex = validActivities.findIndex(a => a.name === activity.name);
    if (originalIndex !== -1) {
      validActivities[originalIndex].date = currentDate;
      validActivities[originalIndex].dayNumber = dayIndex + 1;
    }

    schedule[dayIndex].activities.push(scheduledActivity);

    // Sort activities by start time within the day
    schedule[dayIndex].activities.sort((a, b) => {
      const timeA = new Date(`2000-01-01T${a.startTime}`).getTime();
      const timeB = new Date(`2000-01-01T${b.startTime}`).getTime();
      return timeA - timeB;
    });

    // Update occupied time slots
    if (!occupiedTimeSlots[currentDate]) {
      occupiedTimeSlots[currentDate] = [];
    }

    const endTime = new Date(`${currentDate}T${activity.startTime}`);
    endTime.setMinutes(endTime.getMinutes() + activity.duration);

    occupiedTimeSlots[currentDate].push({
      startTime: activity.startTime,
      endTime: endTime.toTimeString().slice(0, 5)
    });

    // Sort occupied time slots
    occupiedTimeSlots[currentDate].sort((a, b) => {
      const timeA = new Date(`2000-01-01T${a.startTime}`).getTime();
      const timeB = new Date(`2000-01-01T${b.startTime}`).getTime();
      return timeA - timeB;
    });

    logger.info(`[Schedule] Scheduled activity "${activity.name}" on ${currentDate} at ${activity.startTime}`);
    return true;
  };

  // Process each day
  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const dayNumber = dayIndex + 1;
    logger.info(`[Schedule] Processing day ${dayNumber} (${schedule[dayIndex].date})`);

    // First schedule selected activities for this day
    const selectedActivities = validActivities.filter(activity => 
      activity.selected && (activity.dayNumber === dayNumber || !activity.dayNumber)
    );

    for (const activity of selectedActivities) {
      if (!scheduleActivity(activity, dayIndex)) {
        remainingActivities.push(activity);
      }
    }

    // Then try to schedule unassigned activities
    const unassignedActivities = validActivities.filter(activity => 
      !activity.selected && !remainingActivities.includes(activity) &&
      (!activity.dayNumber || activity.dayNumber === dayNumber)
    );

    for (const activity of unassignedActivities) {
      if (!scheduleActivity(activity, dayIndex)) {
        remainingActivities.push(activity);
      }
    }

    // Sort day's activities by start time
    schedule[dayIndex].activities.sort((a, b) => {
      const timeA = new Date(`${schedule[dayIndex].date}T${a.startTime}`).getTime();
      const timeB = new Date(`${schedule[dayIndex].date}T${b.startTime}`).getTime();
      return timeA - timeB;
    });

    // Generate schedule details for the day
    if (schedule[dayIndex].activities.length > 0) {
      schedule[dayIndex].theme = generateDayTheme(schedule[dayIndex].activities, preferences);
      schedule[dayIndex].mainArea = determineMainArea(schedule[dayIndex].activities);
      schedule[dayIndex].commentary = generateDayCommentary(schedule[dayIndex].activities, dayNumber);
      schedule[dayIndex].highlights = generateDayHighlights(schedule[dayIndex].activities, preferences);
      schedule[dayIndex].breaks = generateBreakSchedule(schedule[dayIndex].activities, preferences);
      schedule[dayIndex].logistics = generateLogistics(schedule[dayIndex].activities, preferences);
      
      const stats = calculateAvailabilityStats(schedule[dayIndex].activities);
      schedule[dayIndex].availabilityStats = stats;
    }

    logger.info(`[Schedule] Completed day ${dayNumber} with ${schedule[dayIndex].activities.length} activities`);
  }

  // Generate final statistics
  const statistics = {
    totalScheduled: schedule.reduce((sum, day) => sum + day.activities.length, 0),
    totalUnscheduled: remainingActivities.length,
    scheduledByDay: schedule.map(day => day.activities.length)
  };

  // Generate daily highlights
  const dailyHighlights = schedule.map(day => ({
        dayNumber: day.dayNumber,
    theme: day.theme,
    highlights: day.highlights
  }));

  // Generate trip overview
  const tripOverview = generateTripOverview(schedule, destination);

  logOptimizedSchedule(schedule, destination, days);

    return {
      schedule,
    dailyHighlights,
    tripOverview,
    unscheduledActivities: remainingActivities,
    statistics
  };
}

function determineTimeSlot(startTime: string | undefined, duration: number): 'morning' | 'afternoon' | 'evening' {
  // If no start time provided, return morning as default
  if (!startTime) {
    return 'morning';
  }

  const [hours] = startTime.split(':').map(Number);
  const endHour = hours + Math.floor(duration / 60);

  // If activity spans multiple time slots, assign to the slot with the majority of the duration
  if (duration >= 480) { // 8 hours or more
    return 'morning'; // Full day activities are marked as morning
  } else if (hours >= 17 || (hours < 6 && endHour > 17)) {
    return 'evening';
  } else if (hours >= 12 || (hours < 12 && endHour > 12)) {
    return 'afternoon';
  } else {
    return 'morning';
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
    title?: string;
    categories?: string[];
    cancellationPolicy?: string;
    confirmationType?: 'INSTANT' | 'MANUAL';
    mobileTicketing?: boolean;
    minParticipants?: number;
    maxParticipants?: number;
  };
}

// Update validateTimeSlot function to be more lenient
function validateTimeSlot(activity: Activity): boolean {
  if (!activity.timeSlot || !activity.startTime || !activity.duration) {
    logger.warn(`[Schedule] Invalid time slot for activity "${activity.name}":`, {
      timeSlot: activity.timeSlot,
      startTime: activity.startTime,
      duration: activity.duration
    });
    return false;
  }

  // Convert start time to minutes since midnight
  const [hours, minutes] = activity.startTime.split(':').map(Number);
  const startMinutes = hours * 60 + minutes;
  const endMinutes = startMinutes + activity.duration;

  // Define time slot boundaries
  const timeSlots = {
    morning: { start: 6 * 60, end: 12 * 60 },    // 6:00 - 12:00
    afternoon: { start: 12 * 60, end: 17 * 60 }, // 12:00 - 17:00
    evening: { start: 17 * 60, end: 23 * 60 }    // 17:00 - 23:00
  };

  // Check if activity fits within operating hours (6:00 - 23:00)
  if (startMinutes < 6 * 60 || endMinutes > 23 * 60) {
    logger.warn(`[Schedule] Activity "${activity.name}" outside operating hours:`, {
      startTime: activity.startTime,
      duration: activity.duration
    });
    return false;
  }

  // Determine actual time slot based on start time
  const actualTimeSlot = determineTimeSlot(activity.startTime, activity.duration);
  if (activity.timeSlot !== actualTimeSlot) {
    // Update the time slot to match the actual time instead of invalidating
    activity.timeSlot = actualTimeSlot;
    logger.info(`[Schedule] Updated time slot for "${activity.name}" to ${actualTimeSlot}`);
  }

  return true;
}

function checkOverlap(activity: Activity, existingActivities: Activity[]): boolean {
  const sameSlotActivities = existingActivities.filter(
    a => a.dayNumber === activity.dayNumber && a.timeSlot === activity.timeSlot
  );

  if (sameSlotActivities.length === 0) {
    return false;
  }

  const activityStart = new Date(`2000-01-01T${activity.startTime}`);
  const activityEnd = new Date(activityStart.getTime() + activity.duration * 60000);

  return sameSlotActivities.some(existing => {
    const existingStart = new Date(`2000-01-01T${existing.startTime}`);
    const existingEnd = new Date(existingStart.getTime() + existing.duration * 60000);

    return (
      (activityStart >= existingStart && activityStart < existingEnd) ||
      (activityEnd > existingStart && activityEnd <= existingEnd)
    );
  });
}

// Update findBestStartTime to return undefined instead of null
function findBestStartTime(availableTimes: string[], timeSlot: string, duration: number): string | undefined {
  if (!availableTimes || availableTimes.length === 0) {
    return undefined;
  }

  logger.info('[Schedule] Finding best start time:', {
    availableTimes,
    timeSlot,
    duration
  });

  // Convert times to minutes since midnight for easier comparison
  const times = availableTimes.map(time => {
    const [hours, minutes] = time.split(':').map(Number);
    return {
      originalTime: time,
      minutes: hours * 60 + minutes
    };
  });

  // Define time slot boundaries in minutes
  const boundaries = {
    morning: { start: 6 * 60, end: 12 * 60 }, // 6:00 - 12:00
    afternoon: { start: 12 * 60, end: 17 * 60 }, // 12:00 - 17:00
    evening: { start: 17 * 60, end: 23 * 60 } // 17:00 - 23:00
  };

  // Filter times that fit within the activity duration and preferred time slot
  const validTimes = times.filter(time => {
    const endMinutes = time.minutes + duration;
    
    // Check if activity fits within operating hours (6:00 - 23:00)
    if (time.minutes < 6 * 60 || endMinutes > 23 * 60) {
      return false;
    }

    // Check if activity fits within its time slot
    const slot = boundaries[timeSlot as keyof typeof boundaries];
    if (slot) {
      return time.minutes >= slot.start && time.minutes < slot.end;
    }

    return true;
  });

  if (validTimes.length === 0) {
    logger.warn('[Schedule] No valid times found within constraints:', {
      timeSlot,
      duration
    });
    return undefined;
  }

  // Sort by time and return the earliest valid time
  validTimes.sort((a, b) => a.minutes - b.minutes);
  
  logger.info('[Schedule] Selected best start time:', {
    selectedTime: validTimes[0].originalTime,
    validOptions: validTimes.map(t => t.originalTime)
  });

  return validTimes[0].originalTime;
}

// Add the AvailabilityResult interface
interface AvailabilityResult {
  isAvailable: boolean;
  exactStartTimes: string[];
  timesByCategory: Record<string, string[]>;
}

// Update the enrichActivity function to use our more robust error handling
async function enrichActivity(activity: Activity, date: string): Promise<Activity | null> {
  const startTime = new Date().getTime();
  
  try {
    logger.info('[Activity] Starting enrichment:', {
      name: activity.name,
      timeSlot: activity.timeSlot,
      dayNumber: activity.dayNumber
    });

    // Check if activity is valid
    if (!activity.name) {
      logger.error('[Activity] Invalid activity, missing name');
      return null;
    }

    // Step 1: Check availability with error handling
    let availability: AvailabilityResult;
    try {
      availability = await checkRealTimeAvailability(activity, date);
    } catch (error) {
      logger.error('[Activity] Availability check failed:', {
        name: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // If availability check fails, use defaults
      availability = getDefaultAvailability(activity);
    }

    // Step 2: Find best start time based on time slot
    let bestStartTime: string | null = null;
    let adjustedTimeSlot = activity.timeSlot;
    
    // Try to find a time in the preferred slot
    if (availability.exactStartTimes.length > 0) {
      bestStartTime = findBestStartTime(
        availability.exactStartTimes,
        activity.timeSlot,
        activity.duration
      );
      
      logger.info('[Activity] Found best time in preferred slot for "' + activity.name + '":', {
        startTime: bestStartTime,
        timeSlot: activity.timeSlot,
        availableTimes: availability.exactStartTimes
      });
    }
    
    // If no time found in preferred slot, try alternative slots
    if (!bestStartTime) {
      // Define alternative slots
      const alternativeSlots = {
        'morning': ['afternoon', 'evening'],
        'afternoon': ['morning', 'evening'],
        'evening': ['afternoon', 'morning']
      };
      
      // Try each alternative
      for (const altSlot of alternativeSlots[activity.timeSlot as keyof typeof alternativeSlots]) {
        if (availability.timesByCategory[altSlot]?.length > 0) {
          bestStartTime = findBestStartTime(
            availability.timesByCategory[altSlot],
            altSlot as 'morning' | 'afternoon' | 'evening',
            activity.duration
          );
          
          if (bestStartTime) {
            adjustedTimeSlot = altSlot as 'morning' | 'afternoon' | 'evening';
            logger.info('[Activity] Found best time in alternative slot for "' + activity.name + '":', {
              startTime: bestStartTime,
              timeSlot: adjustedTimeSlot,
              originalTimeSlot: activity.timeSlot,
              availableTimes: availability.timesByCategory[altSlot]
            });
            break;
          }
        }
      }
    }
    
    // If still no time found, use default
    if (!bestStartTime) {
      bestStartTime = getDefaultStartTime(activity.timeSlot);
      logger.warn('[Activity] No available times found, using default for "' + activity.name + '":', {
        startTime: bestStartTime,
        timeSlot: activity.timeSlot
      });
    }
    
    // Step 3: Build the enriched activity
    const enrichedActivity: Activity = {
      ...activity,
      startTime: bestStartTime,
      timeSlot: adjustedTimeSlot,
      availability: {
        isAvailable: true,
        availableTimeSlots: Object.keys(availability.timesByCategory).filter(
          slot => availability.timesByCategory[slot].length > 0
        ) as ('morning' | 'afternoon' | 'evening')[],
        exactStartTimes: availability.exactStartTimes,
        timesByCategory: availability.timesByCategory,
        realTimeVerification: {
          verified: true,
          exactStartTimes: availability.exactStartTimes,
          lastChecked: new Date().toISOString()
        }
      },
      enrichmentStatus: 'success',
      date
    };
    
    const enrichmentDuration = new Date().getTime() - startTime;
    enrichedActivity.enrichmentDuration = enrichmentDuration;
    
    logger.info('[Activity] Successfully enriched "' + activity.name + '"', {
      duration: enrichmentDuration,
      startTime: bestStartTime,
      timeSlot: adjustedTimeSlot
    });
    
    return enrichedActivity;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Activity] Failed to enrich activity "' + activity.name + '":', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Return a basic enriched activity with default values
    return {
      ...activity,
      startTime: getDefaultStartTime(activity.timeSlot),
      enrichmentStatus: 'failed',
      enrichmentError: errorMessage,
      enrichmentDuration: new Date().getTime() - startTime,
      availability: {
        isAvailable: true,
        availableTimeSlots: [activity.timeSlot],
        exactStartTimes: [getDefaultStartTime(activity.timeSlot)],
        timesByCategory: {
          morning: activity.timeSlot === 'morning' ? [getDefaultStartTime('morning')] : [],
          afternoon: activity.timeSlot === 'afternoon' ? [getDefaultStartTime('afternoon')] : [],
          evening: activity.timeSlot === 'evening' ? [getDefaultStartTime('evening')] : []
        },
        realTimeVerification: {
          verified: false,
          exactStartTimes: [getDefaultStartTime(activity.timeSlot)],
          lastChecked: new Date().toISOString(),
          reason: errorMessage
        }
      },
      date
    };
  }
}

// Add helper function to calculate match score between Viator activity and original activity
function calculateMatchScore(viatorActivity: any, originalActivity: Activity): number {
  let score = 0;
  
  // Name similarity
  const viatorName = viatorActivity.title?.toLowerCase() || '';
  const originalName = originalActivity.name.toLowerCase();
  if (viatorName.includes(originalName) || originalName.includes(viatorName)) {
    score += 2;
  }

  // Category match
  const viatorCategory = viatorActivity.categories?.[0]?.toLowerCase() || '';
  const originalCategory = originalActivity.category.toLowerCase();
  if (viatorCategory === originalCategory) {
    score += 1;
  }

  // Duration match
  const viatorDuration = viatorActivity.duration || 0;
  const originalDuration = originalActivity.duration;
  if (Math.abs(viatorDuration - originalDuration) <= 30) { // Within 30 minutes
    score += 1;
  }

  return score;
}

// Add helper function to determine category
function determineCategory(viatorActivity: any, originalCategory: string): string {
  // Try to use Viator category if available
  if (viatorActivity.categories?.[0]) {
    return viatorActivity.categories[0];
  }

  // Fallback to original category
  return originalCategory;
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
export function getDefaultStartTime(timeSlot: string): string {
  switch (timeSlot) {
    case 'morning':
      return '09:00';
    case 'afternoon':
      return '14:00';
    case 'evening':
      return '19:00';
    default:
      return '09:00';
  }
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
      preferences,
      startDate
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

// Add enrich endpoint
activitiesRouter.post('/enrich', async (req: Request, res: Response) => {
  try {
    const { activityId, referenceUrl, name } = req.body;

    if (!referenceUrl) {
      return res.status(400).json({
        error: 'Reference URL is required for enrichment'
      });
    }

    logger.info('[Activities] Enriching activity:', {
      activityId,
      referenceUrl,
      name
    });

    // Create a minimal activity object with the necessary info
    const activity: any = {
      id: activityId,
      name: name || 'Unknown Activity',
      referenceUrl,
      bookingDetails: {
        referenceUrl
      }
    };

    // Call the enrichActivityDetails method
    const enrichedActivity = await viatorService.enrichActivityDetails(activity);

    logger.info('[Activities] Activity enriched successfully:', {
      name: enrichedActivity.name,
      hasDetails: !!enrichedActivity.details,
      hasReviews: !!enrichedActivity.reviews,
      hasItinerary: !!enrichedActivity.itinerary,
      enrichmentStatus: enrichedActivity.enrichmentStatus
    });

    // Return the enriched data
    return res.json(enrichedActivity);
  } catch (error) {
    logger.error('[Activities] Error enriching activity:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return res.status(500).json({
      error: 'Failed to enrich activity',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add missing checkRealTimeAvailability function
async function checkRealTimeAvailability(activity: Activity, date: string): Promise<AvailabilityResult> {
  try {
    // Get the product code from the activity
    const productCode = activity.bookingDetails?.productCode;
    
    if (!productCode) {
      logger.warn('[Activity] Missing product code for real-time availability check:', {
        name: activity.name,
        bookingDetails: activity.bookingDetails
      });
      
      // Return default availability when product code is missing
      return getDefaultAvailability(activity);
    }
    
    // Try to get availability schedule from Viator
    let availabilitySchedule: ViatorAvailabilitySchedule | null = null;
    try {
      availabilitySchedule = await viatorService.getAvailabilitySchedule(productCode);
    } catch (error) {
      logger.error('[Viator] Error getting availability schedule:', {
        productCode,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        stage: 'error'
      });
      
      // If availability schedule check fails, use default data
      return getDefaultAvailability(activity);
    }
    
    if (!availabilitySchedule) {
      logger.warn('[Activity] No availability schedule found:', {
        name: activity.name,
        productCode
      });
      
      // Return default availability when schedule is missing
      return getDefaultAvailability(activity);
    }
    
    // Try to check real-time availability
    let realTimeCheck: ViatorAvailabilityResponse | null = null;
    try {
      realTimeCheck = await viatorService.checkRealTimeAvailability(productCode, date);
    } catch (error) {
      logger.error('[Activity] Error checking real-time availability:', {
        name: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // If real-time availability check fails, use schedule data if we have it,
      // or default data if not
      if (availabilitySchedule.extractedTimeSlots && availabilitySchedule.extractedTimeSlots.length > 0) {
        return {
          isAvailable: true,
          exactStartTimes: availabilitySchedule.extractedTimeSlots,
          timesByCategory: categorizeTimeSlots(availabilitySchedule.extractedTimeSlots)
        };
      } else {
        return getDefaultAvailability(activity);
      }
    }
    
    if (!realTimeCheck || !realTimeCheck.available) {
      logger.warn('[Activity] Not available in real-time check:', {
        name: activity.name,
        productCode,
        date
      });
      
      // If not available in real-time, use schedule data or default
      if (availabilitySchedule.extractedTimeSlots && availabilitySchedule.extractedTimeSlots.length > 0) {
        return {
          isAvailable: true,
          exactStartTimes: availabilitySchedule.extractedTimeSlots,
          timesByCategory: categorizeTimeSlots(availabilitySchedule.extractedTimeSlots)
        };
      } else {
        return getDefaultAvailability(activity);
      }
    }
    
    // Format the available time slots
    const exactStartTimes = realTimeCheck.schedule.availableTimeSlots || ['09:00'];
    logger.info('[Activity] Available times for "' + activity.name + '":', {
      exactStartTimes,
      timesByCategory: categorizeTimeSlots(exactStartTimes)
    });
    
    return {
      isAvailable: true,
      exactStartTimes,
      timesByCategory: categorizeTimeSlots(exactStartTimes)
    };
  } catch (error) {
    logger.error('[Activity] Unexpected error in checkRealTimeAvailability:', {
      name: activity.name,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Return default availability on any unexpected error
    return getDefaultAvailability(activity);
  }
}

// Add helper function to get default availability based on activity time slot
function getDefaultAvailability(activity: Activity): AvailabilityResult {
  const timeSlot = activity.timeSlot || 'morning';
  const defaultTimes = {
    'morning': ['09:00', '10:00', '11:00'],
    'afternoon': ['13:00', '14:00', '15:00'],
    'evening': ['18:00', '19:00', '20:00']
  };
  
  // Use existing start time if available, otherwise use first default time
  const exactStartTimes = activity.startTime ? 
    [activity.startTime] : 
    defaultTimes[timeSlot as keyof typeof defaultTimes];
  
  return {
    isAvailable: true,
    exactStartTimes,
    timesByCategory: categorizeTimeSlots(exactStartTimes)
  };
}

// Helper function to categorize times by time slot
function categorizeTimeSlots(times: string[]): Record<string, string[]> {
  const result = {
    'morning': [] as string[],
    'afternoon': [] as string[],
    'evening': [] as string[]
  };
  
  times.forEach(time => {
    const hour = parseInt(time.split(':')[0]);
    if (hour >= 6 && hour < 12) {
      result.morning.push(time);
    } else if (hour >= 12 && hour < 17) {
      result.afternoon.push(time);
    } else {
      result.evening.push(time);
    }
  });
  
  return result;
}

// Add helper functions for schedule generation
export function generateDayTheme(activities: Activity[], preferences: any): string {
  if (!activities || activities.length === 0) {
    return 'Free Day';
  }

  // Count categories
  const categoryCount = activities.reduce((count, activity) => {
    const category = activity.category || 'General';
    count[category] = (count[category] || 0) + 1;
    return count;
  }, {} as Record<string, number>);

  // Find dominant category
  const dominantCategory = Object.entries(categoryCount)
    .sort(([, countA], [, countB]) => countB - countA)[0][0];

  // Map category to theme
  const themeMap: Record<string, string> = {
    'Culture': 'Cultural Exploration',
    'Food & Wine': 'Culinary Discovery',
    'Nature': 'Nature & Outdoors',
    'Adventure': 'Adventure & Activities',
    'History': 'Historical Journey',
    'Art': 'Artistic Discovery',
    'Shopping': 'Shopping & Local Markets',
    'Nightlife': 'Evening Entertainment',
    'Relaxation': 'Wellness & Relaxation'
  };

  return themeMap[dominantCategory] || 'Mixed Activities';
}

export function generateDayCommentary(activities: Activity[], dayNumber: number): string {
  if (!activities || activities.length === 0) {
    return 'A free day to explore at your own pace.';
  }

  const totalDuration = activities.reduce((sum, act) => sum + (act.duration || 0), 0);
  const categories = [...new Set(activities.map(act => act.category))];
  const locations = [...new Set(activities.map(act => act.location))];

  return `Day ${dayNumber} features ${activities.length} activities over ${Math.round(totalDuration / 60)} hours, ` +
    `focusing on ${categories.join(', ')} in the ${locations.join(', ')} areas.`;
}

export function generateDayHighlights(activities: Activity[], preferences: any): string[] {
  if (!activities || activities.length === 0) {
    return ['Free day for independent exploration'];
  }

  return activities.map(activity => {
    const duration = activity.duration ? `(${Math.round(activity.duration / 60)}h)` : '';
    return `${activity.name} ${duration} - ${activity.description.split('.')[0]}.`;
  });
}

export function generateBreakSchedule(activities: Activity[], preferences: any): {
  morning: { startTime: string; endTime: string; duration: number; suggestion: string };
  lunch: { startTime: string; endTime: string; duration: number; suggestion: string };
  afternoon: { startTime: string; endTime: string; duration: number; suggestion: string };
  dinner: { startTime: string; endTime: string; duration: number; suggestion: string };
} {
  return {
    morning: {
      startTime: '10:30',
      endTime: '11:00',
      duration: 30,
      suggestion: 'Coffee break and light refreshments'
    },
    lunch: {
      startTime: '12:30',
      endTime: '13:30',
      duration: 60,
      suggestion: 'Lunch break at local restaurant'
    },
    afternoon: {
      startTime: '15:30',
      endTime: '16:00',
      duration: 30,
      suggestion: 'Rest and refreshment break'
    },
    dinner: {
      startTime: '18:30',
      endTime: '20:00',
      duration: 90,
      suggestion: 'Dinner at recommended restaurant'
    }
  };
}

export function generateLogistics(activities: Activity[], preferences: any): {
  transportSuggestions: string[];
  walkingDistances: string[];
  timeEstimates: string[];
} {
  return {
    transportSuggestions: [
      'Use public transportation between major attractions',
      'Consider taxi/ride-sharing for evening activities',
      'Walking is recommended for nearby locations'
    ],
    walkingDistances: [
      'Average walking distance between activities: 15-20 minutes',
      'Most attractions are within central tourist areas'
    ],
    timeEstimates: [
      'Allow 30 minutes for transportation between activities',
      'Plan to arrive 15 minutes early for guided tours',
      'Buffer time included for security checks at major attractions'
    ]
  };
}

// Add logging function
function logOptimizedSchedule(schedule: Schedule[], destination: string, days: number): void {
  logger.info('[Schedule] Optimization complete:', {
    destination,
    totalDays: days,
    scheduledDays: schedule.length,
    activitiesPerDay: schedule.map(day => ({
      dayNumber: day.dayNumber,
      activityCount: day.activities.length,
      theme: day.theme
    }))
  });
}

export { activitiesRouter };