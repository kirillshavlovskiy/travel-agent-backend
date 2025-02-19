import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';
import { Activity } from '../services/perplexity.js';

const router = Router();

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

// Add schedule optimization function
async function optimizeSchedule(activities: Activity[], days: number, destination: string): Promise<any> {
  try {
    // First, separate preselected activities from the rest
    const preselectedActivities = activities.filter(a => a.selected);
    const unselectedActivities = activities.filter(a => !a.selected);

    logger.info('Optimizing schedule with enriched activities:', {
      totalActivities: activities.length,
      preselected: preselectedActivities.length,
      unselected: unselectedActivities.length,
      enrichedCount: activities.filter(a => a.bookingDetails?.provider === 'Viator').length
    });

    const query = `Create a detailed ${days}-day schedule for ${destination} with these activities:

PRESELECTED ACTIVITIES (MUST BE INCLUDED):
${preselectedActivities.map(a => {
  const details = a.bookingDetails || {};
  return `- ${a.name} (${a.duration || 'N/A'} minutes, ${a.timeSlot}, Day ${a.dayNumber})
    * Operating Hours: ${details.operatingHours || 'Not specified'}
    * Location: ${details.pickupLocation || a.location || 'Not specified'}
    * Booking Required: ${details.instantConfirmation ? 'Yes' : 'No'}`;
}).join('\n')}

AVAILABLE ACTIVITIES TO FILL GAPS:
${unselectedActivities.map(a => {
  const details = a.bookingDetails || {};
  return `- ${a.name} (${a.duration || 'N/A'} minutes)
    * Operating Hours: ${details.operatingHours || 'Not specified'}
    * Location: ${details.pickupLocation || a.location || 'Not specified'}`;
}).join('\n')}

REQUIREMENTS:
1. CRITICAL: Include ALL preselected activities in their specified days and time slots
2. Create a balanced schedule across ${days} days
3. Group nearby activities on the same day
4. Consider activity durations and operating hours
5. Allow 4-6 activities per day
6. Mix different types of activities
7. Include breaks and meal times
8. Consider travel time between activities

PROVIDE FOR EACH DAY:
1. Detailed timeline with specific start times
2. Travel logistics between activities
3. Suggested breaks and meal times
4. Special considerations (crowds, weather, etc.)
5. Alternative options if needed

ALSO PROVIDE:
1. Overall trip flow explanation
2. Daily highlights and themes
3. Transportation recommendations
4. Dining suggestions
5. Tips for timing and logistics

Return as JSON with:
{
  "schedule": [{
    "dayNumber": number,
    "dayPlanningLogic": "detailed reasoning for day's plan",
    "timeline": [{
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "activity": "activity name or break description",
      "type": "activity|break|travel|meal",
      "details": "specific details or recommendations"
    }],
    "activities": [{
      "name": "activity name",
      "timeSlot": "morning|afternoon|evening",
      "startTime": "HH:MM",
      "commentary": "why this activity was chosen",
      "itineraryHighlight": "how it fits in the day's flow",
      "logistics": "travel and timing details"
    }],
    "breaks": [{
      "type": "meal|rest|travel",
      "startTime": "HH:MM",
      "duration": "minutes",
      "suggestions": "specific recommendations"
    }]
  }],
  "tripOverview": "overall trip organization logic",
  "dailyHighlights": [{
    "dayNumber": number,
    "theme": "day's theme or focus",
    "highlights": ["key moments or experiences"]
  }],
  "logisticsAdvice": {
    "transportation": ["transportation recommendations"],
    "timing": ["timing tips and considerations"],
    "general": ["general logistics advice"]
  }
}`;

        const response = await perplexityClient.chat(query);
        
        if (!response?.schedule) {
          logger.warn('Creating basic schedule due to optimization failure');
          return createBasicSchedule(activities, days);
        }

        logger.info('Schedule optimization complete:', {
          tripOverview: response.tripOverview,
          dailyHighlights: response.dailyHighlights,
          logisticsAdvice: response.logisticsAdvice,
          daysScheduled: response.schedule.length
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
      logger.warn('Some preselected activities missing from schedule:', {
        missing: missingPreselected.map(a => ({
          name: a.name,
          day: a.dayNumber,
          timeSlot: a.timeSlot,
          hasViatorData: !!a.bookingDetails?.provider
        }))
      });
      return createBasicSchedule(activities, days);
    }

    // Map the schedule activities back to our enriched activities
    const enrichedSchedule = response.schedule.map((day: any) => ({
      ...day,
      activities: day.activities.map((scheduledActivity: any) => {
        // Find the matching enriched activity
        const enrichedActivity = activities.find(a => 
          a.name === scheduledActivity.name && 
          (a.dayNumber === day.dayNumber || !scheduledActivity.dayNumber) &&
          (a.timeSlot === scheduledActivity.timeSlot || !scheduledActivity.timeSlot)
        );

        if (enrichedActivity) {
          return {
            ...enrichedActivity,
            ...scheduledActivity,
            // Preserve enriched data
            bookingDetails: enrichedActivity.bookingDetails,
            viatorData: enrichedActivity.viatorData,
            isEnriched: true, // Add flag to track enrichment
            // Add schedule-specific data
            dayNumber: day.dayNumber,
            timeSlot: scheduledActivity.timeSlot || enrichedActivity.timeSlot,
            startTime: scheduledActivity.startTime,
            selected: enrichedActivity.selected || false,
            commentary: scheduledActivity.commentary || enrichedActivity.commentary,
            itineraryHighlight: scheduledActivity.itineraryHighlight || enrichedActivity.itineraryHighlight
          };
        }

        // If no matching enriched activity found, return as is with enrichment flag
        return {
          ...scheduledActivity,
          isEnriched: false
        };
      })
    }));

    logger.info('Schedule enrichment complete:', {
      daysScheduled: enrichedSchedule.length,
      totalActivities: enrichedSchedule.reduce((sum, day) => sum + day.activities.length, 0),
      enrichedActivities: enrichedSchedule.reduce((sum, day) => 
        sum + day.activities.filter(a => a.isEnriched || a.bookingDetails?.provider === 'Viator').length, 0
      )
    });

    return {
      schedule: enrichedSchedule,
      tripOverview: response.tripOverview,
      dailyHighlights: response.dailyHighlights || [],
      logisticsAdvice: response.logisticsAdvice
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

// Add price normalization helper
function normalizePrice(price: any): { amount: number; currency: string } {
  if (!price) {
    return { amount: 0, currency: 'USD' };
  }

  return {
    amount: typeof price === 'number' ? price : (price.amount || 0),
    currency: price?.currency || 'USD'
  };
}

router.post('/generate', async (req: Request, res: Response) => {
  try {
    // Add detailed request logging
    logger.info('[Activities] Processing generation request:', {
      destination: req.body.destination,
      days: req.body.days,
      budget: req.body.budget,
      currency: req.body.currency,
      hasPreferences: !!req.body.preferences,
      timestamp: new Date().toISOString()
    });

    const { destination, days, budget, currency, preferences: rawPreferences } = req.body;

    // Validate required fields
    if (!destination || !days || !budget || !currency) {
      logger.warn('[Activities] Missing required fields:', {
        hasDestination: !!destination,
        hasDays: !!days,
        hasBudget: !!budget,
        hasCurrency: !!currency
      });
      return res.status(400).json({
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }

    // Validate and get preferences with defaults
    const preferences = {
      ...rawPreferences,
      budget: {
        limit: budget,
        currency: currency || 'USD'
      }
    };

    // Get initial activity suggestions from Perplexity
    const query = `Create a ${days}-day activity plan for ${destination} with the following requirements:

BUDGET & QUALITY:
- Daily budget: ${budget} ${currency} per person
- Minimum rating: 4.0+ stars
- Must have at least 50 reviews

ACTIVITY CATEGORIES:
- Cultural & Historical: museums, historic sites, monuments
- Nature & Adventure: parks, tours, outdoor activities
- Food & Entertainment: dining, shows, experiences
- Shopping & Local Life: markets, neighborhoods, local culture

TIME SLOTS:
- Morning (9:00-13:00): Prefer cultural & historical
- Afternoon (14:00-18:00): Prefer nature & adventure
- Evening (19:00-23:00): Prefer food & entertainment

CRITICAL RULES:
1. Only include activities that take 1 day or less
2. Group activities by area to minimize travel time
3. Mix different types of activities each day
4. Consider opening hours and seasonal factors
5. Include variety in each day's schedule

Return ONLY valid JSON with schedule array.`;

    logger.debug('[Activities] Sending query to Perplexity API', { query });
    const response = await perplexityClient.chat(query);
    
    const parsedData = response;
    if (!parsedData.activities || !Array.isArray(parsedData.activities)) {
      logger.error('[Activities] Invalid data structure', { parsedData });
      throw new Error('Invalid response format: missing or invalid activities array');
    }

    // Ensure all activities are unselected after regeneration
    parsedData.activities = parsedData.activities.map(activity => ({
      ...activity,
      selected: false
    }));

    // Enrich activities with Viator data
    const viatorClient = new ViatorService(process.env.VIATOR_API_KEY || '');
    const enrichedActivities = await Promise.all(
      parsedData.activities.map(async (activity: any) => {
        try {
          const searchResults = await viatorClient.searchActivity(`${activity.name} ${destination}`);
          if (!searchResults || searchResults.length === 0) {
            logger.warn('[Activities] No Viator activities found for:', activity.name);
            return activity;
          }
          
          const enrichedResults = await Promise.all(
            searchResults.map(async (result) => {
              const enriched = await viatorClient.enrichActivityDetails(result);
              if (!enriched) return null;

              // Use validated preferences for scoring
              const score = calculateActivityScore(enriched, preferences);
              
              return {
                ...enriched,
                ...score,
                images: enriched.images || [],
                bookingInfo: {
                  productCode: enriched.bookingInfo?.productCode || '',
                  cancellationPolicy: enriched.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                  instantConfirmation: true,
                  mobileTicket: true,
                  languages: enriched.bookingInfo?.languages || ['English'],
                  minParticipants: enriched.bookingInfo?.minParticipants || 1,
                  maxParticipants: enriched.bookingInfo?.maxParticipants || 99
                },
                meetingPoint: enriched.meetingPoint || undefined,
                highlights: enriched.highlights || [],
                operatingHours: enriched.operatingHours || '',
                isVerified: true,
                verificationStatus: 'verified' as const
              };
            })
          );

          const validResults = enrichedResults.filter(Boolean);
          return validResults.length > 0 ? validResults[0] : activity;
        } catch (error) {
          logger.error('[Activities] Failed to enrich activity:', {
            activity: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          return activity;
        }
      })
    );

    // Deduplicate activities
    const dedupedActivities = deduplicateActivities(enrichedActivities);

    // Optimize schedule
    const optimizedSchedule = await optimizeSchedule(dedupedActivities, days, destination);

    res.json({
      activities: dedupedActivities,
      suggestedItineraries: optimizedSchedule.schedule.reduce((acc, day) => {
        const tier = preferences.travelStyle.toLowerCase();
        if (!acc[tier]) acc[tier] = [];
        acc[tier].push(day);
        return acc;
      }, {} as Record<string, any[]>),
      schedule: optimizedSchedule.schedule,
      tripOverview: optimizedSchedule.tripOverview,
      dailyHighlights: optimizedSchedule.dailyHighlights || [],
      logisticsAdvice: optimizedSchedule.logisticsAdvice || {}
    });
  } catch (error) {
    logger.error('[Activities] Generation error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;