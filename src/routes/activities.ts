import { Router, Request, Response } from 'express';
import { getPerplexityClient } from '../services/perplexity';
import { viatorClient } from '../services/viator';
import { logger } from '../utils/logger';
import { ViatorService } from '../services/viator';
import { Activity } from '../types/activities';
import { TravelPreferences } from '../types/preferences';

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

// Add getTimeSlotValue function
function getTimeSlotValue(timeSlot: string): number {
  switch (timeSlot.toLowerCase()) {
    case 'morning': return 0;
    case 'afternoon': return 1;
    case 'evening': return 2;
    default: return 3;
  }
}

// Add new interfaces at the top
interface GeoLocation {
  latitude: number;
  longitude: number;
  area: string;
  address: string;
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
  
  activities.forEach(activity => {
    if (!activity.geoLocation) return;
    
    let foundGroup = false;
    for (const [groupId, groupActivities] of Object.entries(groups)) {
      const groupCenter = groupActivities[0].geoLocation!;
      const distance = calculateDistance(
        activity.geoLocation.latitude,
        activity.geoLocation.longitude,
        groupCenter.latitude,
        groupCenter.longitude
      );
      
      if (distance <= maxDistance) {
        groups[groupId].push(activity);
        foundGroup = true;
        break;
      }
    }
    
    if (!foundGroup) {
      const groupId = `area-${Object.keys(groups).length + 1}`;
      groups[groupId] = [activity];
    }
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
    const { destination, days, budget, currency, flightTimes, preferences } = req.body;

    if (!destination || !days || !budget || !currency) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'destination, days, budget, and currency are required',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('[Activities] Generating activities:', {
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences
    });

    const perplexityService = getPerplexityClient();

    const response = await perplexityService.generateActivities({
      destination,
      days,
      budget,
      currency,
      flightTimes,
      preferences: {
        travelStyle: preferences?.travelStyle || 'moderate',
        pacePreference: preferences?.pacePreference || 'moderate',
        interests: preferences?.interests || [],
        accessibility: preferences?.accessibility || [],
        dietaryRestrictions: preferences?.dietaryRestrictions || []
      }
    });

    logger.info('[Activities] Generation successful:', {
      activityCount: response.activities?.length,
      dailyPlansCount: response.dailyPlans?.length
    });

    return res.json(response);

  } catch (error) {
    logger.error('[Activities] Generation failed:', error);
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

export default router; 