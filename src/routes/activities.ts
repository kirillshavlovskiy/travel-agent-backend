import { Router, Request, Response } from 'express';
import { getPerplexityClient } from '../services/perplexity';
import { viatorClient } from '../services/viator';
import { logger, logActivity, logPerplexity, logViator } from '../utils/logger';
import { ViatorService } from '../services/viator';
import { Activity } from '../types/activities';
import { TravelPreferences } from '../types/preferences';

interface Activity {
  name: string;
  description?: string;
  duration?: number;
  price?: {
    amount: number;
    currency: string;
  };
  category?: string;
  location?: string;
  timeSlot?: string;
  startTime?: string;
  dayNumber?: number;
  rating?: number;
  isVerified?: boolean;
  verificationStatus?: string;
  tier?: string;
  selected?: boolean;
  preferenceScore?: number;
  scoringReason?: string;
  geographicalGroup?: string;
}

// Add missing utility functions
function countCategories(activities: any[]): Record<string, number> {
  return activities.reduce((acc: Record<string, number>, activity) => {
    const category = activity.category || 'Uncategorized';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
}

interface CategoryDistribution {
  [category: string]: {
    count: number;
    percentage: number;
    byTier: {
      budget: number;
      medium: number;
      premium: number;
    };
  };
}

function calculateDistribution(activities: any[]): CategoryDistribution {
  const total = activities.length;
  const categories = activities.reduce((acc: CategoryDistribution, activity) => {
    const category = activity.category || 'Uncategorized';
    const price = activity.price?.amount || 0;
    const tier = price <= 50 ? 'budget' : price <= 150 ? 'medium' : 'premium';

    if (!acc[category]) {
      acc[category] = {
        count: 0,
        percentage: 0,
        byTier: { budget: 0, medium: 0, premium: 0 }
      };
    }

    acc[category].count++;
    acc[category].percentage = (acc[category].count / total) * 100;
    acc[category].byTier[tier]++;

    return acc;
  }, {});

  return categories;
}

interface GeneratedActivity {
  name: string;
  description?: string;
  timeSlot: string;
  dayNumber: number;
  category: string;
  price: {
    amount: number;
    currency: string;
  };
  selected?: boolean;
  preferenceScore?: number;
  matchedPreferences?: string[];
  scoringReason?: string;
  assigned?: boolean;
  location?: string;
}

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
function calculateActivityScore(activity: any, preferences: TravelPreferences): ActivityScore {
  const score: ActivityScore = {
    preferenceScore: 0,
    matchedPreferences: [],
    scoringReason: ''
  };

  if (!activity || !preferences) {
    return score;
  }

  let totalScore = 0;
  const reasons: string[] = [];

  // Interest matching (weighted heavily as primary factor)
  const interests = [
    'Art & Museums', 'History', 'Architecture', 'Local Culture',
    'Food & Wine', 'Shopping', 'Nature', 'Adventure', 'Photography',
    'Music', 'Nightlife', 'Relaxation'
  ];
  
  const matchedInterests = interests.filter(interest => {
    const interestLower = interest.toLowerCase();
    return (
      activity.description?.toLowerCase().includes(interestLower) ||
      activity.category?.toLowerCase().includes(interestLower) ||
      activity.tags?.some((tag: string) => tag.toLowerCase().includes(interestLower))
    );
  });

  if (matchedInterests.length > 0) {
    totalScore += matchedInterests.length * 2;
    score.matchedPreferences.push(...matchedInterests);
    reasons.push(`Matches interests: ${matchedInterests.join(', ')}`);
  }

  // Pace Preference matching
  if (activity.duration) {
    const duration = typeof activity.duration === 'number' ? 
      activity.duration : 
      (activity.duration.max + activity.duration.min) / 2;
    
    const isModerate = duration >= 2 && duration <= 4;
    if (preferences.pacePreference === 'Moderate' && isModerate) {
      totalScore += 2;
      score.matchedPreferences.push('Moderate pace');
      reasons.push('Matches moderate pace preference');
    }
  }

  // Accessibility Needs matching
  const accessibilityKeywords = {
    'Wheelchair Accessible': ['wheelchair', 'accessible', 'ada'],
    'Limited Mobility': ['limited mobility', 'easy access', 'accessible'],
    'Stroller Friendly': ['stroller', 'baby friendly', 'family friendly'],
    'Elderly Friendly': ['senior', 'elderly', 'easy walking', 'gentle']
  };

  Object.entries(accessibilityKeywords).forEach(([need, keywords]) => {
    if (preferences.accessibility.includes(need)) {
      const matches = keywords.some(keyword => 
        activity.description?.toLowerCase().includes(keyword) ||
        activity.accessibility?.some((feature: string) => 
          feature.toLowerCase().includes(keyword)
        )
      );
      
      if (matches) {
        totalScore += 2;
        score.matchedPreferences.push(need);
        reasons.push(`Accommodates ${need}`);
      }
    }
  });

  // Dietary Restrictions matching
  const dietaryKeywords = {
    'Vegetarian': ['vegetarian', 'veggie'],
    'Vegan': ['vegan', 'plant-based'],
    'Gluten-Free': ['gluten-free', 'gluten free'],
    'Halal': ['halal'],
    'Kosher': ['kosher'],
    'Dairy-Free': ['dairy-free', 'dairy free', 'lactose-free']
  };

  if (activity.category?.toLowerCase().includes('food') || 
      activity.description?.toLowerCase().includes('meal') ||
      activity.description?.toLowerCase().includes('dining')) {
    Object.entries(dietaryKeywords).forEach(([restriction, keywords]) => {
      if (preferences.dietaryRestrictions.includes(restriction)) {
        const matches = keywords.some(keyword =>
          activity.description?.toLowerCase().includes(keyword) ||
          activity.dietary?.some((diet: string) =>
            diet.toLowerCase().includes(keyword)
          )
        );
        
        if (matches) {
          totalScore += 2;
          score.matchedPreferences.push(restriction);
          reasons.push(`Accommodates ${restriction} diet`);
        }
      }
    });
  }

  // Travel Style matching (Balanced)
  if (preferences.travelStyle === 'Balanced') {
    // For balanced style, we look for activities that combine different aspects
    const hasMultipleAspects = matchedInterests.length >= 2;
    if (hasMultipleAspects) {
      totalScore += 2;
      score.matchedPreferences.push('Balanced experience');
      reasons.push('Offers mixed experiences');
    }
  }

  // Quality factors
  if (activity.rating) {
    if (activity.rating >= 4.5) {
      totalScore += 2;
      reasons.push('Highly rated (4.5+)');
    } else if (activity.rating >= 4.0) {
      totalScore += 1;
      reasons.push('Well rated (4.0+)');
    }
  }

  if (activity.numberOfReviews) {
    if (activity.numberOfReviews >= 1000) {
      totalScore += 2;
      reasons.push('Very popular (1000+ reviews)');
    } else if (activity.numberOfReviews >= 500) {
      totalScore += 1;
      reasons.push('Popular (500+ reviews)');
    }
  }

  score.preferenceScore = totalScore;
  score.scoringReason = reasons.join('; ');

  return score;
}

// Add getTimeSlotValue function
function getTimeSlotValue(timeSlot: string | undefined): number {
  if (!timeSlot) return 0;
  
  const slot = timeSlot.toLowerCase();
  switch (slot) {
    case 'morning':
      return 0;
    case 'afternoon':
      return 1;
    case 'evening':
      return 2;
    case 'dinner':
      return 3;
    default:
      return 4;
  }
}

// Add new interfaces at the top
interface GeoLocation {
  latitude: number;
  longitude: number;
  area: string;
  address: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

interface DailyPlan {
  dayNumber: number;
  theme: string;
  mainArea: string;
  activities: {
    morning: PlannedActivity[];
    afternoon: PlannedActivity[];
    evening: PlannedActivity[];
  };
  breaks: {
    morning?: Break;
    lunch?: Break;
    afternoon?: Break;
    dinner?: Break;
  };
  logistics: {
    transportSuggestions: string[];
    walkingDistances: string[];
    timeEstimates: string[];
  };
  commentary: string;
  highlights: string[];
}

interface Break {
  startTime: string;
  endTime: string;
  duration: number;
  suggestion: string;
  location?: string;
}

interface PlannedActivity extends Activity {
  subActivities?: Array<{
    name: string;
    duration: number;
    description: string;
  }>;
  nearbyAttractions?: Array<{
    name: string;
    distance: string;
    type: string;
  }>;
  geoLocation?: GeoLocation;
  itineraryHighlight?: string;
  timeAllocation?: {
    preparation: number;
    mainActivity: number;
    exploration: number;
  };
}

// Add helper function to calculate distance between coordinates
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Add function to group activities by geographical proximity
function groupByProximity(activities: PlannedActivity[], maxDistance: number = 2): Record<string, PlannedActivity[]> {
  const groups: Record<string, PlannedActivity[]> = {};
  const processed = new Set<string>();

  activities.forEach((activity, index) => {
    if (processed.has(activity.name)) return;

    const group = [activity];
    processed.add(activity.name);

    activities.slice(index + 1).forEach(other => {
      if (processed.has(other.name)) return;

      const distance = calculateDistance(
        activity.geoLocation?.latitude || 0,
        activity.geoLocation?.longitude || 0,
        other.geoLocation?.latitude || 0,
        other.geoLocation?.longitude || 0
      );
      
      if (distance <= maxDistance) {
        group.push(other);
        processed.add(other.name);
      }
    });

    const mainActivity = group[0];
    const groupKey = `${mainActivity.name}_cluster`;
    groups[groupKey] = group;

    logActivity.grouping({
      groupKey,
      mainActivity: mainActivity.name,
      groupSize: group.length,
      activities: group.map(a => ({
        name: a.name,
        distance: calculateDistance(
          mainActivity.geoLocation?.latitude || 0,
          mainActivity.geoLocation?.longitude || 0,
          a.geoLocation?.latitude || 0,
          a.geoLocation?.longitude || 0
        )
      }))
    });
  });
  
  return groups;
}

// Update the tier determination logic
function determineTier(price: number): 'budget' | 'medium' | 'premium' {
  if (price <= 50) return 'budget';
  if (price <= 150) return 'medium';
  return 'premium';
}

// Add this interface at the top with other interfaces
interface LocationDetails {
  name: string;
  address: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  type: 'meeting' | 'activity' | 'end';
}

const DEFAULT_SYSTEM_MESSAGE = `You are a travel activity planner. CRITICAL INSTRUCTIONS:
1. You MUST return ONLY a valid JSON object
2. DO NOT include any markdown, headings, or explanatory text
3. DO NOT wrap the response in code blocks
4. The response must be a raw JSON object following this EXACT structure:
{
  "activities": [
    {
      "name": "Example Activity",
      "description": "Brief description",
      "duration": 2,
      "price": { "amount": 50, "currency": "USD" },
      "category": "Cultural",
      "location": "Example Location, Address",
      "timeSlot": "morning",
      "dayNumber": 1,
      "rating": 4,
      "isVerified": false,
      "verificationStatus": "pending",
      "tier": "medium"
    }
  ],
  "dailyPlans": [
    {
      "dayNumber": 1,
      "theme": "Example Theme",
      "mainArea": "Example Area",
      "commentary": "Brief commentary",
      "highlights": ["highlight 1", "highlight 2"],
      "logistics": {
        "transportSuggestions": ["suggestion 1"],
        "walkingDistances": ["distance 1"],
        "timeEstimates": ["estimate 1"]
      }
    }
  ]
}`;

router.post('/generate', async (req: Request, res: Response) => {
  try {
    // Add detailed request logging
    console.log('[Activities API] Received request body:', {
      body: req.body,
      hasDestination: !!req.body.destination,
      hasDays: !!req.body.days,
      hasBudget: !!req.body.budget,
      hasCurrency: !!req.body.currency,
      hasPreferences: !!req.body.preferences,
      hasFlightTimes: !!req.body.flightTimes,
      specificDay: req.body.specificDay
    });

    const { 
      destination, 
      days, 
      budget, 
      currency, 
      flightTimes, 
      preferences,
      specificDay,
      existingActivities = []
    } = req.body;

    if (!destination || !days || !budget || !currency) {
      console.log('[Activities API] Missing required fields:', {
        hasDestination: !!destination,
        hasDays: !!days,
        hasBudget: !!budget,
        hasCurrency: !!currency
      });
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'destination, days, budget, and currency are required',
        timestamp: new Date().toISOString()
      });
    }

    // Log start of activity generation
    logActivity.start({
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences,
      specificDay
    });

    const perplexityService = getPerplexityClient();
    const viatorService = new ViatorService(process.env.VIATOR_API_KEY || '');

    // Log Perplexity API request
    logPerplexity.request({
      destination,
      days,
      budget,
      preferences,
      specificDay
    });

    // If regenerating a specific day, filter out existing activities for that day
    const filteredExistingActivities = specificDay 
      ? existingActivities.filter((a: any) => a.dayNumber !== specificDay)
      : [];

    const response = await perplexityService.generateActivities({
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences: validatePreferences(preferences),
      specificDay,
      existingActivities: filteredExistingActivities
    });

    // Log Perplexity API response
    logPerplexity.response(response);

    // Log generated activities
    logActivity.generated(
      response.activities?.length || 0,
      response.activities || []
    );

    // Enrich activities with Viator data
    const enrichedActivities = [];
    let completed = 0;

    for (const activity of response.activities || []) {
      try {
        logViator.search({
          name: activity.name,
          destination
        });

        // First, search for the activity
        const searchResults = await viatorService.searchActivity(activity.name);
        
        if (searchResults && searchResults.length > 0) {
          const bestMatch = searchResults[0];
          
          // Get detailed product information
          const enrichedActivity = await viatorService.enrichActivityDetails({
            ...activity,
            productCode: bestMatch.productCode,
            referenceUrl: bestMatch.referenceUrl || '',
            bookingInfo: {
              ...activity.bookingInfo,
              ...bestMatch.bookingInfo
            }
          });

          // Add additional Viator data
          const enhancedActivity = {
            ...enrichedActivity,
            viatorData: {
              productCode: bestMatch.productCode,
              bookingInfo: bestMatch.bookingInfo || {},
              reviews: bestMatch.reviews || {},
              photos: bestMatch.images || [],
              availability: bestMatch.availability || {},
              cancellationPolicy: bestMatch.cancellationPolicy || '',
              highlights: bestMatch.highlights || [],
              inclusions: bestMatch.inclusions || [],
              exclusions: bestMatch.exclusions || [],
              additionalInfo: bestMatch.additionalInfo || {},
              startingLocation: bestMatch.startingLocation || {},
              endingLocation: bestMatch.endingLocation || {}
            },
            timeAllocation: {
              preparation: 15, // minutes before activity
              mainActivity: enrichedActivity.duration || 60,
              exploration: 15 // minutes after activity
            },
            nearbyAttractions: bestMatch.nearbyAttractions || [],
            accessibility: bestMatch.accessibility || [],
            seasonality: bestMatch.seasonality || {},
            weatherDependent: bestMatch.weatherDependent || false
          };

          enrichedActivities.push(enhancedActivity);
        } else {
          // If no Viator match found, keep original activity with basic enrichment
          enrichedActivities.push({
            ...activity,
            timeAllocation: {
              preparation: 15,
              mainActivity: activity.duration || 60,
              exploration: 15
            }
          });
        }

        completed++;
        logActivity.enrichmentProgress(completed, response.activities.length, activity.name);

      } catch (error) {
        logViator.error(error);
        // Continue with original activity if enrichment fails
        enrichedActivities.push({
          ...activity,
          timeAllocation: {
            preparation: 15,
            mainActivity: activity.duration || 60,
            exploration: 15
          }
        });
        completed++;
      }
    }

    // Calculate scores and optimize activities
    const validatedPrefs = validatePreferences(preferences);
    const scoredActivities = enrichedActivities.map(activity => {
      const score = calculateActivityScore(activity, validatedPrefs);
      return {
        ...activity,
        ...score
      };
    });

    // Generate daily plans
    const dailyPlans = generateDailyPlans(scoredActivities, days, validatedPrefs);

    // Log optimization results
    logActivity.optimized(scoredActivities);

    const result = {
      activities: scoredActivities,
      dailyPlans,
      success: true,
      timestamp: new Date().toISOString()
    };

    logger.info('[Activities] Generation successful:', {
      activityCount: scoredActivities.length,
      dailyPlansCount: dailyPlans.length
    });

    return res.json(result);

  } catch (error) {
    logActivity.error(error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate activities',
      timestamp: new Date().toISOString()
    });
  }
});

function countActivitiesByDay(activities: any[]): Record<number, number> {
  return activities.reduce((acc: Record<number, number>, activity) => {
    const day = activity.dayNumber || 1;
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {});
}

function countActivitiesByTimeSlot(activities: any[]): Record<string, number> {
  return activities.reduce((acc: Record<string, number>, activity) => {
    const slot = activity.timeSlot || 'unspecified';
    acc[slot] = (acc[slot] || 0) + 1;
    return acc;
  }, {});
}

// Update ensureMinimumActivities function to be more efficient
async function ensureMinimumActivities(
  activities: GeneratedActivity[], 
  minPerSlot: number,
  totalDays: number,
  preferences?: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  }
): Promise<GeneratedActivity[]> {
  const result = [...activities];
  const timeSlots = ['morning', 'afternoon', 'evening'];
  
  // Calculate how many additional activities we need
  const neededActivities = new Map<string, number>();
  const grouped = activities.reduce((acc: any, activity) => {
    const day = activity.dayNumber;
    const slot = activity.timeSlot;
    if (!acc[day]) acc[day] = {};
    if (!acc[day][slot]) acc[day][slot] = [];
    acc[day][slot].push(activity);
    return acc;
  }, {});

  // Calculate total needed activities
  let totalNeeded = 0;
  for (let day = 1; day <= totalDays; day++) {
    for (const slot of timeSlots) {
      const currentCount = (grouped[day]?.[slot] || []).length;
      if (currentCount < minPerSlot) {
        const needed = minPerSlot - currentCount;
        const key = `${day}-${slot}`;
        neededActivities.set(key, needed);
        totalNeeded += needed;
      }
    }
  }

  if (totalNeeded === 0) {
    return result;
  }

  // Make a single call to generate all needed activities
  logger.info(`Generating ${totalNeeded} additional activities in a single call`, {
    neededBySlot: Object.fromEntries(neededActivities),
    preferences
  });

  const perplexityService = getPerplexityClient();
  const additionalActivities = await perplexityService.generateActivities({
    destination: activities[0]?.location || '',
    days: totalDays,
    budget: activities[0]?.price?.amount || 100,
    currency: activities[0]?.price?.currency || 'USD',
    preferences: preferences || {
      travelStyle: 'moderate',
      pacePreference: 'moderate',
      interests: Array.from(new Set(activities.map(a => a.category))),
      accessibility: [],
      dietaryRestrictions: []
    }
  });

  if (additionalActivities?.activities) {
    // Sort additional activities by preference score
    const scoredActivities = additionalActivities.activities.map(activity => {
      const score = preferences ? calculateActivityScore(activity, preferences) : { preferenceScore: 0, matchedPreferences: [], scoringReason: '' };
      return {
        ...activity,
        selected: false,
        preferenceScore: score.preferenceScore,
        matchedPreferences: score.matchedPreferences,
        scoringReason: score.scoringReason
      };
    }).sort((a, b) => (b.preferenceScore || 0) - (a.preferenceScore || 0));

    // Distribute activities to needed slots
    for (const [key, needed] of neededActivities) {
      const [day, slot] = key.split('-');
      const dayNum = parseInt(day);
      const availableActivities = scoredActivities
        .filter(a => !a.assigned && a.timeSlot === slot)
        .slice(0, needed);

      if (availableActivities.length > 0) {
        availableActivities.forEach(activity => {
          activity.assigned = true;
          activity.dayNumber = dayNum;
          result.push(activity);
        });

        logger.info(`Added ${availableActivities.length} activities for day ${day}, ${slot}`, {
          activities: availableActivities.map(a => ({
            name: a.name,
            preferenceScore: a.preferenceScore,
            matchedPreferences: a.matchedPreferences
          }))
        });
      }
    }
  }

  return result;
}

router.post('/enrich', async (req, res) => {
  try {
    const { activityId, productCode, name, destination } = req.body;

    logger.info('[Activities API] Enriching activity:', {
      activityId,
      productCode,
      name,
      destination
    });

    if (!productCode) {
      logger.warn('[Activities API] No product code provided');
      return res.status(400).json({ error: 'Product code is required' });
    }

    if (!destination) {
      logger.warn('[Activities API] No destination provided');
      return res.status(400).json({ error: 'Destination is required' });
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
        }, destination);
      } else {
        const basicActivity = searchResults[0];
        
        // Now enrich with product details
        enrichedActivity = await viatorClient.enrichActivityDetails({
          ...basicActivity,
          name: name || basicActivity.name,
          referenceUrl: `https://www.viator.com/tours/${productCode}`
        }, destination);
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

// Add new scheduling helper functions
function optimizeSchedule(activities: Activity[]): Activity[] {
  if (!activities || !Array.isArray(activities)) {
    return [];
  }

  // Sort activities by time slot
  const sortedActivities = [...activities].sort((a, b) => {
    const aTimeSlotValue = getTimeSlotValue(a?.timeSlot);
    const bTimeSlotValue = getTimeSlotValue(b?.timeSlot);
    return aTimeSlotValue - bTimeSlotValue;
  });

  // Group activities by day
  const dayGroups = new Map<number, Activity[]>();
  sortedActivities.forEach(activity => {
    const day = activity?.dayNumber || 1;
    if (!dayGroups.has(day)) {
      dayGroups.set(day, []);
    }
    dayGroups.get(day)?.push(activity);
  });

  // Optimize each day's schedule
  const optimizedActivities: Activity[] = [];
  dayGroups.forEach((dayActivities, day) => {
    // Sort day activities by time slot
    const sortedDayActivities = dayActivities.sort((a, b) => {
      const aTimeSlotValue = getTimeSlotValue(a?.timeSlot);
      const bTimeSlotValue = getTimeSlotValue(b?.timeSlot);
      return aTimeSlotValue - bTimeSlotValue;
    });
    optimizedActivities.push(...sortedDayActivities);
  });

  return optimizedActivities;
}

function balanceActivityDistribution(activities: PlannedActivity[], preferences: TravelPreferences): PlannedActivity[] {
  const timeSlots = ['morning', 'afternoon', 'evening'];
  const maxActivitiesPerSlot = Math.ceil(activities.length / timeSlots.length);
  
  const distribution = activities.reduce((acc: Record<string, number>, activity) => {
    acc[activity.timeSlot] = (acc[activity.timeSlot] || 0) + 1;
    return acc;
  }, {});

  // Redistribute activities if slots are unbalanced
  activities.forEach(activity => {
    const currentSlot = activity.timeSlot;
    if (distribution[currentSlot] > maxActivitiesPerSlot) {
      const targetSlot = timeSlots.find(slot => 
        (distribution[slot] || 0) < maxActivitiesPerSlot &&
        isCompatibleTimeSlot(activity, slot, preferences)
      );
      
      if (targetSlot) {
        distribution[currentSlot]--;
        distribution[targetSlot] = (distribution[targetSlot] || 0) + 1;
        activity.timeSlot = targetSlot;
      }
    }
  });

  return activities;
}

function isCompatibleTimeSlot(activity: PlannedActivity, slot: string, preferences: TravelPreferences): boolean {
  if (!activity || !activity.name) {
    return true; // Default to compatible if activity or name is missing
  }

  // Check if activity is compatible with the time slot based on type and preferences
  const eveningActivities = ['Dinner', 'Show', 'Concert', 'Nightlife'];
  const morningActivities = ['Breakfast', 'Market', 'Tour'];
  
  const name = activity.name.toLowerCase();
  const description = (activity.description || '').toLowerCase();
  
  if (slot === 'evening' && eveningActivities.some(type => 
    name.includes(type.toLowerCase()) || description.includes(type.toLowerCase())
  )) {
    return true;
  }
  
  if (slot === 'morning' && morningActivities.some(type =>
    name.includes(type.toLowerCase()) || description.includes(type.toLowerCase())
  )) {
    return true;
  }
  
  return true; // Default to compatible if no specific restrictions
}

// Helper function to generate logistics information for a set of activities
function generateLogistics(activities: PlannedActivity[]): {
  transportSuggestions: string[];
  walkingDistances: string[];
  timeEstimates: string[];
} {
  const transportSuggestions: string[] = [];
  const walkingDistances: string[] = [];
  const timeEstimates: string[] = [];

  // Sort activities by start time
  const sortedActivities = [...activities].sort((a, b) => {
    return (a.startTime || '').localeCompare(b.startTime || '');
  });

  // Calculate distances and generate suggestions between consecutive activities
  for (let i = 0; i < sortedActivities.length - 1; i++) {
    const current = sortedActivities[i];
    const next = sortedActivities[i + 1];

    if (current.geoLocation?.coordinates && next.geoLocation?.coordinates) {
      const distance = calculateDistance(
        current.geoLocation.coordinates.latitude,
        current.geoLocation.coordinates.longitude,
        next.geoLocation.coordinates.latitude,
        next.geoLocation.coordinates.longitude
      );

      // Generate transport suggestions based on distance
      if (distance < 1) {
        transportSuggestions.push(`Walk from ${current.name} to ${next.name}`);
        walkingDistances.push(`${(distance * 1000).toFixed(0)}m between ${current.name} and ${next.name}`);
      } else if (distance < 3) {
        transportSuggestions.push(`Take Metro or Bus from ${current.name} to ${next.name}`);
      } else {
        transportSuggestions.push(`Consider taxi/ride-share from ${current.name} to ${next.name}`);
      }

      // Estimate travel time
      const walkingTime = Math.ceil(distance * 20); // Assuming 20 minutes per km
      const transitTime = Math.ceil(distance * 10); // Assuming 10 minutes per km for transit
      timeEstimates.push(`${walkingTime} mins walking or ${transitTime} mins by transit between activities`);
    } else {
      transportSuggestions.push(`Check local transport options between ${current.name} and ${next.name}`);
      timeEstimates.push('Allow 30 minutes for travel between activities');
    }
  }

  return {
    transportSuggestions,
    walkingDistances,
    timeEstimates
  };
}

// Update the generateDailyPlans function
function generateDailyPlans(
  activities: PlannedActivity[],
  totalDays: number,
  preferences: TravelPreferences
): DailyPlan[] {
  logActivity.planningStart(totalDays, activities.length);
  
  const plans: DailyPlan[] = [];
  const activitiesByDay = new Map<number, PlannedActivity[]>();

  // Group activities by day
  activities.forEach(activity => {
    const day = activity.dayNumber || 1;
    if (!activitiesByDay.has(day)) {
      activitiesByDay.set(day, []);
    }
    activitiesByDay.get(day)?.push(activity);
  });

  // Generate plan for each day
  for (let day = 1; day <= totalDays; day++) {
    let dayActivities = activitiesByDay.get(day) || [];
    
    // Optimize schedule for the day
    dayActivities = optimizeSchedule(dayActivities);
    
    // Balance activity distribution
    dayActivities = balanceActivityDistribution(dayActivities, preferences);
    
    const morningActs = dayActivities.filter(a => a.timeSlot === 'morning');
    const afternoonActs = dayActivities.filter(a => a.timeSlot === 'afternoon');
    const eveningActs = dayActivities.filter(a => a.timeSlot === 'evening');

    const mainArea = determineMainArea(dayActivities);
    const theme = determineTheme(dayActivities, preferences);

    // Generate breaks based on activity schedule
    const breaks = generateBreaks(dayActivities);
    
    // Generate logistics considering activity locations
    const logistics = generateLogistics(dayActivities);

    const plan = {
      dayNumber: day,
      theme,
      mainArea,
      activities: {
        morning: morningActs,
        afternoon: afternoonActs,
        evening: eveningActs
      },
      breaks,
      logistics,
      commentary: generateDayCommentary(dayActivities, preferences),
      highlights: generateHighlights(dayActivities)
    };

    plans.push(plan);
    
    // Log the generated plan
    logActivity.dayPlanned(day, plan);
    
    // Log schedule optimization
    logActivity.scheduleOptimized(day, {
      originalCount: activitiesByDay.get(day)?.length || 0,
      optimizedCount: dayActivities.length,
      distribution: {
        morning: morningActs.length,
        afternoon: afternoonActs.length,
        evening: eveningActs.length
      }
    });
  }

  return plans;
}

// Update the generateBreaks function to be more dynamic
function generateBreaks(activities: PlannedActivity[]): { morning?: Break; lunch?: Break; afternoon?: Break; dinner?: Break } {
  const morningActivities = activities.filter(a => a.timeSlot === 'morning');
  const afternoonActivities = activities.filter(a => a.timeSlot === 'afternoon');
  const eveningActivities = activities.filter(a => a.timeSlot === 'evening');

  const breaks: { morning?: Break; lunch?: Break; afternoon?: Break; dinner?: Break } = {};

  // Add morning break if there are multiple morning activities
  if (morningActivities.length > 1) {
    const midMorning = new Date();
    midMorning.setHours(10, 30);
    
    breaks.morning = {
      startTime: '10:30',
      endTime: '11:00',
      duration: 30,
      suggestion: 'Coffee break and rest',
      location: findNearestRestLocation(morningActivities[0])
    };
  }

  // Always include lunch break
  breaks.lunch = {
    startTime: '12:30',
    endTime: '13:30',
    duration: 60,
    suggestion: 'Lunch break',
    location: findLunchLocation(activities)
  };

  // Add afternoon break if there are afternoon activities
  if (afternoonActivities.length > 0) {
    breaks.afternoon = {
      startTime: '15:30',
      endTime: '16:00',
      duration: 30,
      suggestion: 'Rest and refresh',
      location: findNearestRestLocation(afternoonActivities[0])
    };
  }

  // Add dinner break if there are evening activities
  if (eveningActivities.length > 0) {
    breaks.dinner = {
      startTime: '19:00',
      endTime: '20:30',
      duration: 90,
      suggestion: 'Dinner time',
      location: findDinnerLocation(eveningActivities[0])
    };
  }

  return breaks;
}

// Helper function to find suitable break locations
function findNearestRestLocation(activity: PlannedActivity): string {
  return activity.location?.address || 'Nearby cafe or rest area';
}

function findLunchLocation(activities: PlannedActivity[]): string {
  // Find a central location among morning and afternoon activities
  const morningAndAfternoon = activities.filter(a => 
    a.timeSlot === 'morning' || a.timeSlot === 'afternoon'
  );
  
  if (morningAndAfternoon.length > 0) {
    const centralActivity = morningAndAfternoon[Math.floor(morningAndAfternoon.length / 2)];
    return centralActivity.location?.address || 'Local restaurant';
  }
  
  return 'Local restaurant';
}

function findDinnerLocation(eveningActivity: PlannedActivity): string {
  return eveningActivity.location?.address || 'Local restaurant';
}

// Helper functions for daily plan generation
function determineMainArea(activities: any[]): string {
  const areas = activities
    .map(a => a.location?.area || a.location?.address || '')
    .filter(Boolean);
  
  return areas.length > 0
    ? mode(areas) || areas[0]
    : 'Various Locations';
}

function determineTheme(activities: any[], preferences: TravelPreferences): string {
  const categories = activities.map(a => a.category);
  const mainCategory = mode(categories);
  
  if (mainCategory && preferences.interests.includes(mainCategory)) {
    return `${mainCategory} Exploration`;
  }
  return 'Mixed Activities';
}

function generateDayCommentary(activities: any[], preferences: TravelPreferences): string {
  const matchingInterests = activities
    .filter(a => preferences.interests.some(i => 
      a.category?.toLowerCase().includes(i.toLowerCase()) ||
      a.description?.toLowerCase().includes(i.toLowerCase())
    ))
    .length;

  return matchingInterests > 0
    ? `Day focused on your interests with ${matchingInterests} matching activities`
    : 'Diverse day with various activities';
}

function generateHighlights(activities: any[]): string[] {
  return activities
    .filter(a => a.preferenceScore >= 2)
    .map(a => a.name)
    .slice(0, 3);
}

function mode(arr: any[]): string | undefined {
  return arr.sort((a,b) =>
    arr.filter(v => v === a).length - arr.filter(v => v === b).length
  ).pop();
}

export default router; 