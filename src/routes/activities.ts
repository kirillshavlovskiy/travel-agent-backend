import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';
import { Activity } from '../services/perplexity.js';

const activitiesRouter = Router();

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

activitiesRouter.post('/generate', async (req: Request, res: Response) => {
  try {
    perplexityCallCounter = 0; // Reset counter at start of each request
    
    // Log initial request
    logger.info('[Activities] Processing generation request:', {
      destination: req.body.destination,
      interests: req.body.interests,
      currency: req.body.currency || 'USD',
      timestamp: new Date().toISOString()
    });

    const { destination, days, budget, preferences, existingActivities, skipPerplexityGeneration } = req.body;
    const currency = req.body.currency || 'USD';

    let activitiesToProcess;

    // If we have existing activities and skipPerplexityGeneration flag is true, use those
    if (existingActivities && Array.isArray(existingActivities) && existingActivities.length > 0 && skipPerplexityGeneration) {
      logger.info('[Activities] Using existing activities from budget calculation:', {
        count: existingActivities.length
      });
      
      // Normalize prices of existing activities
      activitiesToProcess = existingActivities.map(activity => ({
        ...activity,
        price: normalizePrice(activity.price)
      }));
    } else {
      // Only make Perplexity call if we don't have existing activities or skipPerplexityGeneration is false
      logger.info('[Activities] No existing activities or skipPerplexityGeneration=false, proceeding with generation');
      perplexityCallCounter++;
      
      const response = await perplexityClient.generateActivities({
        destination: destination.label || destination,
        days,
        budget,
        currency: 'USD', // Always request USD prices
        preferences
      });

      activitiesToProcess = response?.activities?.map(activity => ({
        ...activity,
        price: normalizePrice(activity.price)
      })) || [];
    }

    // Log pre-enrichment prices
    logger.info('[Activities] Pre-enrichment prices:', {
      activities: activitiesToProcess.map(a => ({
        name: a.name,
        price: a.price
      })),
      timestamp: new Date().toISOString()
    });

    // Enrich activities with Viator data
    const enrichedActivities = await Promise.all(
      activitiesToProcess.map(async (activity) => {
        try {
          const productCode = activity.bookingInfo?.productCode || 
                            activity.referenceUrl?.match(/\-([a-zA-Z0-9]+)(?:\?|$)/)?.[1];

          if (!productCode) {
            return {
              ...activity,
              price: normalizePrice(activity.price)
            };
          }

          const enriched = await viatorClient.getProductDetails(productCode);
          
          if (!enriched) {
            return {
              ...activity,
              price: normalizePrice(activity.price)
            };
          }

          // Use normalized price from Viator service
          return {
            ...activity,
            price: enriched.price || normalizePrice(activity.price),
            pricingDetails: enriched.pricing
          };
        } catch (error) {
          const err = error as Error;
          logger.error('[Activities] Enrichment error:', {
            name: activity.name,
            error: err.message,
            timestamp: new Date().toISOString()
          });
          return {
            ...activity,
            price: normalizePrice(activity.price)
          };
        }
      })
    );

    // Calculate price statistics
    const activitiesWithPrices = enrichedActivities.filter(a => (a.price?.amount || 0) > 0);
    const totalPrice = activitiesWithPrices.reduce((sum, a) => sum + (a.price?.amount || 0), 0);
    const averagePrice = activitiesWithPrices.length > 0 ? totalPrice / activitiesWithPrices.length : 0;

    // Log final price statistics
    logger.info('[Activities] Generation complete:', {
      totalActivities: enrichedActivities.length,
      activitiesWithPrices: activitiesWithPrices.length,
      totalPrice,
      averagePrice,
      currency: 'USD',
      timestamp: new Date().toISOString()
    });

    res.json({
      activities: enrichedActivities,
      metadata: {
        totalActivities: enrichedActivities.length,
        enrichedCount: activitiesWithPrices.length,
        totalPrice,
        averagePrice,
        currency: 'USD'
      }
    });
  } catch (error) {
    const err = error as Error;
    logger.error('[Activities] Generation error:', {
      error: err.message,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ error: 'Failed to generate activities' });
  }
});

export { activitiesRouter };