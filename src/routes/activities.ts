import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';
import { Activity } from '../services/perplexity.js';

const router = Router();

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
      // Track seen activities by name and product code
      const seen = new Set<string>();
      const uniqueActivities = activities.filter(activity => {
        const key = `${activity.name}|${activity.bookingInfo?.productCode || ''}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      // Filter out activities that are too long for the trip duration
      const validActivities = uniqueActivities.filter(activity => {
    const durationInMinutes = typeof activity.duration === 'number' ? activity.duration : 0;
        const durationInHours = durationInMinutes / 60;
        
        // Filter out activities longer than 24 hours
        if (durationInHours > 24) {
          logger.debug('Filtering out multi-day activity:', {
            name: activity.name,
            durationInMinutes,
            durationInHours: Math.round(durationInHours * 10) / 10
          });
          return false;
        }

        // Also filter out suspiciously short activities (less than 15 minutes)
        if (durationInMinutes < 15 && durationInMinutes !== 0) {
          logger.debug('Filtering out suspiciously short activity:', {
            name: activity.name,
            durationInMinutes
          });
          return false;
        }

        return true;
      });

      logger.info('Activities after deduplication:', {
        originalCount: activities.length,
        uniqueCount: validActivities.length,
        removedCount: activities.length - validActivities.length
      });

      return validActivities;
}

// Add schedule optimization function
async function optimizeSchedule(activities: Activity[], days: number, destination: string): Promise<any> {
  try {
    // First, separate preselected activities from the rest
    const preselectedActivities = activities.filter(a => a.selected);
    const unselectedActivities = activities.filter(a => !a.selected);

    logger.info('Optimizing schedule with preselected activities:', {
      totalActivities: activities.length,
      preselected: preselectedActivities.length,
      unselected: unselectedActivities.length
    });

    const query = `Create a ${days}-day schedule for ${destination} with these activities:

PRESELECTED ACTIVITIES (MUST BE INCLUDED):
${preselectedActivities.map(a => `- ${a.name} (${a.duration || 'N/A'} minutes, ${a.timeSlot}, Day ${a.dayNumber})`).join('\n')}

AVAILABLE ACTIVITIES TO FILL GAPS:
${unselectedActivities.map(a => `- ${a.name} (${a.duration || 'N/A'} minutes)`).join('\n')}

REQUIREMENTS:
1. CRITICAL: Include ALL preselected activities in their specified days and time slots
2. Create a balanced schedule across ${days} days
3. Group nearby activities on the same day
4. Consider activity durations and opening hours
5. Allow 2-4 activities per day
6. Mix different types of activities

PROVIDE FOR EACH DAY:
1. List of activities with time slots
2. Reasoning for activity grouping and timing
3. Travel logistics between activities
4. Special considerations (opening hours, crowds, weather)

ALSO PROVIDE:
1. Overall trip flow explanation
2. Why certain activities were grouped together
3. Alternative suggestions if any activities don't fit well

Return as JSON with:
{
  "schedule": [{
    "dayNumber": number,
    "dayPlanningLogic": "detailed reasoning for day's plan",
    "activities": [{
      "name": "activity name",
      "timeSlot": "morning|afternoon|evening",
      "startTime": "HH:MM",
      "commentary": "why this activity was chosen",
      "itineraryHighlight": "how it fits in the day's flow",
      "scoringReason": "specific placement reasoning"
    }]
  }],
  "tripOverview": "overall trip organization logic",
  "activityFitNotes": "why activities were included/excluded"
}`;

        const response = await perplexityClient.chat(query);
        
        if (!response?.schedule) {
          logger.warn('Creating basic schedule due to optimization failure');
          return createBasicSchedule(activities, days);
        }

        logger.info('Schedule optimization reasoning:', {
          tripOverview: response.tripOverview,
          activityFitNotes: response.activityFitNotes
        });

    // Verify that all preselected activities are included in their specified slots
    const missingPreselected = preselectedActivities.filter(preselected => {
      return !response.schedule.some(day => 
        day.dayNumber === preselected.dayNumber &&
        day.activities.some(activity => 
          activity.name === preselected.name && 
          activity.timeSlot === preselected.timeSlot
        )
      );
    });

    if (missingPreselected.length > 0) {
      logger.warn('Some preselected activities are missing from the schedule:', {
        missing: missingPreselected.map(a => ({
          name: a.name,
          day: a.dayNumber,
          timeSlot: a.timeSlot
        }))
      });
      
      // Fall back to basic schedule if optimization failed to include all preselected activities
      return createBasicSchedule(activities, days);
    }

    // Preserve activity details when transforming schedule
    const enrichedSchedule = response.schedule.map((day: any) => ({
      ...day,
      activities: day.activities.map((scheduledActivity: any) => {
        // First try to find a matching preselected activity
        const preselected = preselectedActivities.find(a => 
          a.name === scheduledActivity.name && 
          a.dayNumber === day.dayNumber &&
          a.timeSlot === scheduledActivity.timeSlot
        );

        if (preselected) {
          return {
            ...preselected,
            ...scheduledActivity,
            selected: true,
            commentary: scheduledActivity.commentary || preselected.commentary,
            itineraryHighlight: scheduledActivity.itineraryHighlight || preselected.itineraryHighlight,
            scoringReason: scheduledActivity.scoringReason || preselected.scoringReason
          };
        }

        // If not preselected, look for the original activity
        const originalActivity = activities.find(a => a.name === scheduledActivity.name);
        if (!originalActivity) return scheduledActivity;

        return {
          ...originalActivity,
          ...scheduledActivity,
          timeSlot: scheduledActivity.timeSlot || originalActivity.timeSlot,
          startTime: scheduledActivity.startTime,
          commentary: scheduledActivity.commentary || originalActivity.commentary,
          itineraryHighlight: scheduledActivity.itineraryHighlight || originalActivity.itineraryHighlight,
          scoringReason: scheduledActivity.scoringReason || originalActivity.scoringReason
        };
      })
    }));

    return {
      schedule: enrichedSchedule,
      tripOverview: response.tripOverview,
      activityFitNotes: response.activityFitNotes
    };
      } catch (error) {
        logger.error('Failed to optimize schedule:', error);
        return createBasicSchedule(activities, days);
      }
}

// Update createBasicSchedule to handle preselected activities
function createBasicSchedule(activities: Activity[], days: number) {
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
      .filter(activity => !activity.selected)
      .slice(0, neededActivities)
      .map((activity, index) => ({
        ...activity,
        timeSlot: availableTimeSlots[index] || 'morning',
        startTime: availableTimeSlots[index] === 'morning' ? '09:00' :
                  availableTimeSlots[index] === 'afternoon' ? '14:00' : '19:00',
        dayNumber: day
      }));

    const dayActivities = [...preselectedForDay, ...additionalActivities];

    schedule.push({
      dayNumber: day,
      theme: `Day ${day} Exploration`,
      mainArea: "City Center",
      commentary: `Day ${day} activities arranged by time slots`,
      highlights: [`Day ${day} main activities`],
      mapData: {
        center: { latitude: 0, longitude: 0 },
        bounds: { north: 0, south: 0, east: 0, west: 0 },
        locations: dayActivities.map((activity, index) => ({
            name: activity.name,
          coordinates: { latitude: 0, longitude: 0 },
          address: activity.location || '',
          type: 'activity',
          category: activity.category,
          description: activity.description || '',
          duration: activity.duration || 120,
          timeSlot: activity.timeSlot,
          order: index + 1
        })),
        routes: []
      },
      breaks: {
        morning: {
          startTime: "10:30",
          endTime: "11:00",
          duration: 30,
          suggestion: "Coffee break",
          location: "Nearby café"
        },
        lunch: {
          startTime: "12:30",
          endTime: "13:30",
          duration: 60,
          suggestion: "Lunch break",
          location: "Local restaurant"
        },
        afternoon: {
          startTime: "15:30",
          endTime: "16:00",
          duration: 30,
          suggestion: "Rest break",
          location: "Local park or café"
        },
        dinner: {
          startTime: "18:30",
          endTime: "20:00",
          duration: 90,
          suggestion: "Dinner",
          location: "Restaurant district"
        }
      },
      logistics: {
        transportSuggestions: ["Use public transport between main locations"],
        walkingDistances: ["Walking distances vary between activities"],
        timeEstimates: ["Allow 15-30 minutes between activities for transitions"]
      },
      activities: dayActivities
    });
  }

  return {
    schedule,
    tripOverview: 'Schedule created with preselected activities and balanced additional activities',
    activityFitNotes: 'Activities arranged based on preselected choices and time slot availability'
  };
}

router.post('/generate', async (req: Request, res: Response) => {
  try {
    // Add detailed request logging
    logger.info('Raw request body:', {
      hasDestination: !!req.body.destination,
      hasDays: !!req.body.days,
      hasBudget: !!req.body.budget,
      hasCurrency: !!req.body.currency,
      hasPreferences: !!req.body.preferences,
      rawPreferences: req.body.preferences,
      body: req.body
    });

    const { destination, days, budget, currency, flightTimes, preferences } = req.body;

    // Log extracted values
    logger.info('Extracted values:', {
      destination,
      days,
      budget,
      currency,
      hasFlightTimes: !!flightTimes,
      preferences
    });

    // Validate required fields
    if (!destination || !days || !budget || !currency || !preferences) {
      logger.warn('Missing required fields:', {
        hasDestination: !!destination,
        hasDays: !!days,
        hasBudget: !!budget,
        hasCurrency: !!currency,
        hasPreferences: !!preferences
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: destination, days, budget, currency, and preferences are required',
        timestamp: new Date().toISOString(),
        receivedFields: {
          destination: !!destination,
          days: !!days,
          budget: !!budget,
          currency: !!currency,
          preferences: !!preferences
        }
      });
    }

    // Get initial activity suggestions from Perplexity
    const response = await perplexityClient.generateActivities({
      destination,
      days,
      budget,
      currency,
      preferences: preferences,
      flightTimes
    });

    // Initialize empty arrays for activities if they don't exist
    const activities = response?.activities || [];
    const dailySummaries = response?.dailySummaries || [];
    const dayHighlights = response?.dayHighlights || [];

    // Handle case where no activities were generated
    if (activities.length === 0) {
      logger.error('No activities generated:', {
        response,
        error: response.error
      });
      return res.status(500).json({
        success: false,
        error: 'No activities could be generated. Please try again.',
        timestamp: new Date().toISOString(),
        metadata: {
          destination,
          days,
          budget,
          currency,
          error: response.error
        }
      });
    }

    // Process activities to ensure different time slots for same-day activities
    const processedActivities = activities.map(activity => ({
      ...activity,
      id: `${activity.id || Date.now()}-${activity.timeSlot || 'unspecified'}-${activity.dayNumber || 1}`,
      timeSlot: activity.timeSlot || 'morning',
      dayNumber: activity.dayNumber || 1
    }));

    // Initialize grouped activities structure
    const groupedActivities: Record<number, Record<string, any[]>> = {};
    for (let day = 1; day <= days; day++) {
      groupedActivities[day] = {
        morning: [],
        afternoon: [],
        evening: []
      };
    }

    // Group activities by day and time slot
    processedActivities.forEach(activity => {
      const day = activity.dayNumber;
      const slot = activity.timeSlot;
      if (groupedActivities[day] && groupedActivities[day][slot]) {
        groupedActivities[day][slot].push(activity);
      }
    });

    // Ensure we have activities for each day
    const hasActivitiesForAllDays = Object.keys(groupedActivities).length === days;
    if (!hasActivitiesForAllDays) {
      logger.warn('Missing activities for some days:', {
        expectedDays: days,
        actualDays: Object.keys(groupedActivities).length,
        groupedActivities
      });
    }

    logger.info('Successfully processed activities:', {
      totalActivities: processedActivities.length,
      dayCount: Object.keys(groupedActivities).length,
      sampleDay: groupedActivities[1]
    });

    return res.json({
      success: true,
      activities: processedActivities,
      dailySchedule: groupedActivities,
      dailySummaries,
      dayHighlights,
      metadata: {
        originalCount: activities.length,
        finalCount: processedActivities.length,
        dayCount: Object.keys(groupedActivities).length,
        expectedDays: days,
        destination,
        timestamp: new Date().toISOString(),
        hasAllDays: hasActivitiesForAllDays,
        availabilityWarnings: activities.filter(a => !a.availability?.isAvailable).length
      }
    });

  } catch (error) {
    logger.error('Failed to generate activities:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const { activityId, productCode, name } = req.body;

    logger.info('[Activities API] Enriching activity:', {
      activityId,
      productCode,
      name
    });

    if (!productCode) {
      logger.warn('[Activities API] No product code provided');
      return res.status(400).json({ error: 'Product code is required' });
    }

    const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || '');

    try {
      // First try to search for the activity
      const searchResults = await viatorClient.searchActivity(`productCode:${productCode}`);
      
      let enrichedActivity;
      
      if (!searchResults || searchResults.length === 0) {
        // If product code search fails, try searching by name
        logger.warn('[Activities API] Product not found by code, trying name search:', {
          productCode,
          name
        });
        
        const nameSearchResults = await viatorClient.searchActivity(name);
        if (!nameSearchResults || nameSearchResults.length === 0) {
          throw new Error('Activity not found by code or name');
        }

        // Find the best matching activity from name search
        const bestMatch = nameSearchResults[0];
        logger.info('[Activities API] Found activity by name:', {
          activityId,
          foundName: bestMatch.name,
          originalName: name
        });

        // Now enrich with product details
        enrichedActivity = await viatorClient.enrichActivityDetails({
          ...bestMatch,
          name: name || bestMatch.name,
          referenceUrl: bestMatch.referenceUrl
        });
      } else {
        const basicActivity = searchResults[0];
        
        // Now enrich with product details
        enrichedActivity = await viatorClient.enrichActivityDetails({
          ...basicActivity,
          name: name || basicActivity.name,
          referenceUrl: `https://www.viator.com/tours/${productCode}`
        });
      }

      res.json(enrichedActivity);
    } catch (error) {
      logger.error('[Activities API] Error getting activity details:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activityId,
        productCode
      });
      throw error;
    }
  } catch (error) {
    logger.error('[Activities API] Error enriching activity:', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enrich activity',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 