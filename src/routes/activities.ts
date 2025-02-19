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

activitiesRouter.post('/generate', async (req: Request, res: Response) => {
  try {
    perplexityCallCounter = 0; // Reset counter at start of each request
    logger.info('[Activities] Starting activity generation:', {
      destination: req.body.destination,
      days: req.body.days,
      hasPreferences: !!req.body.preferences,
      hasExistingActivities: !!req.body.existingActivities?.length,
      skipPerplexityGeneration: !!req.body.skipPerplexityGeneration
    });

    const { destination, days, budget, currency, flightTimes, preferences, existingActivities, skipPerplexityGeneration } = req.body;

    let activitiesToProcess;

    // If we have existing activities and skipPerplexityGeneration flag is true, use those
    if (existingActivities && Array.isArray(existingActivities) && existingActivities.length > 0 && skipPerplexityGeneration) {
      logger.info('[Activities] Using existing activities from budget calculation:', {
        count: existingActivities.length
      });
      activitiesToProcess = existingActivities;
    } else {
      // Only make Perplexity call if we don't have existing activities or skipPerplexityGeneration is false
      logger.info('[Activities] No existing activities or skipPerplexityGeneration=false, proceeding with generation');
      perplexityCallCounter++; // Increment counter
    const response = await perplexityClient.generateActivities({
        destination: destination.label || destination,
      days,
      budget,
      currency,
        preferences,
      flightTimes
    });

      activitiesToProcess = response?.activities || [];
      if (activitiesToProcess.length === 0) {
        logger.error('[Activities] No activities generated');
      return res.status(500).json({
        success: false,
          error: 'No activities could be generated',
        timestamp: new Date().toISOString(),
          perplexityCalls: perplexityCallCounter
        });
      }
    }

    // 2. Enrich activities with Viator data
    logger.info('[Activities] Starting Viator enrichment:', {
      totalActivities: activitiesToProcess.length
    });

    const enrichedActivities = await Promise.all(
      activitiesToProcess.map(async (activity) => {
        try {
          // Enhanced logging for Viator API calls
          logger.info('[Viator API] Searching activity:', {
            name: activity.name,
            searchParams: {
              query: activity.name,
              type: 'activity',
              destination: destination.label || destination
            }
          });

          // First try to search for the activity by name to get product code
          const searchResults = await viatorClient.searchActivity(activity.name);
          
          if (!searchResults || searchResults.length === 0) {
            logger.warn('[Viator API] No results found:', {
              name: activity.name,
              searchType: 'name',
              timestamp: new Date().toISOString()
            });
            return activity;
          }

          // Use the first search result
          const bestMatch = searchResults[0];
          const productCode = bestMatch.bookingInfo?.productCode;

          if (!productCode) {
            logger.warn('[Viator API] No product code in search result:', {
              name: activity.name,
              searchResult: bestMatch,
      timestamp: new Date().toISOString()
    });
            return activity;
          }

          logger.info('[Viator API] Product found:', {
            name: activity.name,
            productCode,
            matchScore: bestMatch.score || 'N/A',
            timestamp: new Date().toISOString()
          });

          // Now get detailed product info
          logger.info('[Viator API] Fetching product details:', {
      productCode,
            name: activity.name,
            timestamp: new Date().toISOString()
          });

          const enriched = await viatorClient.getProductDetails(productCode);
          if (!enriched) {
            logger.warn('[Viator API] No details found:', {
              name: activity.name,
              productCode,
              timestamp: new Date().toISOString()
            });
            return activity;
          }

          logger.info('[Viator API] Product details retrieved:', {
            productCode,
            name: activity.name,
            details: {
              hasBookingInfo: !!enriched.bookingInfo,
              hasPricing: !!enriched.pricing,
              hasReviews: !!enriched.reviews,
              hasImages: enriched.images?.length || 0,
              hasHighlights: enriched.highlights?.length || 0,
              price: enriched.pricing?.summary?.fromPrice,
              currency: enriched.pricing?.currency,
              rating: enriched.reviews?.combinedAverageRating,
              reviewCount: enriched.reviews?.totalReviews
            },
            timestamp: new Date().toISOString()
          });

          const enrichedActivity = {
            ...activity,
            bookingDetails: {
              provider: 'Viator',
              productCode,
              // Use the productUrl directly from the API response
              referenceUrl: enriched.productUrl || `https://www.viator.com/tours/${productCode}`,
              cancellationPolicy: enriched.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
              instantConfirmation: enriched.bookingInfo?.confirmationType === 'INSTANT' || true,
              mobileTicket: enriched.bookingInfo?.mobileTicketing || true,
              languages: enriched.bookingInfo?.languages || ['English'],
              minParticipants: enriched.bookingInfo?.minParticipants || 1,
              maxParticipants: enriched.bookingInfo?.maxParticipants || 15,
              pickupIncluded: enriched.bookingInfo?.pickup?.included || false,
              pickupLocation: enriched.bookingInfo?.pickup?.location || '',
              accessibility: enriched.bookingInfo?.accessibility || 'Standard',
              restrictions: enriched.bookingInfo?.restrictions || [],
              // Add availability data
              availability: {
                startTimes: enriched.availability?.startTimes || [],
                daysAvailable: enriched.availability?.daysAvailable || [],
                nextAvailableDate: enriched.availability?.nextAvailableDate,
                operatingHours: enriched.operatingHours || 'Operating hours not specified'
              }
            },
            price: {
              amount: enriched.pricing?.summary?.fromPrice || activity.price?.amount,
              currency: enriched.pricing?.currency || activity.price?.currency || 'USD'
            },
            rating: enriched.reviews?.combinedAverageRating || activity.rating,
            numberOfReviews: enriched.reviews?.totalReviews || activity.numberOfReviews,
            // Select only the main image (480x320 or first available)
            mainImage: enriched.images?.find(img => {
              const variants = img.variants || [];
              return variants.some(v => v.width === 480 && v.height === 320);
            })?.variants?.find(v => v.width === 480 && v.height === 320)?.url || 
            enriched.images?.[0]?.variants?.[0]?.url || '',
            highlights: enriched.highlights || activity.highlights || [],
            operatingHours: enriched.operatingHours || activity.operatingHours,
            location: {
              address: enriched.location?.address || activity.location?.address,
              coordinates: enriched.location?.coordinates || activity.location?.coordinates
            }
          };

          logger.info('[Activities] Successfully enriched activity:', {
            name: activity.name,
          productCode,
            hasBookingDetails: true,
            hasViatorData: true,
            mainImage: enrichedActivity.mainImage,
            selectedTimeSlot: enrichedActivity.timeSlot,
            availability: {
              operatingHours: enrichedActivity.bookingDetails.availability.operatingHours,
              selectedStartTime: enrichedActivity.startTime || 
                (enrichedActivity.timeSlot === 'morning' ? '09:00' :
                 enrichedActivity.timeSlot === 'afternoon' ? '14:00' : '19:00')
            },
            bookingUrl: enrichedActivity.bookingDetails.referenceUrl,
            enrichmentStatus: {
              hasRating: !!enrichedActivity.rating,
              hasReviews: !!enrichedActivity.numberOfReviews,
              hasHighlights: !!enrichedActivity.highlights?.length
            }
          });

          return enrichedActivity;
        } catch (error) {
          logger.error('[Activities] Failed to enrich activity:', {
            name: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          return activity;
        }
      })
    );

    const enrichedCount = enrichedActivities.filter(a => a.bookingDetails?.provider === 'Viator').length;
    logger.info('[Activities] Completed Viator enrichment:', {
      totalActivities: activitiesToProcess.length,
      enrichedCount,
      successRate: `${(enrichedCount / activitiesToProcess.length * 100).toFixed(1)}%`
    });

    // 3. Optimize schedule with enriched activities
    logger.info('[Activities] Starting schedule optimization');
    perplexityCallCounter++; // Increment counter for schedule optimization
    const optimizedSchedule = await optimizeSchedule(enrichedActivities, days, destination.label || destination);

    // 4. Return final response with Perplexity call counter
    return res.json({
      success: true,
      activities: enrichedActivities,
      schedule: optimizedSchedule.schedule,
      dailyPlans: optimizedSchedule.schedule,
      dailyHighlights: optimizedSchedule.dailyHighlights || [],
      metadata: {
        originalCount: activitiesToProcess.length,
        enrichedCount,
        finalCount: enrichedActivities.length,
        daysPlanned: days,
        destination,
        perplexityCalls: perplexityCallCounter,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('[Activities] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activity',
      timestamp: new Date().toISOString()
    });
  }
});

export { activitiesRouter };