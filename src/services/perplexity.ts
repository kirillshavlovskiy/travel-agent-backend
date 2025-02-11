import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger, logPerplexity } from '../utils/logger';
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

interface ActivityGenerationRequest {
  destination: string;
  interests?: string[];
  travelStyle?: string;
  pace?: string;
  budget: number;
  numberOfDays: number;
}

const DEFAULT_SYSTEM_MESSAGE = `You are a travel activity planner. Your task is to generate a detailed itinerary with activities that match the user's preferences.

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON object following this EXACT structure:
{
  "activities": [
    {
      "name": "Activity Name",
      "description": "Detailed description",
      "duration": 2.5,
      "price": { "amount": 50, "currency": "USD" },
      "category": "Cultural",
      "location": "Specific address or area",
      "timeSlot": "morning|afternoon|evening",
      "dayNumber": 1,
      "rating": 4.5,
      "isVerified": false,
      "verificationStatus": "pending",
      "tier": "budget|medium|premium"
    }
  ],
  "dailyPlans": [
    {
      "dayNumber": 1,
      "theme": "Theme for the day",
      "mainArea": "Main area/neighborhood",
      "commentary": "Brief explanation of the day's plan",
      "highlights": ["highlight 1", "highlight 2"]
    }
  ]
}

2. Each activity MUST include ALL fields specified above
3. Activities should be evenly distributed across days and time slots
4. Consider user preferences for activity selection
5. Ensure price tiers match the overall budget
6. Include a mix of activity categories
7. Group activities geographically when possible
8. DO NOT include any markdown or explanatory text
9. DO NOT wrap the response in code blocks`;

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
      const messages = request.messages || [];
      messages.forEach(msg => {
        if (msg.role === 'system') {
          logPerplexity.systemMessage(msg.content);
        } else if (msg.role === 'user') {
          logPerplexity.userMessage(msg.content);
        }
      });

      // If no system message was provided, use the default one
      if (!messages.some(msg => msg.role === 'system')) {
        const defaultSystemMessage = {
          role: 'system' as const,
          content: DEFAULT_SYSTEM_MESSAGE
        };
        messages.unshift(defaultSystemMessage);
        logPerplexity.systemMessage(DEFAULT_SYSTEM_MESSAGE);
      }

      const url = this.getApiUrl('chat');
      
      const requestData = {
        messages: messages,
        model: request.model || 'llama-3.1-sonar-small-128k-online',
        temperature: request.temperature || 0.1
      };

      logger.debug('[Perplexity] Making request with data:', {
        url,
        model: requestData.model,
        temperature: requestData.temperature,
        messageCount: requestData.messages.length,
        messages: requestData.messages.map(m => ({ role: m.role, contentLength: m.content.length }))
      });

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

      logger.debug('[Perplexity] Raw API response:', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data
      });

      if (!response.data || !response.data.choices || !Array.isArray(response.data.choices)) {
        logPerplexity.error(new Error('Invalid response structure from Perplexity API'));
        throw new Error('Invalid response structure from Perplexity API');
      }

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        logPerplexity.error(new Error('Missing content in Perplexity API response'));
        throw new Error('Missing content in Perplexity API response');
      }

      logger.debug('[Perplexity] Parsed content:', { 
        content,
        contentType: typeof content,
        contentLength: content.length,
        firstChars: content.substring(0, 100)
      });

      logPerplexity.modelResponse(content);
      return response.data;

    } catch (error) {
      logPerplexity.error(error);
      
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
    flightTimes?: {
      arrival?: string;
      departure?: string;
    };
    preferences?: {
      travelStyle?: string;
      pacePreference?: string;
      interests?: string[];
      accessibility?: string[];
      dietaryRestrictions?: string[];
    };
    specificDay?: number;
    existingActivities?: any[];
  }) {
    try {
      logger.info('[Activity Generation] Starting generation:', {
        destination: params.destination,
        days: params.days,
        budget: params.budget,
        preferences: params.preferences
      });

      const request: ActivityGenerationRequest = {
        destination: params.destination,
        numberOfDays: params.days,
        budget: params.budget,
        interests: params.preferences?.interests || [],
        travelStyle: params.preferences?.travelStyle || 'balanced',
        pace: params.preferences?.pacePreference || 'moderate'
      };

      const prompt = this.generateInitialPrompt(request);
      
      // Make the request with proper parameters
      const response = await this.makePerplexityRequests({
        query: prompt,
        model: 'llama-3.1-sonar-small-128k-online',
        messages: []
      });

      if (!response || !response.content || !response.isJsonLike) {
        logger.error('[Activity Generation] Invalid response format', {
          response: response ? {
            hasContent: !!response.content,
            isJsonLike: response.isJsonLike,
            contentSample: response.content?.substring(0, 200)
          } : 'No response'
        });
        throw new Error('Invalid response format from Perplexity API');
      }

      // Parse the activities from the response
      const activities = this.parseInitialActivities(response);

      if (!Array.isArray(activities) || activities.length === 0) {
        logger.error('[Activity Generation] No activities generated', {
          parsedResponse: activities
        });
        throw new Error('No activities were generated');
      }

      logger.info('[Activity Generation] Successfully parsed activities:', {
        count: activities.length,
        sample: activities[0]
      });

      // Score and balance activities
      const scoredActivities = activities.map(activity => ({
        ...activity,
        score: this.scoreActivity(activity, params)
      }));

      const balancedActivities = this.balanceActivitiesAcrossDays(scoredActivities, params);

      if (!Array.isArray(balancedActivities) || balancedActivities.length === 0) {
        logger.error('[Activity Generation] Failed to balance activities', {
          scoredCount: scoredActivities.length,
          balancedCount: balancedActivities?.length || 0
        });
        throw new Error('Failed to balance activities');
      }

      logger.info('[Activity Generation] Successfully generated activities:', {
        totalActivities: balancedActivities.length,
        byDay: countActivitiesByDay(balancedActivities),
        byTimeSlot: countActivitiesByTimeSlot(balancedActivities)
      });

      return {
        activities: balancedActivities,
        rawResponse: response.rawResponse
      };

    } catch (error: any) {
      logger.error('[Activity Generation] Failed to generate activities:', {
        error: error.message,
        params: {
          destination: params.destination,
          days: params.days,
          budget: params.budget
        },
        stack: error.stack
      });

      throw new Error(`Failed to generate activities: ${error.message}`);
    }
  }

  private balanceActivitiesAcrossDays(activities: any[], params: any): any[] {
    const { days, specificDay } = params;
    const activitiesPerDay = 4; // Target number of activities per day
    
    // If generating for a specific day, filter activities for that day
    if (specificDay) {
      return activities.map(activity => ({
        ...activity,
        dayNumber: specificDay
      }));
    }

    // Group activities by category to ensure variety
    const categorizedActivities = activities.reduce((acc: any, activity: any) => {
      const category = activity.category || 'Other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(activity);
      return acc;
    }, {});

    const balancedActivities = [];
    const timeSlots = ['morning', 'afternoon', 'evening'];
    
    // Distribute activities evenly across days and time slots
    for (let day = 1; day <= days; day++) {
      const dayActivities = [];
      
      for (const timeSlot of timeSlots) {
        // Try to get an activity from each category for variety
        const categories = Object.keys(categorizedActivities);
        for (const category of categories) {
          const availableActivities = categorizedActivities[category].filter(
            (a: any) => !a.assigned && 
                       (!a.dayNumber || a.dayNumber === day) &&
                       (!a.timeSlot || a.timeSlot === timeSlot)
          );
          
          if (availableActivities.length > 0) {
            const activity = availableActivities[0];
            activity.assigned = true;
            activity.dayNumber = day;
            activity.timeSlot = timeSlot;
            dayActivities.push(activity);
            
            // Break if we have enough activities for this time slot
            if (dayActivities.length >= activitiesPerDay / timeSlots.length) break;
          }
        }
      }
      
      balancedActivities.push(...dayActivities);
    }

    // Add any remaining unassigned activities
    const unassignedActivities = activities.filter(a => !a.assigned);
    for (let i = 0; i < unassignedActivities.length; i++) {
      const activity = unassignedActivities[i];
      const day = (i % days) + 1;
      const timeSlot = timeSlots[Math.floor(i / days) % timeSlots.length];
      
      activity.dayNumber = day;
      activity.timeSlot = timeSlot;
      balancedActivities.push(activity);
    }

    return balancedActivities;
  }

  private scoreActivity(activity: any, params: any): any {
    const { preferences } = params;
    
    // Base score starts at 50
    let baseScore = 50;
    const matchedPreferences = [];
    
    // Score based on interests match
    if (preferences?.interests) {
      const interestMatch = preferences.interests.some(
        (interest: string) => 
          activity.category?.toLowerCase().includes(interest.toLowerCase()) ||
          activity.description?.toLowerCase().includes(interest.toLowerCase())
      );
      if (interestMatch) {
        baseScore += 20;
        matchedPreferences.push('Interest match');
      }
    }
    
    // Score based on travel style
    if (preferences?.travelStyle) {
      const styleMatch = activity.category?.toLowerCase().includes(preferences.travelStyle.toLowerCase());
      if (styleMatch) {
        baseScore += 15;
        matchedPreferences.push('Travel style match');
      }
    }
    
    // Score based on pace preference
    if (preferences?.pacePreference) {
      const duration = activity.duration || 2;
      const isPaceMatch = 
        (preferences.pacePreference === 'relaxed' && duration <= 2) ||
        (preferences.pacePreference === 'moderate' && duration <= 4) ||
        (preferences.pacePreference === 'active' && duration > 4);
      
      if (isPaceMatch) {
        baseScore += 15;
        matchedPreferences.push('Pace preference match');
      }
    }

      return {
      scoring: {
        baseScore,
        preferenceScore: baseScore,
        categoryMatch: preferences?.interests ? 
          (activity.category?.toLowerCase().includes(preferences.interests[0].toLowerCase()) ? 100 : 0) : 0,
        timeSlotMatch: 100, // Assuming time slots are already optimized
        priceMatch: 100, // Price matching would be done in Viator enrichment
        matchedPreferences,
        reasoning: `Base score ${baseScore} with ${matchedPreferences.length} preference matches`
      }
    };
  }

  private calculateAverageScores(activities: any[]): any {
    const scores = activities.reduce((acc, activity) => {
      acc.baseScore += activity.scoring.baseScore || 0;
      acc.preferenceScore += activity.scoring.preferenceScore || 0;
      acc.categoryMatch += activity.scoring.categoryMatch || 0;
      acc.timeSlotMatch += activity.scoring.timeSlotMatch || 0;
      acc.priceMatch += activity.scoring.priceMatch || 0;
      return acc;
    }, {
      baseScore: 0,
      preferenceScore: 0,
      categoryMatch: 0,
      timeSlotMatch: 0,
      priceMatch: 0
    });

    const count = activities.length;
    return {
      baseScore: scores.baseScore / count,
      preferenceScore: scores.preferenceScore / count,
      categoryMatch: scores.categoryMatch / count,
      timeSlotMatch: scores.timeSlotMatch / count,
      priceMatch: scores.priceMatch / count
    };
  }

  private parseInitialActivities(response: any): any[] {
    try {
      // Extract content from response
      const content = response?.content || '';
      
      // First try to extract JSON from markdown code blocks
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonContent = codeBlockMatch ? codeBlockMatch[1] : content;
      
      // Clean the content
      let cleanedContent = jsonContent
        .replace(/"price":\s*free\s*,/g, '"price": 0,') // Convert "free" to 0
        .trim();
      
      // Parse the JSON
      const parsedContent = JSON.parse(cleanedContent);
      
      // Validate that we have an array
      if (!Array.isArray(parsedContent)) {
        logger.error('[Activity Parsing] Parsed content is not an array', { content: parsedContent });
        return [];
      }

      // Transform and validate each activity
      return parsedContent.map(activity => ({
        name: activity.name || '',
        description: activity.description || '',
        duration: typeof activity.duration === 'number' ? activity.duration : 0,
        price: {
          amount: typeof activity.price === 'number' ? activity.price : 0,
          currency: 'USD'
        },
        category: activity.category || 'Cultural',
        location: activity.location || '',
        timeSlot: activity.timeSlot || 'morning',
        dayNumber: activity.dayNumber || 1,
        tier: this.determineTier(typeof activity.price === 'number' ? activity.price : 0),
        isVerified: false,
        verificationStatus: 'pending',
        rating: activity.rating || 4.0
      }));
    } catch (error) {
      logger.error('[Activity Parsing] Failed to parse activities', {
        error,
        content: response?.content?.substring(0, 200)
      });
      return [];
    }
  }

  private determineTier(price: number): string {
    if (price <= 50) return 'budget';
    if (price <= 150) return 'medium';
    return 'premium';
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
      // First try to find JSON in markdown code blocks
      const jsonMatch = rawData.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      let content = jsonMatch ? jsonMatch[1] : rawData;

      // Clean up the content
      content = content
        .replace(/"price":\s*free\s*,/g, '"price": 0,')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '')
        .replace(/\t/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Remove any non-JSON text before the first { or [ and after the last } or ]
      content = content.replace(/^[^{\[]*/, '').replace(/[^}\]]*$/, '');

      // Try to parse to validate JSON
      JSON.parse(content);
      
      return {
        content,
        isJsonLike: true
      };

    } catch (error) {
      logger.error('[Perplexity] Failed to clean JSON response', {
        error: error.message,
        rawData: rawData.substring(0, 200) // Log first 200 chars for debugging
      });

      // If JSON parsing failed, try to extract any JSON-like structure
      const jsonStructureMatch = rawData.match(/[{\[]([\s\S]*?)[}\]]/);
      if (jsonStructureMatch) {
        try {
          const extracted = jsonStructureMatch[0];
          JSON.parse(extracted); // Validate it's valid JSON
      return {
            content: extracted,
            isJsonLike: true
          };
        } catch (e) {
          // If this also fails, return the raw data
          logger.error('[Perplexity] Failed to extract JSON structure', {
            error: e.message,
            extractedSample: jsonStructureMatch[0].substring(0, 200)
          });
        }
      }

      // Return cleaned raw data as last resort
      return {
        content: rawData.replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' ').trim(),
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
      model: options.model || 'llama-3.1-sonar-small-128k-online'
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
    try {
      logger.info('[Perplexity] Making API request', {
        service: 'perplexity',
        data: { request: params }
      });

      const response = await this.makeRequest({
        messages: [
          {
            role: 'system',
            content: DEFAULT_SYSTEM_MESSAGE
          },
          {
            role: 'user',
            content: params.query
          },
          ...(params.messages || [])
        ],
        model: params.model
      });

      if (!response || !response.rawData) {
        throw new Error('Empty response from Perplexity API');
      }

      const cleanedResponse = this.cleanJsonResponse(response.rawData);
      
      if (!cleanedResponse.content) {
        throw new Error('No content in cleaned response');
      }

      logger.info('[Perplexity] Received response', {
        service: 'perplexity',
        data: {
          isJsonLike: cleanedResponse.isJsonLike,
          contentLength: cleanedResponse.content.length,
          sampleContent: cleanedResponse.content.substring(0, 200)
        }
      });

      return {
        content: cleanedResponse.content,
        isJsonLike: cleanedResponse.isJsonLike,
        rawResponse: response.rawData
      };

    } catch (error: any) {
      logger.error('[Perplexity] API request failed', {
        error: error.message,
        stack: error.stack,
        params: {
          model: params.model,
          queryLength: params.query.length,
          messagesCount: params.messages?.length || 0
        }
      });
      throw new Error(`Perplexity API request failed: ${error.message}`);
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

  private async generateDailyPlans(
    activities: any[],
    days: number,
    preferences: any
  ): Promise<any[]> {
    const dailyPlans = [];
    
    for (let day = 1; day <= days; day++) {
      const dayActivities = activities.filter(a => a.dayNumber === day);
      const planPrompt = this.generateDailyPlanPrompt(day, dayActivities, preferences);
      
      const planResponse = await this.makePerplexityRequest({
        messages: [{
          role: 'user',
          content: planPrompt
        }]
      });
      
      const parsedPlan = this.parseDailyPlan(planResponse, day);
      dailyPlans.push(parsedPlan);
    }
    
    return dailyPlans;
  }

  private generateDailyPlanPrompt(
    day: number,
    activities: any[],
    preferences: any
  ): string {
    return `Create a detailed plan for Day ${day} using these activities:
${JSON.stringify(activities, null, 2)}

User Preferences:
${JSON.stringify(preferences, null, 2)}

Include in the response:
1. Day theme and rationale
2. Morning activities with timing and flow
3. Afternoon activities with timing and flow
4. Evening activities with timing and flow
5. Logistics (transportation, breaks)
6. Highlights and unique experiences
7. Practical tips and considerations

Return a JSON object with the daily plan structure.`;
  }

  private parseScoring(response: any, originalActivities: any[]): any[] {
    try {
        let parsedData;
        if (typeof response.rawData === 'string') {
      const jsonMatch = response.rawData.match(/```json\n([\s\S]*?)\n```/) || response.rawData.match(/{[\s\S]*}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON structure found in scoring response');
            }
            parsedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } else {
            parsedData = response.rawData;
        }

        // If no activities in response, return original activities
        if (!parsedData || !parsedData.activities) {
            return originalActivities;
        }

        // Map the scoring data to the original activities
        return originalActivities.map(activity => {
            const scoringData = parsedData.activities.find(a => a.name === activity.name) || {};
            return {
        ...activity,
        scoring: {
                    baseScore: scoringData.baseScore || 0,
                    preferenceScore: scoringData.preferenceMatchingScore || 0,
                    categoryMatch: scoringData.categoryMatchScore || 0,
                    timeSlotMatch: scoringData.timeSlotMatchScore || 0,
                    priceMatch: scoringData.priceMatchScore || 0,
                    matchedPreferences: scoringData.matchedPreferences || [],
                    reasoning: scoringData.reasoning || 'No scoring data available'
        },
        preselection: {
                    isSelected: scoringData.preselectionStatus || false,
                    reason: scoringData.reasoning || 'Not scored'
                }
            };
        });
    } catch (error) {
        console.error('Error parsing scoring response:', error);
        return originalActivities;
    }
  }

  private parseDailyPlan(response: any, day: number): any {
    try {
        logger.debug('[Perplexity] Parsing daily plan response:', {
            responseType: typeof response,
            hasRawData: !!response?.rawData,
            hasChoices: !!response?.choices,
            day
        });

        let parsedData;
        let rawContent;

        // Handle different response formats
        if (typeof response === 'string') {
            rawContent = response;
        } else if (response?.rawData) {
            rawContent = response.rawData;
        } else if (response?.choices?.[0]?.message?.content) {
            rawContent = response.choices[0].message.content;
        } else if (typeof response === 'object') {
            parsedData = response;
        }

        // If we have raw content, try to parse it
        if (rawContent && !parsedData) {
            logger.debug('[Perplexity] Attempting to parse raw content');
            
            // Clean up the content
            rawContent = rawContent
                .replace(/\u001b\[\d+m/g, '')
                .replace(/\(base\).*?%/g, '')
                .replace(/Command completed\..*$/s, '')
                .replace(/\* Connection #\d+ to host.*$/gm, '')
                .replace(/^[^{]*({[\s\S]*})[^}]*$/, '$1');

            try {
                logger.debug('[Perplexity] Attempting to parse cleaned content:', { 
                    contentStart: rawContent.substring(0, 100),
                    contentLength: rawContent.length 
                });
                parsedData = JSON.parse(rawContent);
            } catch (parseError) {
                logger.error('[Perplexity] Failed to parse cleaned content:', { error: parseError });
                
                const jsonMatch = rawContent.match(/```json\n([\s\S]*?)\n```/) || rawContent.match(/{[\s\S]*}/);
                if (jsonMatch) {
                    try {
                        const jsonContent = jsonMatch[1] || jsonMatch[0];
                        parsedData = JSON.parse(jsonContent);
                    } catch (innerError) {
                        logger.error('[Perplexity] Failed to parse JSON from markdown:', { error: innerError });
                        throw new Error('Failed to parse JSON in daily plan response');
                    }
                } else {
        throw new Error('No valid JSON structure found in daily plan response');
                }
            }
        }

        if (!parsedData) {
            logger.error('[Perplexity] No valid data found in response');
            throw new Error('No valid data found in response');
        }

        logger.debug('[Perplexity] Successfully parsed data structure:', { 
            keys: Object.keys(parsedData),
            hasActivities: !!parsedData.activities,
            hasDailyPlans: !!parsedData.dailyPlans
        });

        // If the response has dailyPlans, extract the relevant day
        if (parsedData.dailyPlans && Array.isArray(parsedData.dailyPlans)) {
            const dailyPlan = parsedData.dailyPlans.find((p: any) => p.dayNumber === day);
            if (dailyPlan) {
                parsedData = dailyPlan;
            }
        }

        // Extract activities and time slots with null checks
        const activities = parsedData.activities || {};
        const morningActivities = activities.morning || [];
        const afternoonActivities = activities.afternoon || [];
        const eveningActivities = activities.evening || [];

        // Score activities for each time slot
        const scoredMorningActivities = this.scoreTimeSlotActivities(morningActivities, 'morning', day);
        const scoredAfternoonActivities = this.scoreTimeSlotActivities(afternoonActivities, 'afternoon', day);
        const scoredEveningActivities = this.scoreTimeSlotActivities(eveningActivities, 'evening', day);

        // Log scoring details
        logger.info('[Activity Scoring] Daily plan activity scores:', {
            dayNumber: day,
            timeSlots: {
                morning: {
                    activities: scoredMorningActivities.map(a => ({
                        name: a.name,
                        baseScore: a.scoring?.baseScore || 0,
                        preferenceScore: a.scoring?.preferenceScore || 0,
                        timeSlotScore: a.scoring?.timeSlotScore || 0,
                        finalScore: a.scoring?.finalScore || 0,
                        selectionReason: a.scoring?.reason || 'No scoring data'
                    }))
                },
                afternoon: {
                    activities: scoredAfternoonActivities.map(a => ({
                        name: a.name,
                        baseScore: a.scoring?.baseScore || 0,
                        preferenceScore: a.scoring?.preferenceScore || 0,
                        timeSlotScore: a.scoring?.timeSlotScore || 0,
                        finalScore: a.scoring?.finalScore || 0,
                        selectionReason: a.scoring?.reason || 'No scoring data'
                    }))
                },
                evening: {
                    activities: scoredEveningActivities.map(a => ({
                        name: a.name,
                        baseScore: a.scoring?.baseScore || 0,
                        preferenceScore: a.scoring?.preferenceScore || 0,
                        timeSlotScore: a.scoring?.timeSlotScore || 0,
                        finalScore: a.scoring?.finalScore || 0,
                        selectionReason: a.scoring?.reason || 'No scoring data'
                    }))
                }
            }
        });

        // Transform the response into the expected structure
        const result = {
            dayNumber: day,
            theme: parsedData.theme || 'Mixed Activities',
            mainArea: parsedData.mainArea || 'Various Locations',
            activities: {
                morning: scoredMorningActivities,
                afternoon: scoredAfternoonActivities,
                evening: scoredEveningActivities
            },
            breaks: parsedData.breaks || {
                morning: {
                    startTime: '10:30',
                    endTime: '11:00',
                    duration: 30,
                    suggestion: 'Coffee break and rest',
                    location: 'Nearby cafe or rest area'
                },
                lunch: {
                    startTime: '12:30',
                    endTime: '13:30',
                    duration: 60,
                    suggestion: 'Lunch break',
                    location: 'Local restaurant'
                },
                afternoon: {
                    startTime: '15:30',
                    endTime: '16:00',
                    duration: 30,
                    suggestion: 'Rest and refresh',
                    location: 'Nearby cafe or rest area'
                }
            },
            logistics: parsedData.logistics || {
                transportSuggestions: [],
                walkingDistances: [],
                timeEstimates: []
            },
            commentary: parsedData.commentary || 'Diverse day with various activities',
            highlights: parsedData.highlights || []
        };

        // Add detailed activity logging
        logger.info('[Activity Planning] Daily plan details:', {
            ...result,
            themeRationale: parsedData.themeRationale || 'Theme selected based on activities and preferences',
            themePreferenceAlignment: parsedData.themePreferenceAlignment || 'Theme aligns with user preferences',
            areaSelectionReason: parsedData.areaSelectionReason || 'Area selected for optimal activity distribution',
            dayOverview: parsedData.dayOverview || result.commentary,
            morningNarrative: parsedData.morningNarrative || 'Morning activities planned',
            afternoonNarrative: parsedData.afternoonNarrative || 'Afternoon activities planned',
            eveningNarrative: parsedData.eveningNarrative || 'Evening activities planned',
            specialConsiderations: parsedData.specialConsiderations || '',
            activities: {
                morning: result.activities.morning.map((a: any) => ({
                    ...a,
                    preferenceScore: a.scoring?.preferenceScore || 0,
                    selectionReason: a.scoring?.reason || 'Activity matches daily theme',
                    timingRationale: a.scoring?.timeSlotScore || 'Optimal timing for this activity',
                    themeConnection: a.themeConnection || 'Connects to daily theme'
                })),
                afternoon: result.activities.afternoon.map((a: any) => ({
                    ...a,
                    preferenceScore: a.scoring?.preferenceScore || 0,
                    selectionReason: a.scoring?.reason || 'Activity matches daily theme',
                    timingRationale: a.scoring?.timeSlotScore || 'Optimal timing for this activity',
                    themeConnection: a.themeConnection || 'Connects to daily theme'
                })),
                evening: result.activities.evening.map((a: any) => ({
                    ...a,
                    preferenceScore: a.scoring?.preferenceScore || 0,
                    selectionReason: a.scoring?.reason || 'Activity matches daily theme',
                    timingRationale: a.scoring?.timeSlotScore || 'Optimal timing for this activity',
                    themeConnection: a.themeConnection || 'Connects to daily theme'
                }))
            },
            breaks: {
                ...result.breaks,
                placement_rationale: parsedData.breakPlacementRationale || 'Breaks placed at optimal intervals'
            },
            logistics: {
                ...result.logistics,
                routing_strategy: parsedData.routingStrategy || 'Efficient route between activities',
                transportation_logic: parsedData.transportationLogic || 'Mix of walking and public transport'
            },
            highlights: {
                mainAttractions: parsedData.highlights || [],
                uniqueExperiences: parsedData.uniqueExperiences || [],
                localInsights: parsedData.localInsights || [],
                selectionCriteria: parsedData.selectionCriteria || 'Selected based on preferences and ratings'
            },
            commentary: result.commentary,
            practicalTips: parsedData.practicalTips || 'Plan ahead and check opening times',
            weatherConsiderations: parsedData.weatherConsiderations || 'Activities suitable for various weather conditions',
            crowdManagement: parsedData.crowdManagement || 'Visit popular attractions at optimal times'
        });
        
        return result;

    } catch (error) {
        logger.error('[Perplexity] Error parsing daily plan response:', { 
            error,
            day,
            responseType: typeof response,
            responseStructure: response ? Object.keys(response) : null
        });

        // Return a safe default structure
        return {
            dayNumber: day,
            theme: 'Mixed Activities',
            mainArea: 'Various Locations',
            activities: {
                morning: [],
                afternoon: [],
                evening: []
            },
            breaks: {
                lunch: {
                    startTime: '12:30',
                    endTime: '13:30',
                    duration: 60,
                    suggestion: 'Lunch break',
                    location: 'Local restaurant'
                }
            },
            logistics: {
                transportSuggestions: [],
                walkingDistances: [],
                timeEstimates: []
            },
            commentary: 'Diverse day with various activities',
            highlights: []
        };
    }
  }

  private extractActivitiesFromTimeSlot(activities: any[]): any[] {
    if (!Array.isArray(activities)) {
        logger.debug('[Perplexity] Invalid activities format:', { 
            receivedType: typeof activities,
            value: activities 
        });
        return [];
    }
    
    return activities.map(activity => ({
        name: activity.name || activity.activity || 'Unknown Activity',
        description: activity.description || activity.flow || '',
        duration: activity.duration || 2,
        price: activity.price || { amount: 0, currency: 'USD' },
        category: activity.category || 'General',
        location: activity.location || '',
        rating: activity.rating || 0,
        isVerified: activity.isVerified || false,
        verificationStatus: activity.verificationStatus || 'pending',
        tier: activity.tier || 'budget'
    }));
  }

  private generateInitialPrompt(request: ActivityGenerationRequest): string {
    const { 
      destination,
      interests = [],
      travelStyle = 'balanced',
      pace = 'moderate',
      budget,
      numberOfDays 
    } = request;
    
    return `Generate a list of activities for a ${numberOfDays}-day trip to ${destination}. 
Consider these preferences:
- Interests: ${interests.length > 0 ? interests.join(', ') : 'general sightseeing'}
- Travel style: ${travelStyle}
- Pace: ${pace}
- Budget: ${budget}

Return a JSON array of activities, where each activity has:
- name (string): Activity name
- description (string): Brief description
- duration (number): Duration in hours
- price (number): Price in USD (use 0 for free activities)
- category (string): One of [Cultural, Adventure, Nature, Food, Shopping, Entertainment]
- location (string): Location name or address
- timeSlot (string): One of [morning, afternoon, evening]
- dayNumber (number): Day number for this activity (1 to ${numberOfDays})

Format the response as a JSON array in a code block, like this:
\`\`\`json
[
  {
    "name": "Example Activity",
    "description": "Description here",
    "duration": 2,
    "price": 25,
    "category": "Cultural",
    "location": "123 Example St",
    "timeSlot": "morning",
    "dayNumber": 1
  }
]
\`\`\`

Ensure:
1. Each day has 3-4 activities spread across different time slots
2. Activities match the interests and travel style
3. Total daily cost fits within ${budget} budget
4. Activities are properly spaced based on ${pace} pace preference
5. All JSON fields use the exact names and types specified above
6. Price is always a number (use 0 for free activities)
7. Duration is always a number in hours`;
  }

  private scoreTimeSlotActivities(activities: any[], timeSlot: string, day: number): any[] {
    return activities.map(activity => {
      // Calculate base score from rating and verification status
      const baseScore = (activity.rating || 0) * 20 + (activity.isVerified ? 20 : 0);
      
      // Calculate preference score based on category and price tier
      const preferenceScore = this.calculatePreferenceScore(activity);
      
      // Calculate time slot appropriateness score
      const timeSlotScore = this.calculateTimeSlotScore(activity, timeSlot, day);
      
      // Calculate final score
      const finalScore = (baseScore + preferenceScore + timeSlotScore) / 3;
      
      // Generate scoring reason
      const reason = this.generateScoringReason({
        baseScore,
        preferenceScore,
        timeSlotScore,
        finalScore
      });
      
      return {
        ...activity,
        scoring: {
          baseScore,
          preferenceScore,
          timeSlotScore,
          finalScore,
          reason
        }
      };
    });
  }

  private calculatePreferenceScore(activity: any): number {
    let score = 50; // Base preference score
    
    // Add points for category match
    if (activity.category) {
      score += 25;
    }
    
    // Add points for price tier appropriateness
    if (activity.tier === 'budget') {
      score += 15;
    } else if (activity.tier === 'medium') {
      score += 10;
    }
    
    return Math.min(score, 100);
  }

  private calculateTimeSlotScore(activity: any, timeSlot: string, day: number): number {
    let score = 50; // Base time slot score
    
    // Add points for appropriate duration in time slot
    const duration = activity.duration || 2;
    if (timeSlot === 'morning' && duration <= 3) {
      score += 20;
    } else if (timeSlot === 'afternoon' && duration <= 4) {
      score += 20;
    } else if (timeSlot === 'evening' && duration <= 3) {
      score += 20;
    }
    
    // Add points for first/last day considerations
    if (day === 1 && timeSlot === 'morning') {
      score += 15; // Bonus for morning activities on first day
    }
    
    return Math.min(score, 100);
  }

  private generateScoringReason(scores: {
    baseScore: number;
    preferenceScore: number;
    timeSlotScore: number;
    finalScore: number;
  }): string {
    const reasons: string[] = [];
    
    if (scores.baseScore >= 80) {
      reasons.push('High rating and verification');
    } else if (scores.baseScore >= 60) {
      reasons.push('Good rating');
    }
    
    if (scores.preferenceScore >= 80) {
      reasons.push('Strong preference match');
    } else if (scores.preferenceScore >= 60) {
      reasons.push('Good preference alignment');
    }
    
    if (scores.timeSlotScore >= 80) {
      reasons.push('Optimal time slot');
    } else if (scores.timeSlotScore >= 60) {
      reasons.push('Suitable timing');
    }
    
    return reasons.join(', ') || 'Moderate overall match';
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