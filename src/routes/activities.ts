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

// Add interface for grouped activities
interface GroupedActivities {
  [key: number]: {
    [key: string]: Activity[];
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

// Add interface for schedule optimization result
interface OptimizedSchedule {
  schedule: any[];
  dailyHighlights?: any[];
  tripOverview?: string;
}

// Add the optimizeSchedule function
async function optimizeSchedule(
  activities: Activity[],
  days: number,
  destination: string
): Promise<OptimizedSchedule> {
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

    // Create a basic schedule if no optimization is needed
    if (preselectedActivities.length === 0 && unselectedActivities.length === 0) {
      logger.warn('No activities to optimize, creating basic schedule');
      return createBasicSchedule(activities, days);
    }

    // Group activities by day and time slot
    const groupedActivities = groupActivitiesByDayAndSlot(activities, days);

    // Create schedule structure
    const schedule = [];
    for (let day = 1; day <= days; day++) {
      const dayActivities = groupedActivities[day];
      
      schedule.push({
        dayNumber: day,
        theme: `Day ${day} Exploration`,
        mainArea: "City Center",
        commentary: `Day ${day} activities arranged by time slots`,
        highlights: [`Day ${day} main activities`],
        activities: [
          ...dayActivities.morning,
          ...dayActivities.afternoon,
          ...dayActivities.evening
        ].map(activity => ({
          ...activity,
          startTime: activity.timeSlot === 'morning' ? '09:00' :
                    activity.timeSlot === 'afternoon' ? '14:00' : '19:00'
        }))
      });
    }

    return {
      schedule,
      tripOverview: 'Schedule optimized with balanced activities across days',
      dailyHighlights: schedule.map(day => ({
        dayNumber: day.dayNumber,
        theme: day.theme,
        highlights: day.highlights
      }))
    };
  } catch (error) {
    logger.error('Failed to optimize schedule:', error);
    return createBasicSchedule(activities, days);
  }
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
      activitiesToProcess.map(async (activity: ActivityToProcess): Promise<EnrichedActivityResult> => {
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
          const searchResults = await viatorClient.searchActivity(`${activity.name} in ${destination.label || destination}`);
          
          if (!searchResults || searchResults.length === 0) {
            logger.warn('[Viator API] No results found:', {
              name: activity.name,
              destination: destination.label || destination,
              searchType: 'name',
              timestamp: new Date().toISOString()
            });
            return activity;
          }

          // Use the first search result
          const bestMatch = searchResults[0];
          
          const locationValidation = validateLocation(bestMatch, destination);

          if (!locationValidation.isMatch) {
            logger.warn('[Viator API] Activity location mismatch:', {
              name: activity.name,
              expectedDestination: destinationName,
              destinationParts: locationValidation.destinationParts,
              actualLocations: locationValidation.locationSources,
              timestamp: new Date().toISOString()
            });
            return activity;
          }
          
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
            selectedTimeSlot: activity.timeSlot,
            pricing: {
              basePrice: enriched.pricing?.summary?.fromPrice,
              currency: enriched.pricing?.currency,
              priceType: enriched.pricing?.summary?.priceType,
              perTraveler: enriched.pricing?.summary?.perTraveler,
              specialOffer: enriched.pricing?.summary?.specialOffer
            },
            rating: {
              score: enriched.reviews?.combinedAverageRating,
              totalReviews: enriched.reviews?.totalReviews,
              verificationStatus: activity.verificationStatus
            },
            availability: {
              operatingHours: enrichedActivity.bookingDetails.availability.operatingHours,
              selectedStartTime: enrichedActivity.startTime || 
                (enrichedActivity.timeSlot === 'morning' ? '09:00' :
                 enrichedActivity.timeSlot === 'afternoon' ? '14:00' : '19:00')
            },
            bookingUrl: enrichedActivity.bookingDetails.referenceUrl
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