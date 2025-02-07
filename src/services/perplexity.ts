import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';
import { ACTIVITY_CATEGORIES, normalizeCategory, determineCategoryFromDescription, ActivityCategory } from '../constants/categories.js';
import { ViatorService } from './viator';
import { config } from '../config/env.js';
import {
  PerplexityApiResponse,
  PerplexityError,
  PerplexityErrorResponse,
  PerplexityRequest,
  PerplexityRequestMessage,
  PerplexityTripResponse,
  PerplexityActivityResponse,
  PerplexityRequestOptions
} from '../types/perplexity';
import { Activity, TimeSlotKey, Price, TimeSlotVerification } from '../types/activities';
import { TravelPreferences } from '../types/preferences';

interface PerplexityOptions {
  temperature?: number;
  max_tokens?: number;
  model?: string;
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

interface ErrorWithResponse extends Error {
  response?: {
    status?: number;
    data?: any;
  };
  code?: string;
}

interface TimeSlotConfig {
  start: string;
  end: string;
  maxActivities: number;
}

interface DayTimeSlots {
  morning: TimeSlotConfig;
  afternoon: TimeSlotConfig;
  evening: TimeSlotConfig;
}

interface TimeSlotData {
  activities: Array<Activity & { duration: number; preferenceScore: number }>;
  remainingTime: number;
}

type TimeSlots = Record<TimeSlotKey, TimeSlotData>;

interface EnrichmentResponse {
  activities: Array<{
    name: string;
    location?: string;
    timeSlot: TimeSlotKey;
    operatingHours?: string;
    commentary?: string;
    itineraryHighlight?: string;
    timeSlotVerification?: TimeSlotVerification;
    bestTimeToVisit?: string;
  }>;
}

interface ActivityWithScore extends Activity {
  preferenceScore: number;
  scoringReason?: string;
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
  const groupedActivities = cleanedActivities.reduce((acc: Record<string, Record<typeof PRICE_TIERS[number], ActivityWithScore[]>>, activity: Activity) => {
    const category = activity.category;
    const tier = determinePriceTier(activity.price);
    
    // Calculate activity score
    const score = calculateActivityScore(activity);
    const scoredActivity: ActivityWithScore = {
      ...activity,
      preferenceScore: score.totalScore,
      scoringReason: score.reason
    };
    
    if (!acc[category]) {
      acc[category] = { budget: [], medium: [], premium: [] };
    }
    acc[category][tier].push(scoredActivity);
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
        .sort((a, b) => (b.preferenceScore - a.preferenceScore));
      
      balancedActivities.push(...allCategoryActivities.slice(0, targetPerCategory));
    } else {
      // Keep all activities in this category
      balancedActivities.push(...Object.values(categoryActivities).flat());
    }
  });

  return balancedActivities;
}

function calculateActivityScore(activity: Activity): { totalScore: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // Base score
  score += 1;
  reasons.push('Base(1)');

  // Rating score
  if (activity.rating) {
    const ratingScore = activity.rating >= 4.0 ? 1 : activity.rating >= 3.5 ? 0.5 : 0;
    score += ratingScore;
    reasons.push(`Rating(${ratingScore})`);
  }

  // Reviews score
  if (activity.numberOfReviews) {
    const reviewScore = activity.numberOfReviews > 100 ? 0.5 : activity.numberOfReviews > 50 ? 0.3 : 0.1;
    score += reviewScore;
    reasons.push(`Reviews(${reviewScore})`);
  }

  // Duration score (prefer activities between 2-4 hours)
  const duration = typeof activity.duration === 'number' ? activity.duration : 2;
  const durationScore = duration >= 2 && duration <= 4 ? 0.3 : -0.3;
  score += durationScore;
  reasons.push(`Duration(${durationScore})`);

  return {
    totalScore: score,
    reason: reasons.join(' + ')
  };
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
  return (activity1.price?.amount || 0) < (activity2.price?.amount || 0);
}

function countCategories(activities: Activity[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    acc[activity.category] = (acc[activity.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

interface DayHighlight {
    dayNumber: number;
  highlight: string;
  theme: string;
  mainAttractions: string[];
}

interface TripSummary {
  overview: string;
  dailyThemes: Array<{
    dayNumber: number;
    theme: string;
    rationale: string;
  }>;
  flowLogic: {
    progression: string;
    locationStrategy: string;
    paceConsiderations: string;
  };
  categoryDistribution: {
    [category: string]: {
      percentage: number;
      rationale: string;
    };
  };
  highlights: {
    mustSee: string[];
    uniqueExperiences: string[];
    hiddenGems: string[];
  };
}

interface DayPlanningLogic {
  theme: string;
  rationale: string;
  activityFlow: {
    morning: string;
    afternoon: string;
    evening: string;
  };
  locationStrategy: string;
  paceConsiderations: string;
  mealTimings: string;
  breakSuggestions: string;
  weatherConsiderations: string;
}

interface PerplexityDayResponse extends PerplexityApiResponse {
  dayPlanning: DayPlanningLogic;
}

interface LocalPerplexityActivityResponse extends PerplexityApiResponse {
  commentary: string;
  itineraryHighlight: string;
}

interface PerplexityActivitySuggestion {
  name: string;
  category?: string;
  timeSlot?: TimeSlotKey;
  description?: string;
  duration?: number;
  price?: Price;
  location?: string;
  commentary?: string;
  itineraryHighlight?: string;
  timeSlotVerification?: TimeSlotVerification;
  date?: string;
  operatingHours?: string;
  bestTimeToVisit?: string;
}

function countActivitiesByDay(activities: Activity[]): Record<number, number> {
  return activities.reduce((acc: Record<number, number>, activity) => {
    const day = activity.dayNumber || 1;
    acc[day] = (acc[day] || 0) + 1;
    return acc;
  }, {});
}

function countActivitiesByTimeSlot(activities: Activity[]): Record<string, number> {
  return activities.reduce((acc: Record<string, number>, activity) => {
    const slot = activity.timeSlot || 'unspecified';
    acc[slot] = (acc[slot] || 0) + 1;
    return acc;
  }, {});
}

// Add new interfaces for location handling
interface MapLocation {
  name: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  address: string;
  type: 'activity' | 'break' | 'transport' | 'landmark';
  category?: string;
  description?: string;
  duration?: number;
  timeSlot?: string;
  dayNumber: number;
  order: number;
}

interface DailyMapData {
  dayNumber: number;
  center: {
    latitude: number;
    longitude: number;
  };
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  locations: MapLocation[];
  routes: Array<{
    from: string;
    to: string;
    mode: 'walking' | 'transit' | 'driving';
    duration: number;
    distance: string;
  }>;
}

// Define Break interface
interface Break {
  startTime: string;
  endTime: string;
  duration: number;
  suggestion: string;
  location?: string;
}

// Update DailyPlanResponse interface
interface DailyPlanResponse {
  dayNumber: number;
  theme: string;
  mainArea: string;
  commentary: string;
  highlights: string[];
  mapData: DailyMapData;
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
}

export class PerplexityService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly endpoints: typeof config.apis.perplexity.endpoints;

  constructor() {
    const apiKey = config.perplexityApiKey;
    if (!apiKey) {
      throw new Error('Perplexity API key is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = config.apis.perplexity.baseUrl;
    this.apiVersion = config.apis.perplexity.version;
    this.endpoints = config.apis.perplexity.endpoints;
  }

  private getApiUrl(endpoint: keyof typeof config.apis.perplexity.endpoints): string {
    const url = `${this.baseUrl}${this.endpoints[endpoint]}`;
    try {
        new URL(url); // Validate URL
        return url;
    } catch (error) {
        logger.error('[Perplexity] Invalid API URL:', { url, error });
        throw new Error('Invalid Perplexity API URL configuration');
    }
  }

  async makePerplexityRequest(request: PerplexityRequest): Promise<PerplexityApiResponse> {
    try {
        logger.info('[Perplexity] Making API request:', {
            messageCount: request.messages?.length || 0
        });

        const url = this.getApiUrl('chat');
        logger.debug('[Perplexity] Using API URL:', url);

        const requestData = {
            messages: request.messages,
            model: request.model || 'llama-3.1-sonar-small-128k-online',
            temperature: request.temperature || 0.1
        };

        const response = await axios.post(
            url,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            }
        );

        logger.debug('[Perplexity] Raw response data:', response.data);

        if (!response.data || !response.data.choices || !Array.isArray(response.data.choices)) {
            logger.error('[Perplexity] Invalid response structure:', response.data);
            throw new Error('Invalid response structure from Perplexity API');
        }

        const content = response.data.choices[0]?.message?.content;
        if (!content) {
            logger.error('[Perplexity] Missing content in response:', response.data);
            throw new Error('Missing content in Perplexity API response');
        }

        return response.data;

    } catch (error) {
        logger.error('[Perplexity] API request failed:', error);
        
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNABORTED') {
                throw new Error('Perplexity API request timed out');
            }
            
            throw new PerplexityError(
                error.message,
                error.code || 'unknown',
                error.response?.data
            );
        }
        
        throw error;
    }
  }

  async generateActivities(params: {
    destination: string;
    days: number;
    budget: number;
    currency: string;
    flightTimes?: { arrival?: string; departure?: string };
    preferences?: TravelPreferences;
  }): Promise<any> {
    try {
        logger.info('[Activity Generation] Starting', {
            destination: params.destination,
            days: params.days,
            budget: params.budget,
            currency: params.currency
        });

        const query = `Create a ${params.days}-day itinerary for ${params.destination}. 
For each activity include:
- name
- description
- duration (in hours)
- price (amount in ${params.currency})
- category (Cultural/Historical/Entertainment)
- location (name and address)
- timeSlot (morning/afternoon/evening)
- startTime (HH:MM)
- dayNumber (1 to ${params.days})
- rating (0-5)
- isVerified (false)
- verificationStatus (pending)
- tier (budget/medium/premium based on price)

Also include:
1. Suggested daily itineraries grouped by morning/afternoon/evening
2. Daily plans with themes and logistics
3. Consider arrival time: ${params.flightTimes?.arrival || 'N/A'}
4. Consider departure time: ${params.flightTimes?.departure || 'N/A'}
5. User preferences: ${JSON.stringify(params.preferences)}
6. Budget per activity: around ${params.budget / (params.days * 3)} ${params.currency}

Return response in the EXACT format specified.`;

        const response = await this.makePerplexityRequest({
            messages: [
                {
                    role: 'system',
                    content: `You are a travel activity expert. Generate activities for a trip based on the given parameters.
Your response MUST be a valid JSON object with the following structure:
{
  "activities": [
    {
      "name": "Activity name",
      "description": "Detailed description",
      "duration": number (in minutes),
      "price": { "amount": number, "currency": string },
      "category": "Category name",
      "location": "Location name",
      "timeSlot": "morning" | "afternoon" | "evening",
      "dayNumber": number,
      "rating": number (1-5),
      "numberOfReviews": number,
      "keyHighlights": ["highlight1", "highlight2"],
      "operatingHours": "Operating hours info",
      "bookingInfo": {
        "cancellationPolicy": "Policy details",
        "instantConfirmation": boolean,
        "mobileTicket": boolean,
        "languages": ["language1", "language2"],
        "minParticipants": number,
        "maxParticipants": number
      }
    }
  ]
}`
                },
                {
                    role: 'user',
                    content: query
                }
            ]
        });

        if (!response.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from Perplexity API');
        }

        const cleanedContent = this.cleanJsonResponse(response.choices[0].message.content);
        if (!cleanedContent.isJsonLike) {
            throw new Error('Invalid JSON response from Perplexity API');
        }

        const parsedResponse = JSON.parse(cleanedContent.content);

        // Validate the response structure
        if (!parsedResponse.activities || !Array.isArray(parsedResponse.activities)) {
            throw new Error('Missing or invalid activities array in response');
        }

        // Enrich activities with additional information
        const enrichedActivities = await Promise.all(
            parsedResponse.activities.map(async (activity: Activity) => {
                try {
                    return {
                        ...activity,
                        selected: false,
                        timeSlot: activity.timeSlot || 'afternoon',
                        dayNumber: activity.dayNumber || 1
                    };
                } catch (error) {
                    logger.warn(`Failed to enrich activity ${activity.name}:`, error);
                    return activity;
                }
            })
        );

        logger.info('[Activity Generation] Completed successfully', {
            generatedCount: enrichedActivities.length
        });

        return {
            activities: enrichedActivities,
            dailyPlans: parsedResponse.dailyPlans || [],
            metadata: {
                destination: params.destination,
                days: params.days,
                totalActivities: enrichedActivities.length
            }
        };

    } catch (error) {
        logger.error('[Activity Generation] Failed:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
  }

  async getEnrichedDetails(query: string): Promise<any> {
    try {
      const response = await this.makeRequest({
          messages: [
            {
              role: 'system',
            content: `You are a travel planning assistant. Please provide detailed activity suggestions and daily plans in JSON format only. The response should include an 'activities' array and a 'dailyPlans' array with detailed logistics.`
            },
            {
              role: 'user',
              content: query
            }
        ]
      });

      // Clean and parse the response
      const cleanedContent = this.cleanJsonResponse(response.rawData);
      logger.debug('[Perplexity] Cleaned response content:', cleanedContent);

      if (!cleanedContent.content || !cleanedContent.isJsonLike) {
        throw new Error('Invalid response format from Perplexity API');
      }

      const parsedResponse = JSON.parse(cleanedContent.content);

      // Validate the response structure
      if (!parsedResponse.activities || !Array.isArray(parsedResponse.activities)) {
        throw new Error('Missing or invalid activities array in response');
      }

      if (!parsedResponse.dailyPlans || !Array.isArray(parsedResponse.dailyPlans)) {
        throw new Error('Missing or invalid dailyPlans array in response');
      }

      // Log success
      logger.info('[Activities] Generation successful:', {
        activityCount: parsedResponse.activities.length,
        dailyPlansCount: parsedResponse.dailyPlans.length
      });

      return parsedResponse;
    } catch (error) {
      logger.error('[Perplexity] Error getting enriched details:', error);
      throw error;
    }
  }

  // Add missing methods
  private cleanJsonResponse(rawData: string): { content: string; isJsonLike: boolean } {
    try {
      // Remove any markdown code block markers
      let content = rawData.replace(/```json\n?|\n?```/g, '');
      
      // Remove any non-JSON text before or after the JSON content
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd >= 0) {
        content = content.substring(jsonStart, jsonEnd + 1);
      }

      // Validate that it's parseable JSON
      JSON.parse(content);
      
      return {
        content,
        isJsonLike: true
      };
    } catch (error) {
      logger.error('[Perplexity] Error cleaning JSON response:', error);
      return {
        content: rawData,
        isJsonLike: false
      };
    }
  }

  private async makeRequest(options: {
    messages: PerplexityRequestMessage[];
    model?: string;
  }): Promise<{ rawData: string }> {
    const response = await this.makePerplexityRequest({
      messages: options.messages,
      model: options.model || 'sonar'
    });

    if (!response.choices?.[0]?.message?.content) {
      throw new Error('Invalid response format from Perplexity API');
    }

    return {
      rawData: response.choices[0].message.content
    };
  }

  async makePerplexityRequests(params: {
    query: string;
    messages?: PerplexityRequestMessage[];
    model: string;
  }): Promise<any> {
    const { query, messages = [], model } = params;

    try {
      const response = await this.makePerplexityRequest({
        messages: [
          {
            role: 'system',
            content: 'You are a travel planning assistant. Please provide detailed activity suggestions in JSON format.'
          },
          ...messages,
          {
            role: 'user',
            content: query
          }
        ],
        model
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Invalid response from Perplexity API');
      }

      const cleanedContent = this.cleanJsonResponse(content);
      if (!cleanedContent.isJsonLike) {
        throw new Error('Invalid JSON response from Perplexity API');
      }

      return JSON.parse(cleanedContent.content);
    } catch (error) {
      logger.error('[Perplexity] Error in makePerplexityRequests:', error);
      throw error;
    }
  }

  async generateItineraryPlan(params: {
    destination: string;
    days: number;
    activities: Activity[];
    preferences: TripPreferences;
  }): Promise<DailyPlanResponse[]> {
    try {
        const query = `Create a detailed daily itinerary plan for ${params.days} days in ${params.destination}.
        Activities to include: ${params.activities.map(a => a.name).join(', ')}.
        Consider preferences: ${JSON.stringify(params.preferences)}
        
        CRITICAL: Return a valid JSON array of daily plans with logistics, breaks, and map data.`;

        const response = await this.makePerplexityRequest({
            messages: [
              {
                role: 'system',
                    content: 'You are a travel itinerary planner. Create detailed daily plans with logistics and timing.'
              },
              {
                role: 'user',
                content: query
              }
            ]
        });

        const content = response.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Invalid response from Perplexity API');
        }

        const cleanedContent = this.cleanJsonResponse(content);
        if (!cleanedContent.isJsonLike) {
            throw new Error('Invalid JSON response from Perplexity API');
        }

        const parsedResponse = JSON.parse(cleanedContent.content);
        
        // Create Viator service instance
        const viatorService = new ViatorService(config.viatorApiKey);
        
        // Validate and enrich with Viator data
        const enrichedPlans = await Promise.all(
            parsedResponse.map(async (plan: DailyPlanResponse) => {
                // Enrich activities with Viator data
                const enrichedActivities = await Promise.all(
                    plan.mapData.locations
                        .filter(loc => loc.type === 'activity')
                        .map(async (location: MapLocation) => {
                            try {
                                const viatorActivity = await viatorService.searchActivity(location.name);
                                if (viatorActivity && viatorActivity.length > 0) {
        return {
                                        ...location,
                                        bookingInfo: viatorActivity[0].bookingInfo,
                                        rating: viatorActivity[0].rating,
                                        images: viatorActivity[0].images
                                    };
                                }
                                return location;
    } catch (error) {
                                logger.warn(`Failed to enrich activity ${location.name}:`, error);
                                return location;
                            }
                        })
      );

      return {
                    ...plan,
                    mapData: {
                        ...plan.mapData,
                        locations: [
                            ...enrichedActivities,
                            ...plan.mapData.locations.filter(loc => loc.type !== 'activity')
                        ]
                    }
                };
            })
        );

        logger.info('[Perplexity] Generated itinerary plan:', {
            days: enrichedPlans.length,
            totalActivities: enrichedPlans.reduce(
                (sum, plan) => sum + plan.mapData.locations.filter((l: MapLocation) => l.type === 'activity').length,
                0
            )
        });

        return enrichedPlans;

  } catch (error) {
        logger.error('[Perplexity] Failed to generate itinerary plan:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
let perplexityClient: PerplexityService | null = null;

export function getPerplexityClient(): PerplexityService {
  if (!perplexityClient) {
    logger.info('[Perplexity] Initializing service with API key');
    perplexityClient = new PerplexityService();
  }
  return perplexityClient;
}