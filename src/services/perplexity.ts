import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';
import { ACTIVITY_CATEGORIES, normalizeCategory, determineCategoryFromDescription, ActivityCategory } from '../constants/categories.js';

interface PerplexityResponse {
  text?: string;
  images?: string[];
  address?: string;
  description?: string;
  highlights?: string[];
  openingHours?: string;
  rating?: number;
  reviews?: number;
  error?: string;
  commentary?: string;
  itineraryHighlight?: string;
  activities?: Activity[];
  schedule?: Array<{
    dayNumber: number;
    activities: Activity[];
    dayPlanningLogic?: string;
  }>;
  tripOverview?: string;
  activityFitNotes?: string;
}

interface PerplexityErrorResponse {
  error: string;
}

interface ViatorActivity {
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  location: string;
  address: string;
  zone: string;
  keyHighlights: string[];
  openingHours: string;
  rating: number;
  numberOfReviews: number;
  timeSlot: string;
  dayNumber: number;
  referenceUrl: string;
  images: string[];
  selected: boolean;
  bookingInfo: {
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
  };
}

export interface Activity {
  id?: string;
  name: string;
  description?: string;
  duration?: number | { min: number; max: number } | string;
  price?: number | { amount: number; currency: string };
  rating?: number;
  numberOfReviews?: number;
  category: string;
  location?: string;
  timeSlot: string;
  dayNumber: number;
  commentary?: string;
  itineraryHighlight?: string;
  keyHighlights?: string[];
  selected?: boolean;
  tier?: string;
  preferenceScore?: number;
  matchedPreferences?: string[];
  scoringReason?: string;
  date?: string;
  timeSlotVerification?: TimeSlotVerification;
  availability?: {
    isAvailable: boolean;
    operatingHours?: string;
    availableTimeSlots: string[];
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
  };
  bookingInfo?: {
    productCode?: string;
  };
}

interface GenerateActivitiesParams {
  destination: string;
  days: number;
  budget: number;
  currency: string;
  flightTimes?: {
    arrival: string;
    departure: string;
  };
  preferences: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  };
}

interface DailyItinerarySummary {
  dayNumber: number;
  summary: string;
  activities: Activity[];
}

const PRICE_TIERS = ['budget', 'medium', 'premium'] as const;

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

function determinePriceTier(price: number | { amount: number; currency: string; } | undefined): typeof PRICE_TIERS[number] {
  if (!price) return 'budget';
  const amount = typeof price === 'number' ? price : price.amount;
  if (amount <= 50) return 'budget';
  if (amount <= 150) return 'medium';
  return 'premium';
}

function getActivityPrice(price: number | { amount: number; currency: string } | undefined): number {
  if (typeof price === 'number') return price;
  if (typeof price === 'object' && price !== null) return price.amount;
  return 0;
}

function calculateDistribution(activities: Activity[]): CategoryDistribution {
  const distribution: CategoryDistribution = {};
  const totalActivities = activities.length;

  // Initialize distribution object
  ACTIVITY_CATEGORIES.forEach((category: ActivityCategory) => {
    distribution[category.name] = {
      count: 0,
      percentage: 0,
      byTier: {
        budget: 0,
        medium: 0,
        premium: 0
      }
    };
  });

  // Count activities by category and tier
  activities.forEach((activity: Activity) => {
    const category = normalizeCategory(activity.category);
    const tier = determinePriceTier(activity.price);
    
    if (distribution[category]) {
      distribution[category].count++;
      distribution[category].byTier[tier]++;
      distribution[category].percentage = (distribution[category].count / totalActivities) * 100;
    }
  });

  return distribution;
}

function balanceActivities(activities: Activity[]): Activity[] {
  const totalActivities = activities.length;
  const targetPerCategory = Math.ceil(totalActivities / ACTIVITY_CATEGORIES.length);
  const targetPerTier = Math.ceil(totalActivities / PRICE_TIERS.length);

  logger.info('[Activity Balancing] Starting activity balancing', {
    totalActivities,
    targetPerCategory,
    targetPerTier
  });

  // First, clean similar activities
  let cleanedActivities = cleanSimilarActivities(activities);

  // Calculate current distribution
  const distribution = calculateDistribution(cleanedActivities);
  
  logger.info('[Activity Balancing] Current distribution', { distribution });

  // Group activities by category and tier
  const groupedActivities = cleanedActivities.reduce((acc: Record<string, Record<typeof PRICE_TIERS[number], Activity[]>>, activity: Activity) => {
    const category = activity.category;
    const tier = determinePriceTier(activity.price);
    
    if (!acc[category]) {
      acc[category] = { budget: [], medium: [], premium: [] };
    }
    acc[category][tier].push(activity);
    return acc;
  }, {});

  // Balance activities
  const balancedActivities: Activity[] = [];
  
  // First pass: ensure minimum representation for each category
  ACTIVITY_CATEGORIES.forEach((category: ActivityCategory) => {
    const categoryActivities = groupedActivities[category.name] || { budget: [], medium: [], premium: [] };
    const totalInCategory = Object.values(categoryActivities).flat().length;
    
    if (totalInCategory > targetPerCategory) {
      // Remove excess activities, preferring to keep higher rated ones
      const allCategoryActivities = Object.values(categoryActivities).flat()
        .sort((a: Activity, b: Activity) => (b.rating || 0) - (a.rating || 0));
      
      balancedActivities.push(...allCategoryActivities.slice(0, targetPerCategory));
    } else {
      // Keep all activities in this category
      balancedActivities.push(...Object.values(categoryActivities).flat());
    }
  });

  return balancedActivities;
}

const cleanSimilarActivities = (activities: Activity[]): Activity[] => {
  logger.info('[Duplicate Cleaning] Starting process', {
    totalActivities: activities.length
  });

  const duplicateGroups = new Map<string, Activity[]>();
  
  // Normalize activity names for comparison
  const normalizeTitle = (title: string): string => {
    return title
      .toLowerCase()
      // Remove common variations
      .replace(/tickets?|tours?|guided|exclusive|semi-private|private|direct|entry/gi, '')
      // Remove special characters and extra spaces
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Group similar activities
  for (const activity of activities) {
    let foundMatch = false;
    const normalizedName = normalizeTitle(activity.name);

    // First check for exact matches after normalization
    for (const [key, group] of duplicateGroups) {
      const baseActivity = group[0];
      const normalizedBaseName = normalizeTitle(baseActivity.name);

      // Check for exact matches after normalization
      if (normalizedName === normalizedBaseName) {
        group.push(activity);
        foundMatch = true;
        logger.debug('[Duplicate Cleaning] Found exact normalized match', {
          original: baseActivity.name,
          duplicate: activity.name
        });
        break;
      }

      // If not exact match, check string similarity with higher threshold
      const similarity = calculateStringSimilarity(normalizedName, normalizedBaseName);
      
      // Use stricter similarity threshold (0.85)
      if (similarity > 0.85) {
        // Additional verification: check if duration and location match
        const durationMatch = activity.duration === baseActivity.duration;
        const locationMatch = activity.location === baseActivity.location;
        
        if (durationMatch && locationMatch) {
          group.push(activity);
          foundMatch = true;
          logger.debug('[Duplicate Cleaning] Found similar activity', {
            original: baseActivity.name,
            duplicate: activity.name,
            similarity,
            duration: activity.duration,
            location: activity.location
          });
          break;
        }
      }
    }

    if (!foundMatch) {
      const activityId = activity.id || `activity-${Math.random().toString(36).substr(2, 9)}`;
      duplicateGroups.set(activityId, [activity]);
    }
  }

  // Select best activity from each group
  const cleanedActivities: Activity[] = [];
  for (const [groupId, group] of duplicateGroups) {
    if (group.length > 1) {
      logger.info('[Duplicate Cleaning] Processing group', {
        groupId,
        count: group.length,
        activities: group.map(a => ({
          name: a.name,
          rating: a.rating,
          reviews: a.numberOfReviews,
          price: a.price
        }))
      });

      // Enhanced selection criteria
      const bestActivity = group.reduce((best, current) => {
        // If one has a rating and the other doesn't, prefer the rated one
        if ((best.rating || 0) === 0 && (current.rating || 0) > 0) return current;
        if ((current.rating || 0) === 0 && (best.rating || 0) > 0) return best;

        // If both have ratings, use the shouldPreferActivity function
        return shouldPreferActivity(current, best) ? current : best;
      });

      logger.info('[Duplicate Cleaning] Selected best activity', {
        groupId,
        selected: {
          name: bestActivity.name,
          rating: bestActivity.rating,
          reviews: bestActivity.numberOfReviews,
          price: bestActivity.price
        }
      });
      
      cleanedActivities.push(bestActivity);
    } else {
      cleanedActivities.push(group[0]);
    }
  }

  logger.info('[Duplicate Cleaning] Completed', {
    originalCount: activities.length,
    cleanedCount: cleanedActivities.length,
    duplicatesRemoved: activities.length - cleanedActivities.length
  });

  return cleanedActivities;
};

function getTimeSlotValue(timeSlot: string): number {
  switch (timeSlot.toLowerCase()) {
    case 'morning': return 0;
    case 'afternoon': return 1;
    case 'evening': return 2;
    default: return -1;
  }
}

function shouldPreferActivity(activity1: Activity, activity2: Activity): boolean {
  // Always prefer activities with higher ratings
  if ((activity1.rating || 0) !== (activity2.rating || 0)) {
    return (activity1.rating || 0) > (activity2.rating || 0);
  }

  // If ratings are equal, prefer activities with more reviews
  if ((activity1.numberOfReviews || 0) !== (activity2.numberOfReviews || 0)) {
    return (activity1.numberOfReviews || 0) > (activity2.numberOfReviews || 0);
  }

  // If both rating and reviews are equal, prefer the cheaper option
  return getActivityPrice(activity1.price) < getActivityPrice(activity2.price);
}

function countCategories(activities: Activity[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    acc[activity.category] = (acc[activity.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

export interface TimeSlotVerification {
  isAvailable: boolean;
  recommendedTimeSlot: string;
  availableTimeSlots: string[];
  operatingHours?: string;
  bestTimeToVisit?: string;
}

interface DayHighlight {
    dayNumber: number;
  highlight: string;
  theme: string;
  mainAttractions: string[];
}

export interface PerplexityApiResponse {
  schedule?: Array<{
    dayNumber: number;
    activities: Activity[];
    dayPlanningLogic?: string;
  }>;
  activities?: Activity[];
  tripOverview?: string;
  activityFitNotes?: string;
}

export class PerplexityService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || '';
    this.baseUrl = 'https://api.perplexity.ai/chat/completions';
    
    if (!this.apiKey) {
      throw new Error('PERPLEXITY_API_KEY environment variable is required');
    }
  }

  private buildActivityQuery(params: GenerateActivitiesParams): string {
    const { destination, days, budget, currency, preferences } = params;

    // Map user interests to activity categories with weights
    const categoryMapping = {
      'History': 'Cultural & Historical',
      'Culture': 'Cultural & Historical',
      'Nature': 'Nature & Adventure',
      'Adventure': 'Nature & Adventure',
      'Food': 'Food & Entertainment',
      'Entertainment': 'Food & Entertainment',
      'Shopping': 'Lifestyle & Local',
      'Local': 'Lifestyle & Local',
      'Art': 'Cultural & Historical',
      'Sports': 'Nature & Adventure',
      'Nightlife': 'Food & Entertainment',
      'Relaxation': 'Lifestyle & Local'
    } as const;

    // Calculate category weights based on user interests
    const categoryWeights = preferences.interests.reduce((acc, interest) => {
      const category = categoryMapping[interest as keyof typeof categoryMapping];
      if (category) {
        acc[category] = (acc[category] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return `Plan diverse activities in ${destination} for ${days} days with a budget of ${budget} ${currency}.

USER PREFERENCES:
Travel Style: ${preferences.travelStyle}
Pace: ${preferences.pacePreference}
Interests: ${preferences.interests.join(', ')}
${preferences.accessibility.length ? `Accessibility Needs: ${preferences.accessibility.join(', ')}\n` : ''}${preferences.dietaryRestrictions.length ? `Dietary Restrictions: ${preferences.dietaryRestrictions.join(', ')}` : ''}

CATEGORY PRIORITIES:
${Object.entries(categoryWeights)
  .sort(([, a], [, b]) => b - a)
  .map(([category, weight]) => `- ${category}: ${weight} (based on user interests)`)
  .join('\n')}

TIME SLOTS:
- Morning (9:00-13:00): Provide 2-3 cultural & historical options
- Afternoon (14:00-18:00): Provide 2-3 nature & adventure options
- Evening (19:00-23:00): Provide 2-3 food & entertainment options

CRITICAL REQUIREMENTS:
1. For EACH time slot, provide MULTIPLE activity options (2-3 per slot)
2. Ensure activities in the same time slot are different but complementary
3. Include variety in difficulty levels and prices within each time slot
4. Consider travel time between potential activities
5. Account for opening hours and seasonal factors
6. Suggest alternatives for popular attractions

BALANCE REQUIREMENTS:
- CRITICAL: Suggest DIFFERENT types of activities - avoid similar or duplicate experiences
- Mix activities across different categories each day
- Include at least one activity from each selected interest
- Prioritize activities matching user's travel style
- Account for accessibility needs in activity selection
- Consider dietary restrictions for food-related activities

CRITICAL RULES:
1. ONLY suggest activities that exist on Viator.com
2. Use EXACT names from Viator listings
3. Ensure activities flow logically within each day
4. Account for travel time between locations
5. Don't schedule overlapping activities
6. Consider accessibility requirements
7. Match dietary restrictions
8. Align with travel style preference
9. Set selected to false for all activities
10. Include preference-matching commentary

OUTPUT FORMAT:
Return ONLY a valid JSON array of activities, each with:
{
  "name": "EXACT Viator activity name",
  "description": "Brief activity description",
  "duration": "in hours",
  "price": "in ${currency}",
  "category": "one of the main categories",
  "location": "specific area/neighborhood",
  "timeSlot": "morning/afternoon/evening",
  "dayNumber": 1-${days},
  "expectedDuration": "in minutes",
  "commentary": "2-3 sentences explaining why this matches user preferences",
  "itineraryHighlight": "1-2 sentences on how this fits with other activities",
  "selected": false,
  "matchedPreferences": ["list of matched user preferences"]
}

Return ONLY a valid JSON array of activities.`;
  }

  private async makePerplexityRequests(query: string): Promise<Activity[]> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'sonar',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful travel planning assistant.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          temperature: 0.3,
          max_tokens: 8000,
          web_search: true
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        logger.error('[Activity Generation] No content in Perplexity response');
        return [];
      }

      logger.debug('[Activity Generation] Raw content received:', { contentLength: content.length });

      try {
        // First try to parse the content directly
        let parsedContent: any;
        try {
          parsedContent = JSON.parse(content);
        } catch (e) {
          // If direct parsing fails, try to extract JSON from markdown or text
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (!jsonMatch) {
            logger.error('[Activity Generation] No JSON content found in response');
            return [];
          }

          const jsonContent = jsonMatch[1] || jsonMatch[0];
          // Clean the JSON string before parsing
          const cleanedJson = jsonContent
            .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
            .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
            .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
            .replace(/\n/g, ' ') // Remove newlines
            .replace(/\s+/g, ' ') // Normalize spaces
            .trim();

          logger.debug('[Activity Generation] Attempting to parse cleaned JSON:', { cleanedJson });
          parsedContent = JSON.parse(cleanedJson);
        }

        // Initialize activities array
        let activities: Activity[] = [];

        // Handle different response formats
        if (Array.isArray(parsedContent)) {
          activities = parsedContent;
        } else if (parsedContent.activities && Array.isArray(parsedContent.activities)) {
          activities = parsedContent.activities;
        } else if (parsedContent.schedule && Array.isArray(parsedContent.schedule)) {
          activities = parsedContent.schedule.reduce((acc: Activity[], day: any) => {
            if (day.activities && Array.isArray(day.activities)) {
              acc.push(...day.activities);
            }
            return acc;
          }, []);
        }

        if (!activities || activities.length === 0) {
          logger.error('[Activity Generation] No valid activities found in response');
          return [];
        }
        
        // Add duration validation and normalization
        const normalizedActivities = activities.map((activity: Activity) => {
          // Normalize duration to minutes
          let duration = 0;
          if (activity.duration) {
            if (typeof activity.duration === 'number') {
              duration = activity.duration;
            } else if (typeof activity.duration === 'object') {
              const durationObj = activity.duration as { min?: number; max?: number; fixedDurationInMinutes?: number };
              if (durationObj.fixedDurationInMinutes) {
                duration = durationObj.fixedDurationInMinutes;
              } else if (durationObj.min && durationObj.max) {
                duration = Math.floor((durationObj.min + durationObj.max) / 2);
              }
            } else if (typeof activity.duration === 'string') {
              const durationStr = activity.duration as string;
              const hourMatch = durationStr.match(/(\d+)\s*(?:hours?|hrs?)/i);
              const minuteMatch = durationStr.match(/(\d+)\s*(?:minutes?|mins?)/i);
              
              if (hourMatch) {
                duration += parseInt(hourMatch[1]) * 60;
              }
              if (minuteMatch) {
                duration += parseInt(minuteMatch[1]);
              }
            }
          }

          // Normalize price
          const price = typeof activity.price === 'number' 
            ? { amount: activity.price, currency: 'USD' }
            : activity.price || { amount: 0, currency: 'USD' };

          return {
            ...activity,
            id: activity.id || `${activity.name}-${activity.timeSlot}-${Date.now()}`.toLowerCase().replace(/\s+/g, '-'),
            duration: duration || 120, // Default to 2 hours if no duration specified
            price,
            selected: false,
            category: activity.category || 'Cultural & Historical'
          };
        });
        
        logger.info('[Activity Generation] Successfully processed activities', {
          totalActivities: normalizedActivities.length,
          firstActivity: normalizedActivities[0]?.name
        });

        return normalizedActivities;
      } catch (error) {
        logger.error('[Activity Generation] Failed to parse Perplexity response', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          content 
        });
        return [];
      }
    } catch (error) {
      logger.error('[Activity Generation] Error calling Perplexity API', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  async generateActivities(params: GenerateActivitiesParams): Promise<any> {
    try {
      logger.info('Received activity generation request', params);

      // 1. Initial activity generation
      const query = this.buildActivityQuery(params);
      logger.debug('Sending query to Perplexity API', { query });
      const activities = await this.makePerplexityRequests(query);
      
      if (!activities || activities.length === 0) {
        logger.error('No activities generated from initial request');
        return {
          success: false,
          error: 'Failed to generate activities',
          activities: [],
          metadata: {
            originalCount: 0,
            finalCount: 0,
            enrichedCount: 0,
            daysPlanned: params.days,
            destination: params.destination
          }
        };
      }
      
      // 2. Clean and balance activities
      const balancedActivities = await this.cleanAndBalanceActivities(activities, params);
      
      if (!balancedActivities || balancedActivities.length === 0) {
        logger.error('No activities after balancing');
        return {
          success: false,
          error: 'Failed to balance activities',
          activities: [],
          metadata: {
            originalCount: activities.length,
            finalCount: 0,
            enrichedCount: 0,
            daysPlanned: params.days,
            destination: params.destination
          }
        };
      }
      
      // Log category distribution before enrichment
      const distribution = countCategories(balancedActivities);
      logger.info('Category distribution after balancing:', distribution);
      
      // 3. Enrich activities with detailed information
      const enrichedActivities: Activity[] = [];
      for (const activity of balancedActivities) {
        const date = this.getDateForActivity(activity.dayNumber, params);
        const enrichedActivity = await this.enrichActivity(activity, params, date);
        
        if (enrichedActivity) {
          enrichedActivities.push(enrichedActivity);
          logger.info('Successfully enriched activity', {
              name: activity.name,
            date: enrichedActivity.date,
            timeSlot: enrichedActivity.timeSlot,
            isAvailable: enrichedActivity.availability?.isAvailable ?? false,
            hasCommentary: !!enrichedActivity.commentary,
            hasHighlights: !!enrichedActivity.keyHighlights?.length,
            matchedPreferences: enrichedActivity.matchedPreferences
          });
        }
      }

      if (!enrichedActivities || enrichedActivities.length === 0) {
        logger.error('No activities after enrichment');
        return {
          success: false,
          error: 'Failed to enrich activities',
          activities: [],
          metadata: {
            originalCount: activities.length,
            finalCount: balancedActivities.length,
            enrichedCount: 0,
            daysPlanned: params.days,
            destination: params.destination
          }
        };
      }

      // 4. Generate daily summaries
      const dailySummaries = await this.generateDailyHighlights(enrichedActivities);
      if (!dailySummaries) {
        logger.warn('Failed to generate daily summaries');
      }

      // 5. Generate day highlights
      const dayHighlights = this.generateDayHighlights(enrichedActivities);
      if (!dayHighlights) {
        logger.warn('Failed to generate day highlights');
      }

      const response = {
        success: true,
        activities: enrichedActivities,
        dailySummaries: dailySummaries || [],
        dayHighlights: dayHighlights || [],
        distribution,
        metadata: {
          originalCount: activities.length,
          finalCount: enrichedActivities.length,
          enrichedCount: enrichedActivities.filter(a => a.commentary && a.itineraryHighlight).length,
          daysPlanned: params.days,
          destination: params.destination,
          availabilityChanges: enrichedActivities.filter(a => a.availability?.nextAvailableDate).length
        }
      };

      logger.info('Successfully generated activities response', {
        activitiesCount: enrichedActivities.length,
        hasSummaries: !!dailySummaries,
        hasHighlights: !!dayHighlights,
        metadata: response.metadata
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error('Failed to generate activities', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return {
        success: false,
        error: errorMessage,
        activities: [],
        metadata: {
          originalCount: 0,
          finalCount: 0,
          enrichedCount: 0,
          daysPlanned: params.days,
          destination: params.destination
        }
      };
    }
  }

  // For initial activity planning - uses sonar model
  async chat(query: string, options?: { web_search?: boolean; temperature?: number; max_tokens?: number }): Promise<PerplexityApiResponse> {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

        const response = await axios.post(
          this.baseUrl,
          {
            model: 'sonar',
            messages: [
              {
                role: 'system',
              content: 'You are a helpful travel planning assistant. For each time slot (morning, afternoon, evening), provide multiple activity options to allow for selection and optimization. Return ONLY valid JSON.'
              },
              {
                role: 'user',
                content: query
              }
            ],
          temperature: options?.temperature ?? 0.4, // Slightly increased for more variety
            max_tokens: options?.max_tokens ?? 8000,
            web_search: true
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

      const rawContent = response.data.choices[0]?.message?.content;
      if (!rawContent) {
        logger.error('[Perplexity] No content in response');
        return { activities: [] };
      }

      logger.debug('[Perplexity] Raw response:', { rawContent });

      // Clean and parse the content
      let cleanedContent = this.cleanJsonString(rawContent);
      let parsedContent: any;

      try {
        parsedContent = JSON.parse(cleanedContent);
          } catch (e) {
        // If direct parsing fails, try to extract JSON object
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
          logger.error('[Perplexity] No JSON content found in response');
          return { activities: [] };
        }

        try {
          parsedContent = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
          logger.error('[Perplexity] Failed to parse content:', { error: parseError, rawContent });
          return { activities: [] };
        }
      }

      // Extract activities from schedule
      let activities: Activity[] = [];
      if (parsedContent.schedule && Array.isArray(parsedContent.schedule)) {
        // First, extract preselected activities from the query
        const preselectedMatch = query.match(/preselectedActivities":\s*(\[[\s\S]*?\])/);
        const preselectedActivities: Activity[] = [];
        if (preselectedMatch) {
          try {
            const preselectedJson = JSON.parse(preselectedMatch[1]);
            preselectedActivities.push(...preselectedJson);
            logger.info('[Perplexity] Found preselected activities:', {
              count: preselectedActivities.length,
              activities: preselectedActivities.map(a => ({
                name: a.name,
                dayNumber: a.dayNumber,
                timeSlot: a.timeSlot
              }))
            });
          } catch (e) {
            logger.error('[Perplexity] Failed to parse preselected activities:', e);
          }
        }

        // Process each day's activities
        activities = parsedContent.schedule.flatMap(day => {
          const dayNumber = day.dayNumber;
          const dayActivities = day.activities || [];

          // First, add preselected activities for this day
          const dayPreselected = preselectedActivities.filter(a => a.dayNumber === dayNumber);
          const preselectedTimeSlots = new Set(dayPreselected.map(a => a.timeSlot));

          // Then add other activities from the schedule, skipping time slots that are already taken
          const otherActivities = dayActivities
            .filter(activity => !preselectedTimeSlots.has(activity.timeSlot))
            .map(activity => ({
              name: activity.name,
              category: activity.category || determineCategoryFromDescription(activity.description || ''),
              rating: activity.rating || 0,
              numberOfReviews: activity.numberOfReviews || 0,
              price: activity.price || { amount: 0, currency: 'USD' },
              location: activity.location || '',
              timeSlot: activity.timeSlot || this.getTimeSlot(activity.startTime || ''),
              dayNumber,
              selected: false,
              duration: activity.duration || this.estimateDuration(activity.startTime || ''),
              commentary: activity.commentary || '',
              itineraryHighlight: activity.itineraryHighlight || '',
              scoringReason: activity.scoringReason || '',
              startTime: activity.startTime || '',
              description: activity.description || '',
              matchedPreferences: activity.matchedPreferences || [],
              preferenceScore: activity.preferenceScore || 0
            }));

          // Combine preselected and other activities
          return [
            ...dayPreselected.map(activity => ({
            ...activity,
              category: activity.category || 'Cultural & Historical',
              rating: activity.rating || 4.5,
              numberOfReviews: activity.numberOfReviews || 1000,
              price: activity.price || { amount: 0, currency: 'USD' },
              selected: true,
              commentary: activity.commentary || `Preselected activity for ${activity.timeSlot}`,
              itineraryHighlight: activity.itineraryHighlight || `Part of the original plan`,
              scoringReason: activity.scoringReason || 'Preselected by user'
            })),
            ...otherActivities
          ];
        });
      }

      logger.info('[Perplexity] Successfully parsed response', {
        activitiesCount: activities.length,
        hasSchedule: !!parsedContent.schedule,
        hasTripOverview: !!parsedContent.tripOverview,
        firstActivity: activities[0]?.name,
        preselectedCount: activities.filter(a => a.selected).length
      });

      return {
        schedule: parsedContent.schedule,
        activities,
        tripOverview: parsedContent.tripOverview,
        activityFitNotes: parsedContent.activityFitNotes
      };
    } catch (error) {
      logger.error('[Perplexity] Error calling API:', error);
      return { activities: [] };
    }
  }

  private cleanJsonString(str: string): string {
    // First remove markdown code blocks
    let cleaned = str.replace(/```(?:json)?\s*|\s*```/g, '');
    
    // Extract just the JSON object if there's surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    // Clean up the JSON string
    return cleaned
      .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
      .replace(/\n/g, ' ') // Remove newlines
      .replace(/\s+/g, ' ') // Normalize spaces
      .replace(/(\d+)\+/g, '$1') // Remove + from numbers
      .replace(/'/g, "'") // Fix curly quotes
      .replace(/"/g, '"') // Fix curly quotes
      .replace(/\\/g, '\\\\') // Escape backslashes
      .replace(/(?<=\{|\[|,)\s*"([^"]+)":\s*"([^"]+)"/g, (_, key, value) => {
        // Clean up key-value pairs
        const cleanValue = value
          .replace(/\$/g, '') // Remove dollar signs
          .replace(/\s*per person\s*/gi, '') // Remove "per person"
          .replace(/\s*\(External\)\s*/gi, '') // Remove "(External)"
          .replace(/Free/gi, '0') // Convert "Free" to 0
          .trim();
        return `"${key}":"${cleanValue}"`;
      })
      .trim();
  }

  private getTimeSlot(time: string): string {
    if (!time) return 'morning';
    const hour = parseInt(time.split(':')[0]);
    if (hour < 13) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  private estimateDuration(time: string): number {
    if (!time) return 120; // default 2 hours
    const [start, end] = time.split('-').map(t => {
      const [hours, minutes] = t.split(':').map(Number);
      return hours * 60 + minutes;
    });
    return end - start;
  }

  private normalizeActivity(activity: any, dayNumber: number, timeSlot: string): Activity {
      return {
      name: activity.activity || activity.name,
      category: activity.category,
      rating: parseFloat(activity.rating) || 0,
      numberOfReviews: typeof activity.reviews === 'string' ? 
        parseInt(activity.reviews.replace(/\D/g, '')) : 
        activity.reviews || 0,
      price: {
        amount: typeof activity.budget === 'string' ? 
          parseFloat(activity.budget.replace(/[^\d.]/g, '')) || 0 : 
          activity.budget || 0,
        currency: 'USD'
      },
      location: activity.location || '',
      timeSlot,
      dayNumber,
      selected: false,
      duration: this.estimateDuration(activity.time),
      commentary: activity.commentary || '',
      itineraryHighlight: activity.itineraryHighlight || '',
      scoringReason: activity.scoringReason || ''
    };
  }

  private parseReviewCount(reviews: string | number): number {
    if (typeof reviews === 'number') return reviews;
    if (!reviews) return 0;

    const match = reviews.toString().match(/(\d+)(?:\+|,000\+)?/);
    if (!match) return 0;

    const number = parseInt(match[1]);
    if (reviews.includes('000+') || reviews.includes('k+')) {
      return number * 1000;
    }
    return number;
  }

  private parseCost(cost: string | number): { amount: number; currency: string } {
    if (typeof cost === 'number') {
      return { amount: cost, currency: 'USD' };
    }

    if (!cost || cost.toLowerCase() === 'free') {
      return { amount: 0, currency: 'USD' };
    }

    const match = cost.toString().match(/\$?(\d+)(?:-\$?(\d+))?/);
    if (match) {
      const min = parseInt(match[1]);
      const max = match[2] ? parseInt(match[2]) : min;
      return { amount: Math.floor((min + max) / 2), currency: 'USD' };
    }

    return { amount: 0, currency: 'USD' };
  }

  // For individual activity details - uses sonar model
  async getEnrichedDetails(query: string, userPreferences?: { 
    interests: string[];
    travelStyle: string;
    pacePreference: string;
    accessibility: string[];
    dietaryRestrictions: string[];
  }, date?: string): Promise<PerplexityResponse> {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

      logger.info('[Enrichment] Starting activity enrichment', { 
        queryLength: query.length,
        userPreferences: userPreferences ? {
          interestsCount: userPreferences.interests.length,
          hasAccessibility: userPreferences.accessibility.length > 0,
          hasDietary: userPreferences.dietaryRestrictions.length > 0
        } : 'none'
      });

      const systemPrompt = `You are a travel activity expert specializing in Viator bookings.
Your task is to analyze activities and provide detailed, preference-matched commentary and highlights.

REQUIREMENTS:
1. ALWAYS provide detailed commentary (3-4 sentences) that explicitly references user interests and preferences
2. ALWAYS provide itinerary highlights (2-3 sentences) that explain how the activity fits into the day
3. Verify activity availability and recommend optimal time slots
4. Consider user's pace preference and travel style
5. Account for accessibility needs and dietary restrictions if specified

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "activities": [{
    "commentary": "Detailed commentary referencing user preferences",
    "itineraryHighlight": "How this fits into the day's schedule",
    "timeSlotVerification": {
      "isAvailable": boolean,
      "recommendedTimeSlot": "morning|afternoon|evening",
      "availableTimeSlots": ["array of available slots"],
      "operatingHours": "specific hours",
      "bestTimeToVisit": "explanation"
    }
  }]
}`;

      const response = await axios.post(this.baseUrl, {
        model: 'sonar',
          messages: [
            {
              role: 'system',
            content: systemPrompt
            },
            {
              role: 'user',
            content: `User Preferences:
${userPreferences ? `
- Interests: ${userPreferences.interests.join(', ')}
- Travel Style: ${userPreferences.travelStyle}
- Pace Preference: ${userPreferences.pacePreference}
${userPreferences.accessibility.length > 0 ? `- Accessibility Needs: ${userPreferences.accessibility.join(', ')}` : ''}
${userPreferences.dietaryRestrictions.length > 0 ? `- Dietary Restrictions: ${userPreferences.dietaryRestrictions.join(', ')}` : ''}` : ''}
${date ? `\nRequested Date: ${date}` : ''}

Activity to analyze:
${query}

IMPORTANT: You MUST provide detailed commentary and highlights that explicitly reference the user's preferences and interests.`
            }
          ],
          temperature: 0.3,
          max_tokens: 8000,
          web_search: true
        }, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
      });

      const content = response.data.choices[0].message.content;
    logger.debug('[Enrichment] Raw content received:', { contentLength: content.length });

    try {
      // First try to parse the content directly
      let enrichedData;
      try {
        enrichedData = JSON.parse(content);
      } catch (e) {
        // If direct parsing fails, try to extract JSON from markdown or text
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error('[Enrichment] No JSON content found in response');
          throw new Error('No JSON content found in response');
        }

        const jsonContent = jsonMatch[1] || jsonMatch[0];
        // Clean the JSON string before parsing
        const cleanedJson = jsonContent
          .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
          .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
          .trim();

        logger.debug('[Enrichment] Attempting to parse cleaned JSON:', { cleanedJson });
        enrichedData = JSON.parse(cleanedJson);
      }
      
        // Validate the enriched data has required fields
        if (!enrichedData.activities?.[0]?.commentary || !enrichedData.activities?.[0]?.itineraryHighlight) {
          logger.error('[Enrichment] Missing required fields in enriched data', {
            hasCommentary: !!enrichedData.activities?.[0]?.commentary,
            hasHighlight: !!enrichedData.activities?.[0]?.itineraryHighlight
          });
          
          // Add default values if missing
          if (!enrichedData.activities?.[0]?.commentary) {
            enrichedData.activities[0].commentary = `This activity aligns with your interests in ${userPreferences?.interests.join(' and ')}. It offers a ${userPreferences?.pacePreference} pace experience that matches your ${userPreferences?.travelStyle} travel style.`;
          }
          
          if (!enrichedData.activities?.[0]?.itineraryHighlight) {
            enrichedData.activities[0].itineraryHighlight = `This activity is well-scheduled for your ${userPreferences?.pacePreference} pace preference and complements other activities in your itinerary.`;
          }
        }
        
        logger.info('[Enrichment] Successfully enriched activity data', {
          hasCommentary: !!enrichedData.activities?.[0]?.commentary,
          commentaryLength: enrichedData.activities?.[0]?.commentary?.length || 0,
          hasHighlight: !!enrichedData.activities?.[0]?.itineraryHighlight,
          highlightLength: enrichedData.activities?.[0]?.itineraryHighlight?.length || 0
        });

        return enrichedData;
      } catch (e) {
        logger.error('[Enrichment] Failed to parse enriched data', {
          error: e instanceof Error ? e.message : 'Unknown error',
          contentLength: content.length
        });
        
        // Extract activity name from the query
        const nameMatch = query.match(/Name: ([^\n]+)/);
        const activityName = nameMatch ? nameMatch[1].trim() : 'Activity';
        
        return {
          activities: [{
            name: activityName,
            category: 'Cultural & Historical',
            timeSlot: 'morning',
            dayNumber: 1,
            commentary: `This activity aligns with your interests in ${userPreferences?.interests.join(' and ')}. It offers a ${userPreferences?.pacePreference} pace experience that matches your ${userPreferences?.travelStyle} travel style.`,
            itineraryHighlight: `This activity is well-scheduled for your ${userPreferences?.pacePreference} pace preference and complements other activities in your itinerary.`,
            timeSlotVerification: {
              isAvailable: true,
              recommendedTimeSlot: "morning",
              availableTimeSlots: ["morning", "afternoon", "evening"],
              operatingHours: "9:00 AM - 5:00 PM",
              bestTimeToVisit: "Morning is recommended for the best experience"
            }
          }]
        };
      }
    } catch (error) {
      logger.error('[Enrichment] Error during enrichment', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async cleanAndBalanceActivities(activities: Activity[], params: GenerateActivitiesParams): Promise<Activity[]> {
    const { preferences } = params;
    logger.info('Starting activity balancing', {
      initialCount: activities.length,
      preferences: {
        interests: preferences.interests,
        travelStyle: preferences.travelStyle,
        pacePreference: preferences.pacePreference
      }
    });

    // Group activities by day
    const activitiesByDay = activities.reduce((acc, activity) => {
      acc[activity.dayNumber] = acc[activity.dayNumber] || [];
      acc[activity.dayNumber].push(activity);
      return acc;
    }, {} as Record<number, Activity[]>);

    // Calculate minimum activities per day based on pace preference
    const minActivitiesPerDay = {
      'relaxed': 2,
      'moderate': 3,
      'intensive': 4
    }[preferences.pacePreference] || 2; // Ensure at least 2 activities per day

    const balancedActivities = Object.entries(activitiesByDay).flatMap(([day, dayActivities]) => {
      logger.info(`Processing day ${day}`, {
        dayNumber: day,
        activitiesCount: dayActivities.length
      });

      // Score activities based on preferences with less aggressive scoring
      const scoredActivities = dayActivities.map(activity => {
        let score = 0;
        
        // Base score for all activities
        score += 1;
        
        // Score based on matching interests (reduced weight)
        preferences.interests.forEach(interest => {
          if (activity.commentary?.toLowerCase().includes(interest.toLowerCase()) ||
              activity.description?.toLowerCase().includes(interest.toLowerCase())) {
            score += 0.5;
          }
        });

        // Score based on travel style match (reduced weight)
        if (activity.tier?.toLowerCase() === preferences.travelStyle.toLowerCase()) {
          score += 0.5;
        }

        // Score based on rating (maintain importance)
        if (activity.rating && activity.rating >= 4.0) {
          score += 1;
        }

        return { ...activity, preferenceScore: score };
      });

      // Get unique categories for this day
      const categories = new Set(scoredActivities.map(a => a.category));
      const selectedActivities: Activity[] = [];
      
      // First, ensure at least one activity from different categories
      categories.forEach(category => {
        const categoryActivities = scoredActivities
          .filter(a => a.category === category)
          .sort((a, b) => {
            const scoreCompare = (b.preferenceScore || 0) - (a.preferenceScore || 0);
            if (scoreCompare !== 0) return scoreCompare;
            return (b.rating || 0) - (a.rating || 0);
          });
        
        if (categoryActivities.length > 0) {
          selectedActivities.push(categoryActivities[0]);
        }
      });

      // If we don't have minimum activities yet, add more based on score
      while (selectedActivities.length < minActivitiesPerDay && scoredActivities.length > selectedActivities.length) {
        const remainingActivities = scoredActivities
          .filter(a => !selectedActivities.includes(a))
          .sort((a, b) => {
            const scoreCompare = (b.preferenceScore || 0) - (a.preferenceScore || 0);
            if (scoreCompare !== 0) return scoreCompare;
            return (b.rating || 0) - (a.rating || 0);
          });

        if (remainingActivities.length > 0) {
          selectedActivities.push(remainingActivities[0]);
        } else {
          break;
        }
      }

      // Try to distribute activities across time slots if possible
      const timeSlots = ['morning', 'afternoon', 'evening'] as const;
      const activitiesByTimeSlot = new Map<typeof timeSlots[number], Activity[]>();
      
      selectedActivities.forEach(activity => {
        const slot = activity.timeSlot as typeof timeSlots[number];
        if (!activitiesByTimeSlot.has(slot)) {
          activitiesByTimeSlot.set(slot, []);
        }
        activitiesByTimeSlot.get(slot)?.push(activity);
      });

      // Rebalance time slots if needed
      if (selectedActivities.length >= minActivitiesPerDay) {
        const emptySlots = timeSlots.filter(slot => !activitiesByTimeSlot.has(slot));
        if (emptySlots.length > 0) {
          const overloadedSlots = Array.from(activitiesByTimeSlot.entries())
            .filter(([_, acts]) => acts.length > 1)
            .sort(([_, a], [__, b]) => b.length - a.length);

          for (const emptySlot of emptySlots) {
            if (overloadedSlots.length > 0) {
              const [overloadedSlot, activities] = overloadedSlots[0];
              const activityToMove = activities[activities.length - 1];
              activityToMove.timeSlot = emptySlot;
            }
          }
        }
      }

      return selectedActivities;
    });

    logger.info('Completed activity balancing', {
      originalCount: activities.length,
      finalCount: balancedActivities.length,
      daysProcessed: Object.keys(activitiesByDay).length,
      averagePerDay: balancedActivities.length / Object.keys(activitiesByDay).length
    });

    return balancedActivities;
  }

  private getMatchedPreferences(activity: any, preferences: GenerateActivitiesParams['preferences']): string[] {
    const matchedPrefs: string[] = [];
    
    // Check interests
    preferences.interests.forEach(interest => {
      if (
        activity.commentary?.toLowerCase().includes(interest.toLowerCase()) ||
        activity.description?.toLowerCase().includes(interest.toLowerCase())
      ) {
        matchedPrefs.push(interest);
      }
    });

    // Check travel style
    if (activity.tier?.toLowerCase() === preferences.travelStyle.toLowerCase()) {
      matchedPrefs.push(`${preferences.travelStyle} travel style`);
    }

    // Check accessibility
    preferences.accessibility.forEach(need => {
      if (activity.description?.toLowerCase().includes(need.toLowerCase())) {
        matchedPrefs.push(need);
      }
    });

    // Check dietary restrictions
    preferences.dietaryRestrictions.forEach(restriction => {
      if (activity.description?.toLowerCase().includes(restriction.toLowerCase())) {
        matchedPrefs.push(restriction);
      }
    });

    return matchedPrefs;
  }

  private ensurePreferenceReferences(
    text: string | undefined,
    preferences: GenerateActivitiesParams['preferences'],
    isItineraryHighlight: boolean = false
  ): string {
    if (!text) return '';

    // If the text already mentions preferences, return it
    const hasPreferences = preferences.interests.some(interest => 
      text.toLowerCase().includes(interest.toLowerCase())
    );

    if (hasPreferences) return text;

    // Add preference context if missing
    const relevantPreferences = this.getRelevantPreferences(preferences);
    
    if (isItineraryHighlight) {
      return `${text} This timing aligns well with your ${preferences.pacePreference} pace preference${relevantPreferences ? ` and accommodates ${relevantPreferences}` : ''}.`;
    } else {
      return `${text} This activity particularly suits your interests in ${relevantPreferences || 'the selected preferences'}.`;
    }
  }

  private getRelevantPreferences(preferences: GenerateActivitiesParams['preferences']): string {
    const parts: string[] = [];
    
    if (preferences.interests.length > 0) {
      parts.push(preferences.interests.slice(0, 2).join(' and '));
    }
    
    if (preferences.accessibility.length > 0) {
      parts.push(`accessibility needs (${preferences.accessibility[0]})`);
    }
    
    if (preferences.dietaryRestrictions.length > 0) {
      parts.push(`dietary requirements (${preferences.dietaryRestrictions[0]})`);
    }
    
    return parts.join(', ');
  }

  private getDateForActivity(dayNumber: number, params: GenerateActivitiesParams): string {
    const startDate = new Date(params.flightTimes?.arrival || Date.now());
    const activityDate = new Date(startDate);
    activityDate.setDate(startDate.getDate() + (dayNumber - 1));
    return activityDate.toISOString().split('T')[0];
  }

  private determineOptimalTimeSlot(
    activity: Activity,
    verification: TimeSlotVerification | undefined,
    pacePreference: string
  ): string {
    if (!verification) return activity.timeSlot;

    // If the recommended slot is available, use it
    if (
        verification.recommendedTimeSlot &&
        verification.availableTimeSlots?.includes(verification.recommendedTimeSlot)
    ) {
        return verification.recommendedTimeSlot;
    }

    // If the current slot is available, keep it
    if (verification.availableTimeSlots?.includes(activity.timeSlot)) {
        return activity.timeSlot;
    }

    // Otherwise, pick the first available slot
    return verification.availableTimeSlots?.[0] || activity.timeSlot;
  }

  private generateDayHighlights(activities: Activity[]): DayHighlight[] {
    const dayHighlights: DayHighlight[] = [];
    const activitiesByDay = new Map<number, Activity[]>();

    // Group activities by day
    activities.forEach(activity => {
      if (!activitiesByDay.has(activity.dayNumber)) {
        activitiesByDay.set(activity.dayNumber, []);
      }
      const dayActivities = activitiesByDay.get(activity.dayNumber);
      if (dayActivities) {
        dayActivities.push(activity);
      }
    });

    // Generate highlights for each day
    activitiesByDay.forEach((dayActivities, dayNumber) => {
      // Sort activities by time slot for proper sequencing
      const sortedActivities = dayActivities.sort((a, b) => {
        const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
        return timeSlotOrder[a.timeSlot as keyof typeof timeSlotOrder] - timeSlotOrder[b.timeSlot as keyof typeof timeSlotOrder];
      });

      // Get main attractions (activities with high ratings)
      const mainAttractions = sortedActivities
        .filter(a => a.rating && a.rating >= 4.5)
        .map(a => a.name);

      // Determine day's theme based on activities
      const categories = dayActivities.map(a => a.category);
      const mainCategory = this.getMostFrequentCategory(categories);
      const theme = this.getDayTheme(mainCategory, dayActivities);

      // Generate highlight text
      const highlight = this.generateDayHighlightText(sortedActivities);

      dayHighlights.push({
        dayNumber,
        highlight,
        theme,
        mainAttractions
      });
    });

    return dayHighlights;
  }

  private getMostFrequentCategory(categories: string[]): string {
    const categoryCounts = categories.reduce((acc, category) => {
      acc[category] = (acc[category] || 0) + 1;
            return acc;
    }, {} as Record<string, number>);

    return Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      [0]?.[0] || 'Mixed Activities';
  }

  private getDayTheme(mainCategory: string, activities: Activity[]): string {
    const categoryThemes: Record<string, string> = {
      'Cultural & Historical': 'Historic Exploration',
      'Nature & Adventure': 'Outdoor Adventure',
      'Food & Entertainment': 'Culinary & Culture',
      'Lifestyle & Local': 'Local Experience'
    };

    // Check for special combinations
    const hasEvening = activities.some(a => a.timeSlot === 'evening');
    const hasFood = activities.some(a => a.category === 'Food & Entertainment');
    const hasCultural = activities.some(a => a.category === 'Cultural & Historical');

    if (hasEvening && hasFood) return 'Food & Nightlife';
    if (hasCultural && hasFood) return 'Culture & Cuisine';
    
    return categoryThemes[mainCategory] || 'Mixed Activities';
  }

  private generateDayHighlightText(activities: Activity[]): string {
    const morning = activities.find(a => a.timeSlot === 'morning');
    const afternoon = activities.find(a => a.timeSlot === 'afternoon');
    const evening = activities.find(a => a.timeSlot === 'evening');

    const parts: string[] = [];

    if (morning) {
      parts.push(`Start your day with ${morning.name}`);
    }
    if (afternoon) {
      parts.push(`continue with ${afternoon.name}`);
    }
    if (evening) {
      parts.push(`end your day experiencing ${evening.name}`);
    }

    return parts.join(', ') + '.';
  }

  async generateDailyHighlights(activities: Activity[]): Promise<DailyItinerarySummary[]> {
    logger.info('[Daily Highlights] Starting to generate daily summaries');

    // Group activities by day
    const activitiesByDay = activities.reduce((acc, activity) => {
      acc[activity.dayNumber] = acc[activity.dayNumber] || [];
      acc[activity.dayNumber].push(activity);
      return acc;
    }, {} as Record<number, Activity[]>);

    const dailySummaries: DailyItinerarySummary[] = [];

    for (const [dayNumber, dayActivities] of Object.entries(activitiesByDay)) {
      try {
        // Sort activities by time slot
        const sortedActivities = dayActivities.sort((a, b) => 
          getTimeSlotValue(a.timeSlot) - getTimeSlotValue(b.timeSlot)
        );

        const query = `Generate a natural, flowing summary of this day's itinerary:

Day ${dayNumber} Activities:
${sortedActivities.map(a => `- ${a.name} (${a.timeSlot}): ${a.description}`).join('\n')}

Requirements:
1. Write a flowing paragraph that naturally connects all activities
2. Highlight the progression through the day (morning to evening)
3. Mention key highlights and transitions between activities
4. Include practical details like "after breakfast" or "in the evening"
5. Keep it concise but informative (max 4-5 sentences)

Return ONLY the summary paragraph, no additional formatting or explanation.`;

        logger.info('[Daily Highlights] Requesting summary for day', { 
          dayNumber, 
          activityCount: sortedActivities.length 
        });

        const response = await axios.post(
          this.baseUrl,
          {
            model: 'sonar',
            messages: [
              {
                role: 'system',
                content: 'You are a travel itinerary expert. Create natural, flowing summaries that connect activities logically.'
              },
              {
                role: 'user',
                content: query
              }
            ],
            temperature: 0.7,
            max_tokens: 500
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const summary = response.data.choices[0].message.content.trim();
        
        logger.info('[Daily Highlights] Generated summary for day', { 
          dayNumber, 
          summaryLength: summary.length 
        });

        dailySummaries.push({
          dayNumber: parseInt(dayNumber),
          summary,
          activities: sortedActivities
        });

      } catch (error) {
        logger.error('[Daily Highlights] Failed to generate summary for day', {
          dayNumber,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Add a basic summary if generation fails
        dailySummaries.push({
          dayNumber: parseInt(dayNumber),
          summary: `Day ${dayNumber} includes ${dayActivities.length} activities: ${dayActivities.map(a => a.name).join(', ')}.`,
          activities: dayActivities
        });
      }
    }

    // Sort summaries by day number
    dailySummaries.sort((a, b) => a.dayNumber - b.dayNumber);

    logger.info('[Daily Highlights] Completed generating daily summaries', {
      totalDays: dailySummaries.length,
      averageSummaryLength: dailySummaries.reduce((acc, day) => acc + day.summary.length, 0) / dailySummaries.length
    });

    return dailySummaries;
  }

  private async findNextAvailableDate(
    activity: Activity,
    originalDate: string,
    maxAttempts: number = 30 // Look up to 30 days ahead
  ): Promise<{ date: string; timeSlot: string } | null> {
    const startDate = new Date(originalDate);
    
    for (let i = 1; i <= maxAttempts; i++) {
      const nextDate = new Date(startDate);
      nextDate.setDate(startDate.getDate() + i);
      const dateStr = nextDate.toISOString().split('T')[0];
      
      // Check availability for this date
      const query = `Check availability for "${activity.name}" on ${dateStr}:
      1. Is this activity available on this specific date?
      2. What are the available time slots?
      3. Are there any special conditions or restrictions?
      4. What is the best time slot for this activity on this date?`;

      try {
        const response = await this.getEnrichedDetails(query);
        if (response.activities?.[0]?.timeSlotVerification?.isAvailable) {
        return {
            date: dateStr,
            timeSlot: response.activities[0].timeSlotVerification.recommendedTimeSlot ||
                     response.activities[0].timeSlotVerification.availableTimeSlots[0]
        };
      }
    } catch (error) {
        logger.error('Error checking availability for date:', {
          date: dateStr,
          activity: activity.name,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
      }
    }
    
    return null;
  }

  async enrichActivity(
    activity: Activity,
    params: GenerateActivitiesParams,
    date: string,
    retryCount: number = 0
  ): Promise<Activity | null> {
    try {
      // If we've already tried 3 times to find an available date, stop trying
      if (retryCount >= 3) {
        logger.warn('Maximum retry attempts reached for finding available dates', {
          activity: activity.name,
          originalDate: date,
          retryCount
        });
        // Instead of returning null, return the activity with a warning flag
        return {
          ...activity,
          date,
          availability: {
            isAvailable: false,
            operatingHours: 'Not available on requested dates',
            availableTimeSlots: [],
            bestTimeToVisit: 'Please check alternative dates',
            nextAvailableDate: undefined
          },
          commentary: `This activity may not be available on the requested dates. ${activity.commentary || ''}`,
          itineraryHighlight: `Consider checking alternative dates or similar activities. ${activity.itineraryHighlight || ''}`
        };
      }

      const enrichmentQuery = `Analyze this activity in ${params.destination}:
      Name: ${activity.name}
      Location: ${activity.location}
      Description: ${activity.description || ''}
      Duration: ${activity.duration} hours
      Price: ${activity.price} ${params.currency}
      Requested Date: ${date}
      Current Time Slot: ${activity.timeSlot}

      Provide a detailed analysis including:
      1. Availability check for the specified date
      2. Recommended time slots based on:
         - Activity type and nature
         - Operating hours
         - Local conditions
         - Crowd levels
         - Weather considerations
      3. Commentary focusing on:
         - Match with user interests: ${params.preferences.interests.join(', ')}
         - Alignment with travel style: ${params.preferences.travelStyle}
         - Accommodation of accessibility needs: ${params.preferences.accessibility.join(', ')}
         - Consideration of dietary restrictions: ${params.preferences.dietaryRestrictions.join(', ')}
      4. How this activity fits into the day's flow considering the ${params.preferences.pacePreference} pace preference
      5. Key highlights and unique features that match user preferences`;

      const enrichedData = await this.getEnrichedDetails(enrichmentQuery, params.preferences, date);
      
      if (!enrichedData.activities?.[0]) {
        logger.warn('No enriched data returned for activity', { name: activity.name });
        return null;
      }

      const timeSlotVerification = enrichedData.activities[0].timeSlotVerification;
      
      // If not available on requested date, try to find next available date
      if (!timeSlotVerification?.isAvailable) {
        logger.info('Activity not available on requested date, searching for alternative dates', {
          activity: activity.name,
          originalDate: date,
          retryCount
        });
        
        const nextAvailable = await this.findNextAvailableDate(activity, date);
        
        if (!nextAvailable) {
          logger.warn('No available dates found for activity', {
            name: activity.name,
            originalDate: date,
            retryCount
          });
          // Return activity with warning instead of null
          return {
            ...activity,
            date,
            availability: {
              isAvailable: false,
              operatingHours: 'Not available on requested dates',
              availableTimeSlots: [],
              bestTimeToVisit: 'Please check alternative dates',
              nextAvailableDate: undefined
            },
            commentary: `This activity may not be available on the requested dates. ${activity.commentary || ''}`,
            itineraryHighlight: `Consider checking alternative dates or similar activities. ${activity.itineraryHighlight || ''}`
          };
        }

        // Re-run enrichment with new date, incrementing retry count
        return this.enrichActivity(activity, params, nextAvailable.date, retryCount + 1);
      }

      const adjustedTimeSlot = this.determineOptimalTimeSlot(
        activity,
        timeSlotVerification,
        params.preferences.pacePreference
      );

      return {
        ...activity,
        ...enrichedData.activities[0],
        id: activity.id,
        timeSlot: adjustedTimeSlot,
        date: date,
        matchedPreferences: this.getMatchedPreferences(enrichedData.activities[0], params.preferences),
        commentary: this.ensurePreferenceReferences(
          enrichedData.activities[0].commentary || activity.commentary,
          params.preferences
        ),
        itineraryHighlight: this.ensurePreferenceReferences(
          enrichedData.activities[0].itineraryHighlight || activity.itineraryHighlight,
          params.preferences,
          true
        ),
        availability: {
          isAvailable: true,
          operatingHours: timeSlotVerification?.operatingHours,
          availableTimeSlots: timeSlotVerification?.availableTimeSlots || [],
          bestTimeToVisit: timeSlotVerification?.bestTimeToVisit,
          nextAvailableDate: date !== enrichedData.activities[0].date ? enrichedData.activities[0].date : undefined
        }
      };
    } catch (error) {
      logger.error('Error enriching activity', {
        name: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryCount
      });
      // Return activity with error flag instead of null
      return {
        ...activity,
        date,
        availability: {
          isAvailable: false,
          operatingHours: 'Error checking availability',
          availableTimeSlots: [],
          bestTimeToVisit: 'Please try again later',
          nextAvailableDate: undefined
        },
        commentary: `There was an error checking availability for this activity. ${activity.commentary || ''}`,
        itineraryHighlight: `Please verify availability before booking. ${activity.itineraryHighlight || ''}`
      };
    }
  }

  private async optimizeSchedule(activities: Activity[], days: number, destination: string): Promise<any> {
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
2. For each time slot WITHOUT a preselected activity, suggest 2-3 alternatives
3. Create a balanced schedule across ${days} days
4. Group nearby activities for each time slot
5. Consider activity durations and opening hours
6. Allow multiple options per time slot for flexibility

PROVIDE FOR EACH DAY:
1. Morning activities (2-3 options if no preselected)
2. Afternoon activities (2-3 options if no preselected)
3. Evening activities (2-3 options if no preselected)
4. Reasoning for activity grouping and timing
5. Travel logistics between activities
6. Special considerations (opening hours, crowds, weather)

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

      const response = await this.chat(query);
      
      if (!response?.schedule) {
        logger.warn('Creating basic schedule due to optimization failure');
        return this.createBasicSchedule(activities, days);
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
        return this.createBasicSchedule(activities, days);
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
      return this.createBasicSchedule(activities, days);
    }
  }

  private createBasicSchedule(activities: Activity[], days: number) {
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

    // Calculate how many activities we need per time slot
    const targetActivitiesPerTimeSlot = 3; // 2-3 options per time slot
    const timeSlots = ['morning', 'afternoon', 'evening'] as const;
    
    for (let day = 1; day <= days; day++) {
      const preselectedForDay = preselectedByDay.get(day) || [];
      const preselectedTimeSlots = new Set(preselectedForDay.map(a => a.timeSlot));
      
      // Get available time slots for this day
      const availableTimeSlots = timeSlots.filter(
        slot => !preselectedTimeSlots.has(slot)
      );

      // Group unselected activities by category for better distribution
      const categorizedActivities = unselectedActivities.reduce((acc, activity) => {
        if (!acc[activity.category]) {
          acc[activity.category] = [];
        }
        acc[activity.category].push(activity);
        return acc;
      }, {} as Record<string, Activity[]>);

      // Select additional activities for available time slots
      const additionalActivities = availableTimeSlots.flatMap(timeSlot => {
        // Get activities suitable for this time slot
        const suitableActivities = unselectedActivities
          .filter(activity => !activity.selected)
          .filter(activity => {
            if (timeSlot === 'morning') {
              return ['Cultural & Historical', 'Nature & Adventure'].includes(activity.category);
            } else if (timeSlot === 'afternoon') {
              return ['Nature & Adventure', 'Lifestyle & Local'].includes(activity.category);
            } else {
              return ['Food & Entertainment', 'Lifestyle & Local'].includes(activity.category);
            }
          })
          .sort((a, b) => (b.rating || 0) - (a.rating || 0))
          .slice(0, targetActivitiesPerTimeSlot)
          .map((activity, index) => ({
          ...activity,
            timeSlot,
            startTime: timeSlot === 'morning' ? '09:00' :
                      timeSlot === 'afternoon' ? '14:00' : '19:00',
            dayNumber: day,
            commentary: `Option ${index + 1} for ${timeSlot} activities`,
            itineraryHighlight: `Alternative activity for ${timeSlot} slot`
          }));

        return suitableActivities;
      });

      const dayActivities = [...preselectedForDay, ...additionalActivities];

      schedule.push({
        dayNumber: day,
        theme: `Day ${day} Exploration`,
        mainArea: "City Center",
        commentary: `Day ${day} activities with multiple options per time slot`,
        highlights: [`Day ${day} main activities with alternatives`],
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
      tripOverview: 'Schedule created with multiple options per time slot',
      activityFitNotes: 'Activities arranged based on time slots with alternatives for flexibility'
    };
  }
}

// Create and export a singleton instance
export const perplexityClient = new PerplexityService(); 

const optimizeSchedule = async (activities: any[], days: number, destination: string): Promise<any> => {
  try {
    const query = `Create a detailed ${days}-day schedule for ${destination} with these activities:
${activities.map(a => `- ${a.name} (${a.duration || 'N/A'} minutes)`).join('\n')}

REQUIREMENTS:
1. Create a balanced schedule across ${days} days
2. Group activities geographically to minimize travel time
3. Include specific break times and suggestions
4. Plan efficient routes between locations
5. Consider opening hours and crowd patterns
6. Include meeting points and end points for each day

FOR EACH DAY PROVIDE:
1. Theme: Main focus/theme of the day
2. Main Area: Primary geographical area being explored
3. Commentary: Detailed explanation of the day's flow
4. Highlights: Key points and special considerations
5. Timeline: Chronological sequence with:
   - Meeting point location and time
   - Each activity with exact location
   - Break times and suggested locations
   - Transport between locations
   - End point location and time
6. Logistics:
   - Transport suggestions between activities
   - Walking distances and routes
   - Time estimates for transitions
   - Break recommendations
7. Breaks Schedule:
   - Morning break suggestions
   - Lunch break with restaurant options
   - Afternoon break ideas
   - Dinner recommendations

Return as JSON with this EXACT structure:
{
  "schedule": [{
    "dayNumber": number,
    "theme": "string",
    "mainArea": "string",
    "commentary": "string",
    "highlights": ["string"],
    "mapData": {
      "center": {
        "latitude": number,
        "longitude": number
      },
      "bounds": {
        "north": number,
        "south": number,
        "east": number,
        "west": number
      },
      "locations": [{
        "name": "string",
        "coordinates": {
          "latitude": number,
          "longitude": number
        },
        "address": "string",
        "type": "activity|break|transport|landmark",
        "category": "string",
        "description": "string",
        "duration": number,
        "timeSlot": "string",
        "order": number,
        "locationType": "string"
      }],
      "routes": [{
        "from": "string",
        "to": "string",
        "mode": "walking|transit|driving",
        "duration": number,
        "distance": "string"
      }]
    },
    "breaks": {
      "morning": {
        "startTime": "string",
        "endTime": "string",
        "duration": number,
        "suggestion": "string",
        "location": "string"
      },
      "lunch": {
        "startTime": "string",
        "endTime": "string",
        "duration": number,
        "suggestion": "string",
        "location": "string"
      },
      "afternoon": {
        "startTime": "string",
        "endTime": "string",
        "duration": number,
        "suggestion": "string",
        "location": "string"
      },
      "dinner": {
        "startTime": "string",
        "endTime": "string",
        "duration": number,
        "suggestion": "string",
        "location": "string"
      }
    },
    "logistics": {
      "transportSuggestions": ["string"],
      "walkingDistances": ["string"],
      "timeEstimates": ["string"]
    }
  }],
  "tripOverview": "string",
  "activityFitNotes": "string"
}`;

    const response = await perplexityClient.chat(query);
    
    if (!response?.schedule) {
      logger.warn('Creating basic schedule due to optimization failure');
      return createBasicSchedule(activities, days);
    }

    logger.info('Schedule optimization complete with detailed planning', {
      days: response.schedule.length,
      hasMapData: response.schedule.every(day => day.mapData),
      hasBreaks: response.schedule.every(day => day.breaks),
      hasLogistics: response.schedule.every(day => day.logistics)
    });

    return {
      schedule: response.schedule,
      tripOverview: response.tripOverview,
      activityFitNotes: response.activityFitNotes
    };
  } catch (error) {
    logger.error('Failed to optimize schedule:', error);
    return createBasicSchedule(activities, days);
  }
};

// Update createBasicSchedule to match the new structure
function createBasicSchedule(activities: Activity[], days: number) {
  const schedule = [];
  const activitiesPerDay = Math.ceil(activities.length / days);

  for (let day = 1; day <= days; day++) {
    const dayActivities = activities
      .slice((day - 1) * activitiesPerDay, day * activitiesPerDay)
      .map(activity => ({
        ...activity,
        startTime: activity.timeSlot === 'morning' ? '09:00' :
                  activity.timeSlot === 'afternoon' ? '14:00' : '19:00'
      }));

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
    tripOverview: 'Basic schedule with activities distributed evenly across days',
    activityFitNotes: 'Activities arranged based on their predefined time slots'
  };
} 