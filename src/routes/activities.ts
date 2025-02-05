import { Router, Request, Response } from 'express';
import { perplexityClient } from '../services/perplexity.js';
import { viatorClient } from '../services/viator.js';
import { logger } from '../utils/logger.js';
import { ViatorService } from '../services/viator.js';

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

router.post('/generate', async (req: Request, res: Response) => {
  try {
    // Add detailed request logging
    logger.info('Raw request body:', {
      hasDestination: !!req.body.destination,
      hasDays: !!req.body.days,
      hasBudget: !!req.body.budget,
      hasCurrency: !!req.body.currency,
      hasPreferences: !!req.body.preferences,
      rawPreferences: req.body.preferences, // Log the raw preferences object
      body: req.body // Log the entire body for debugging
    });

    const { destination, days, budget, currency, flightTimes, preferences: rawPreferences } = req.body;

    // Log extracted values
    logger.info('Extracted values:', {
      destination,
      days,
      budget,
      currency,
      hasFlightTimes: !!flightTimes,
      rawPreferences
    });

    // Validate required fields
    if (!destination || !days || !budget || !currency) {
      logger.warn('Missing required fields:', {
        hasDestination: !!destination,
        hasDays: !!days,
        hasBudget: !!budget,
        hasCurrency: !!currency
      });
      return res.status(400).json({
        error: 'Missing required fields: destination, days, budget, and currency are required',
        timestamp: new Date().toISOString(),
        receivedFields: {
          destination: !!destination,
          days: !!days,
          budget: !!budget,
          currency: !!currency
        }
      });
    }

    // Log raw preferences before validation
    logger.info('Raw preferences before validation:', rawPreferences);

    // Validate and get preferences with defaults
    const preferences = validatePreferences(rawPreferences);

    // Log final preferences after validation
    logger.info('Final preferences after validation:', preferences);

    logger.info('Received activity generation request with preferences:', {
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences: {
        travelStyle: preferences.travelStyle,
        pacePreference: preferences.pacePreference,
        interests: preferences.interests,
        accessibility: preferences.accessibility,
        dietaryRestrictions: preferences.dietaryRestrictions
      }
    });

    // Get initial activity suggestions from Perplexity
    const query = `List popular activities in ${destination} with:
- Name and location
- Time slot (morning/afternoon/evening)
- Basic category

Return JSON array:
[{
  "name": "activity name",
  "location": "area name",
  "timeSlot": "morning|afternoon|evening",
  "category": "Cultural|Nature|Food|Local"
}]`;

    logger.debug('Sending query to Perplexity API', { query });
    const response = await perplexityClient.chat(query);
    
    const parsedData = response;
    if (!parsedData.activities || !Array.isArray(parsedData.activities)) {
      logger.error('Invalid data structure', { parsedData });
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
            logger.warn('No Viator activities found for:', activity.name);
            return null;
          }
          
          const enrichedResults = await Promise.all(
            searchResults.map(async (result) => {
              const enriched = await viatorClient.enrichActivityDetails(result);
              if (!enriched) return null;

              // Use validated preferences for scoring
              const score = calculateActivityScore(enriched, preferences);
              
              return {
                ...enriched,
                ...score
              };
            })
          );

          return enrichedResults.filter(Boolean);
        } catch (error) {
          logger.error('Failed to enrich activity:', {
            activity: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          return null;
        }
      })
    );

    // Flatten and filter out failed enrichments
    const validActivities = enrichedActivities
      .filter(result => result !== null)
      .flat()
      .filter((activity, index, self) => 
        index === self.findIndex(a => a?.bookingInfo?.productCode === activity?.bookingInfo?.productCode)
      );

    // Log scoring details
    validActivities.forEach(activity => {
      logger.info('Activity scoring details:', {
        name: activity.name,
        score: activity.preferenceScore,
        matchedPreferences: activity.matchedPreferences,
        scoringReason: activity.scoringReason
      });
    });

    // Sort activities by score before optimization
    const sortedActivities = validActivities.sort((a, b) => 
      (b.preferenceScore - a.preferenceScore) || ((b.rating || 0) - (a.rating || 0))
      );

    // Helper function to calculate similarity between activities
    const calculateSimilarity = (activity1: any, activity2: any): number => {
      const name1 = activity1.name.toLowerCase();
      const name2 = activity2.name.toLowerCase();
      const desc1 = activity1.description?.toLowerCase() || '';
      const desc2 = activity2.description?.toLowerCase() || '';

      // Calculate name similarity
      const nameSimilarity = name1 === name2 ? 1 : 
        name1.includes(name2) || name2.includes(name1) ? 0.8 :
        0;

      // Calculate description similarity if both exist
      const descSimilarity = desc1 && desc2 ? 
        (desc1 === desc2 ? 1 :
        desc1.includes(desc2) || desc2.includes(desc1) ? 0.7 :
        0) : 0;

      // Calculate location similarity
      const locationSimilarity = activity1.location === activity2.location ? 1 : 0;

      // Weighted average
      return (nameSimilarity * 0.5) + (descSimilarity * 0.3) + (locationSimilarity * 0.2);
    };

    // Simplify to just handle deduplication
    const deduplicateActivities = (activities: any[]): any[] => {
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
        const durationInMinutes = activity.duration || 0;
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
    };

    // After deduplication, add scheduling optimization
    const optimizeSchedule = async (activities: any[], days: number, destination: string): Promise<any> => {
      try {
        const query = `Optimize this ${days}-day schedule for ${destination} with these activities:
${activities.map(a => `- ${a.name} (${a.duration || 'N/A'} hours)`).join('\n')}

REQUIREMENTS:
1. Create a balanced schedule across ${days} days
2. Group nearby activities on the same day
3. Consider activity durations and opening hours
4. Allow 2-4 activities per day
5. Mix different types of activities

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
- schedule: array of days with activities and timeSlots
- dayPlanningLogic: detailed reasoning for each day's plan
- tripOverview: overall trip organization logic
- activityFitNotes: why activities were included/excluded`;

        const response = await perplexityClient.chat(query);
        
        // If optimization fails, create a basic schedule
        if (!response?.schedule) {
          logger.warn('Creating basic schedule due to optimization failure');
          return createBasicSchedule(activities, days);
        }

        logger.info('Schedule optimization reasoning:', {
          tripOverview: response.tripOverview,
          activityFitNotes: response.activityFitNotes
        });

        return response;
      } catch (error) {
        logger.error('Failed to optimize schedule:', error);
        return createBasicSchedule(activities, days);
      }
    };

    // Helper function to create a basic schedule
    const createBasicSchedule = (activities: any[], days: number) => {
      const schedule = [];
      let activityIndex = 0;

      for (let day = 1; day <= days; day++) {
        const dayActivities = [];
        // Add up to 3 activities per day
        for (let slot = 0; slot < 3 && activityIndex < activities.length; slot++) {
          const activity = activities[activityIndex++];
          dayActivities.push({
            name: activity.name,
            timeSlot: ['morning', 'afternoon', 'evening'][slot],
            startTime: ['09:00', '14:00', '19:00'][slot]
          });
        }

        schedule.push({
          dayNumber: day,
          activities: dayActivities,
          dayPlanningLogic: 'Basic schedule with evenly distributed activities'
        });
      }

      return { schedule };
    };

    // Use in main flow:
    const dedupedActivities = deduplicateActivities(sortedActivities);

    if (dedupedActivities.length === 0) {
      logger.warn('No activities found after deduplication');
      return res.status(200).json({
        activities: [],
        message: "No valid activities found after deduplication.",
        error: true
      });
    }

    try {
      // Optimize the schedule
      const optimizedSchedule = await optimizeSchedule(dedupedActivities, days, destination);
      
      // Log the planning logic for each day
      optimizedSchedule.schedule.forEach((day: any) => {
        logger.info(`Day ${day.dayNumber} Planning:`, {
          dayNumber: day.dayNumber,
          planningLogic: day.dayPlanningLogic,
          activityCount: day.activities.length,
          activities: day.activities.map((a: any) => ({
            name: a.name,
            timeSlot: a.timeSlot,
            startTime: a.startTime
          }))
        });
      });

      // Transform activities based on the optimized schedule
      const transformedActivities = optimizedSchedule.schedule.flatMap((day: any) => 
        day.activities.map((activity: any) => {
          const originalActivity = dedupedActivities.find(a => a.name === activity.name);
          if (!originalActivity) return null;

      // Get price value
      let price = 0;
          if (typeof originalActivity?.price === 'object' && originalActivity.price !== null) {
            price = originalActivity.price.amount || 0;
          } else if (typeof originalActivity?.price === 'number') {
            price = originalActivity.price;
          } else if (typeof originalActivity?.price === 'string') {
            price = originalActivity.price.toLowerCase() === 'free' ? 0 : parseFloat(originalActivity.price) || 0;
      }

      // Determine tier based on price
      const tier = price <= 50 ? 'budget' : price <= 150 ? 'medium' : 'premium';

          // Format location data properly
          const formattedLocation = (() => {
            if (typeof originalActivity.location === 'object') {
              // If location is an object, extract the main address or first meeting point
              return originalActivity.location.address || 
                     (originalActivity.location.meetingPoints?.[0]?.address) ||
                     (originalActivity.location.startingLocations?.[0]?.address) ||
                     'Location details available upon booking';
            }
            return originalActivity.location || 'Location details available upon booking';
          })();

      return {
            ...originalActivity,
            category: activity.category,
            timeSlot: activity.timeSlot,
            dayNumber: day.dayNumber,
            startTime: activity.startTime,
            scoringReason: activity.scoringReason,
            dayPlanningLogic: day.dayPlanningLogic,
            tier,
            // Ensure location is a string
            location: formattedLocation,
        price: {
          amount: price,
          currency: req.body.currency || 'USD'
            }
          };
        }).filter(Boolean)
      );

    // Group activities by day and tier for suggested itineraries
    const groupedActivities = new Map();

    // Initialize groups for each day
    for (let day = 1; day <= days; day++) {
      groupedActivities.set(day, {
        budget: { morning: [], afternoon: [], evening: [] },
        medium: { morning: [], afternoon: [], evening: [] },
        premium: { morning: [], afternoon: [], evening: [] }
      });
    }

    // Group activities by day, tier, and time slot
    transformedActivities.forEach(activity => {
      const dayGroup = groupedActivities.get(activity.dayNumber);
      if (dayGroup?.[activity.tier]?.[activity.timeSlot]) {
        dayGroup[activity.tier][activity.timeSlot].push(activity);
      }
    });

    // Create suggested itineraries
    const suggestedItineraries: Record<string, any[]> = {
      budget: [],
      medium: [],
      premium: []
    };

    // Generate itineraries for each day
    for (let day = 1; day <= days; day++) {
      const dayActivities = groupedActivities.get(day) || {
        budget: { morning: [], afternoon: [], evening: [] },
        medium: { morning: [], afternoon: [], evening: [] },
        premium: { morning: [], afternoon: [], evening: [] }
      };

      // Budget tier
      suggestedItineraries.budget.push({
        dayNumber: day,
        morning: dayActivities?.budget?.morning?.[0] || null,
        afternoon: dayActivities?.budget?.afternoon?.[0] || null,
        evening: dayActivities?.budget?.evening?.[0] || null,
        morningOptions: dayActivities?.budget?.morning || [],
        afternoonOptions: dayActivities?.budget?.afternoon || [],
        eveningOptions: dayActivities?.budget?.evening || []
      });

      // Medium tier (includes budget options as fallback)
      suggestedItineraries.medium.push({
        dayNumber: day,
        morning: dayActivities?.medium?.morning?.[0] || dayActivities?.budget?.morning?.[0] || null,
        afternoon: dayActivities?.medium?.afternoon?.[0] || dayActivities?.budget?.afternoon?.[0] || null,
        evening: dayActivities?.medium?.evening?.[0] || dayActivities?.budget?.evening?.[0] || null,
        morningOptions: [...(dayActivities?.medium?.morning || []), ...(dayActivities?.budget?.morning || [])],
        afternoonOptions: [...(dayActivities?.medium?.afternoon || []), ...(dayActivities?.budget?.afternoon || [])],
        eveningOptions: [...(dayActivities?.medium?.evening || []), ...(dayActivities?.budget?.evening || [])]
      });

      // Premium tier (includes medium and budget options as fallback)
      suggestedItineraries.premium.push({
        dayNumber: day,
        morning: dayActivities?.premium?.morning?.[0] || dayActivities?.medium?.morning?.[0] || dayActivities?.budget?.morning?.[0] || null,
        afternoon: dayActivities?.premium?.afternoon?.[0] || dayActivities?.medium?.afternoon?.[0] || dayActivities?.budget?.afternoon?.[0] || null,
        evening: dayActivities?.premium?.evening?.[0] || dayActivities?.medium?.evening?.[0] || dayActivities?.budget?.evening?.[0] || null,
        morningOptions: [...(dayActivities?.premium?.morning || []), ...(dayActivities?.medium?.morning || []), ...(dayActivities?.budget?.morning || [])],
        afternoonOptions: [...(dayActivities?.premium?.afternoon || []), ...(dayActivities?.medium?.afternoon || []), ...(dayActivities?.budget?.afternoon || [])],
        eveningOptions: [...(dayActivities?.premium?.evening || []), ...(dayActivities?.medium?.evening || []), ...(dayActivities?.budget?.evening || [])]
      });
    }

    res.json({
      activities: transformedActivities,
        suggestedItineraries,
        schedule: optimizedSchedule.schedule.map((day: any) => ({
          dayNumber: day.dayNumber,
          planningLogic: day.dayPlanningLogic,
          activities: day.activities
        })),
        categoryDistribution: optimizedSchedule.categoryDistribution
    });

  } catch (error) {
    logger.error('Failed to generate activities', { error: error instanceof Error ? error.message : 'Unknown error' });
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate activities',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Failed to generate activities', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    res.status(500).json({
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