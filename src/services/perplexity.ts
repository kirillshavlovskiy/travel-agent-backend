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

  logger.info('[Activity Balancing] Starting activity balancing', {
    totalActivities
  });

  // Only remove exact duplicates
  const seen = new Set<string>();
  const balancedActivities = activities.filter(activity => {
    const key = `${activity.name}|${activity.bookingInfo?.productCode || ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // Calculate distribution for logging purposes
  const distribution = calculateDistribution(balancedActivities);
  logger.info('[Activity Balancing] Activity distribution', { distribution });

  return balancedActivities;
}

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
  private perplexityApiCallCount = 0;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || '';
    this.baseUrl = 'https://api.perplexity.ai/chat/completions';
    this.resetPerplexityApiCallCount();
    
    if (!this.apiKey) {
      throw new Error('PERPLEXITY_API_KEY environment variable is required');
    }
  }

  public getPerplexityApiCallCount(): number {
    return this.perplexityApiCallCount;
  }

  public resetPerplexityApiCallCount(): void {
    this.perplexityApiCallCount = 0;
  }

  private getDateForActivity(dayNumber: number, startDate?: string): string {
    try {
      if (!startDate) {
        const date = new Date();
        date.setDate(date.getDate() + (dayNumber - 1));
        return date.toISOString().split('T')[0];
      }

      const date = new Date(startDate);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid start date: ${startDate}`);
      }
      
      date.setDate(date.getDate() + (dayNumber - 1));
      return date.toISOString().split('T')[0];
      } catch (error) {
      logger.error('[Perplexity] Error calculating activity date:', {
        dayNumber,
        startDate,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return new Date().toISOString().split('T')[0];
    }
  }

  async generateActivities(params: GenerateActivitiesParams): Promise<any> {
    this.resetPerplexityApiCallCount();
    try {
      this.perplexityApiCallCount++;
      logger.info('[Perplexity] Generating activities:', {
        destination: params.destination,
        days: params.days,
        budget: params.budget,
        currency: params.currency,
        hasPreferences: !!params.preferences,
        hasFlightTimes: !!params.flightTimes,
        apiCallCount: this.perplexityApiCallCount
      });

      logger.info('Received activity generation request', params);

      // 1. Initial activity generation
      const query = this.buildActivityQuery(params);
      logger.debug('Sending query to Perplexity API', { query });
      const chatResponse = await this.chat(query);
      const activities = chatResponse.activities || [];
      
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
        const date = this.getDateForActivity(activity.dayNumber, params.flightTimes?.arrival);
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

      const finalResponse = {
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
        metadata: finalResponse.metadata
      });

      return finalResponse;

    } catch (error) {
      logger.error('[Perplexity] Error generating activities:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        apiCallCount: this.perplexityApiCallCount
      });
      throw error;
    }
  }

  // For initial activity planning - uses sonar model
  async chat(query: string, options?: { web_search?: boolean; temperature?: number; max_tokens?: number }): Promise<PerplexityApiResponse> {
    try {
      this.perplexityApiCallCount++;
      logger.info('[Perplexity] Making API call:', {
        promptLength: query.length,
        apiCallCount: this.perplexityApiCallCount
      });

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
              content: 'You are a helpful travel planning assistant. Generate activities for the requested destination, ensuring variety in categories and time slots. Return ONLY valid JSON.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          temperature: options?.temperature ?? 0.4,
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
        logger.warn('[Perplexity] No content in response');
        throw new Error('No content in response');
      }

      logger.debug('[Perplexity] Raw response:', { rawContent });

      // Clean and parse the content
      let cleanedContent = this.cleanJsonString(rawContent);
      let parsedContent: any;

      try {
        parsedContent = JSON.parse(cleanedContent);
      } catch (e) {
        // If direct parsing fails, try to extract JSON array
        const jsonMatch = cleanedContent.match(/\[\s*\{[\s\S]*\}\s*\]/) || cleanedContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error('[Activity Generation] No JSON array found in response');
          throw new Error('Failed to parse response as JSON');
        }
        const jsonContent = jsonMatch[0];
        
        try {
          const activities = JSON.parse(jsonContent);
          parsedContent = {
            activities: Array.isArray(activities) ? activities : [activities],
            dailySummaries: []
          };
        } catch (e) {
          logger.error('[Activity Generation] Failed to parse JSON:', e);
          throw new Error('Failed to parse extracted JSON');
        }
      }

      if (!parsedContent.activities || !Array.isArray(parsedContent.activities) || parsedContent.activities.length === 0) {
        logger.error('[Activity Generation] No activities found in parsed content');
        throw new Error('No activities found in response');
      }

      // Ensure activities are properly distributed across days and time slots
      const activities = this.distributeActivities(parsedContent.activities);

      logger.info('[Activity Generation] Successfully generated activities:', {
        totalActivities: activities.length,
        uniqueActivities: new Set(activities.map(a => a.name)).size
      });

      return {
        activities,
        dailySummaries: []
      };
    } catch (error) {
      logger.error('[Perplexity] Error in chat:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        apiCallCount: this.perplexityApiCallCount
      });
      throw error;
    }
  }

  private distributeActivities(activities: Activity[]): Activity[] {
    // Group activities by day and time slot
    const distribution = activities.reduce((acc, activity) => {
      if (!acc[activity.dayNumber]) {
        acc[activity.dayNumber] = {
          morning: [],
          afternoon: [],
          evening: []
        };
      }
      acc[activity.dayNumber][activity.timeSlot].push(activity);
      return acc;
    }, {} as Record<number, Record<string, Activity[]>>);

    // Ensure each day has activities in each time slot
    const distributedActivities: Activity[] = [];
    Object.entries(distribution).forEach(([day, slots]) => {
      ['morning', 'afternoon', 'evening'].forEach(slot => {
        if (slots[slot].length > 0) {
          distributedActivities.push(...slots[slot]);
        }
      });
    });

    return distributedActivities;
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
    }],
    "dayPlanningLogic": "string"
  }],
  "tripOverview": "string",
  "activityFitNotes": "string"
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

  private buildActivityQuery(params: GenerateActivitiesParams): string {
    const {
      destination,
      days,
      budget,
      currency,
      preferences,
      flightTimes
    } = params;

    return `Generate ${days * 3} unique activities for a ${days}-day trip to ${destination} with a total budget of ${budget} ${currency}.

IMPORTANT REQUIREMENTS:
1. CRITICAL: Only suggest activities that are EXACTLY available on the Viator platform (https://www.viator.com)
2. Use EXACT activity names as listed on Viator - do not modify or paraphrase them
3. Each activity must be a real, bookable Viator experience
4. Include specific Viator activity details like exact duration, price range, and category
5. Generate ${days * 3} high-quality activities that match the criteria (3 activities per day)
6. Ensure activities are evenly distributed across days and time slots (morning/afternoon/evening)

Travel Style: ${preferences.travelStyle}
Pace: ${preferences.pacePreference}
Interests: ${preferences.interests.join(', ')}
${preferences.accessibility.length ? `Accessibility Needs: ${preferences.accessibility.join(', ')}` : ''}
${preferences.dietaryRestrictions.length ? `Dietary Restrictions: ${preferences.dietaryRestrictions.join(', ')}` : ''}
${flightTimes ? `
Flight Arrival: ${flightTimes.arrival}
Flight Departure: ${flightTimes.departure}` : ''}

For each activity, provide:
1. Exact Viator activity name (do not modify)
2. Category from Viator's classification
3. Suggested time slot (morning/afternoon/evening)
4. Day number (1 to ${days})
5. Expected duration from Viator listing
6. Price range from Viator (in ${currency})

Return as JSON with this structure:
{
  "activities": [{
    "name": "EXACT Viator activity name",
    "category": "Viator category",
    "timeSlot": "morning/afternoon/evening",
    "dayNumber": number,
    "duration": "X hours Y minutes",
    "price": {
      "amount": number,
      "currency": "${currency}"
    }
  }]
}`;
  }
}

// Create and export a singleton instance
export const perplexityClient = new PerplexityService(); 