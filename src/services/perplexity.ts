import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';
import { ACTIVITY_CATEGORIES, normalizeCategory, determineCategoryFromDescription, ActivityCategory } from '../constants/categories.js';
import { Activity } from '../types/activity';
import { ViatorService } from './viator';

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

export interface GenerateActivitiesParams {
    departureLocation: {
        code: string;
        label: string;
    };
    destinations: Array<{
        code: string;
        label: string;
    }>;
    startDate: string;
    endDate: string;
    travelers: number;
    currency: string;
    budgetLimit: number;
  preferences: {
    travelStyle: string;
    pacePreference: string;
    interests: string[];
    accessibility: string[];
    dietaryRestrictions: string[];
  };
}

export interface DayHighlight {
  dayNumber: number;
  theme: string;
  mainArea: string;
  summary: string;
  activities: Activity[];
}

export interface DailyItinerarySummary {
    dayNumber: number;
  date: string;
  summary: string;
  activities: Activity[];
  highlights: string[];
  mainArea: string;
  theme: string;
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
    try {
      logger.info('[Perplexity] Starting activity generation', { destination: params.destinations[0].label });
        
        // Extract destination info
        const destination = params.destinations[0].label;
        const destinationId = params.destinations[0].code;

      // 1. FIRST PERPLEXITY CALL: Generate initial activities with essential data
        const query = this.buildActivityQuery({
            destination,
            days: Math.ceil((new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24)),
            budget: params.budgetLimit,
            currency: params.currency,
            preferences: params.preferences,
            startDate: params.startDate,
            endDate: params.endDate
        });

      logger.info('[Perplexity] Making first API call for activity generation');
      const response = await this.chat(query);
      
      if (!response.activities || response.activities.length === 0) {
        logger.error('[Perplexity] No activities generated from initial request');
        return {
          success: false,
          error: 'Failed to generate activities',
          activities: [],
          metadata: {
            originalCount: 0,
            finalCount: 0,
            enrichedCount: 0,
            daysPlanned: params.days,
                    destination
          }
        };
      }

      // Add default durations and process activities without additional Perplexity calls
      const processedActivities = response.activities.map(activity => ({
        ...activity,
        duration: activity.duration || 120,
        timeSlot: activity.timeSlot || this.determineTimeSlot(activity),
        category: activity.category || this.determineCategory(activity)
      }));

      // 2. Enrich with Viator details (no Perplexity call)
        const viatorService = new ViatorService();
      const enrichedActivities = await Promise.all(processedActivities.map(async (activity) => {
        try {
                const searchResults = await viatorService.searchActivity(
                    activity.name,
                    destinationId,
                    params.startDate,
                    params.endDate
                );

                if (!searchResults || searchResults.length === 0) {
                    return activity;
                }

                const bestMatch = searchResults[0];
                const enriched = await viatorService.enrichActivityDetails({
                    ...bestMatch,
                    name: activity.name,
                    timeSlot: activity.timeSlot,
                    dayNumber: activity.dayNumber
                });
          
        return {
            ...activity,
                    ...enriched,
                    name: activity.name,
                    timeSlot: activity.timeSlot,
                    dayNumber: activity.dayNumber,
                    enrichmentStatus: enriched.bookingDetails?.productCode ? 'success' : 'not_found'
          };
        } catch (error) {
          logger.warn('[Perplexity] Failed to enrich activity with Viator details', {
              name: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
                return activity;
        }
      }));

        // Log enrichment statistics
        const enrichmentStats = {
            totalActivities: enrichedActivities.length,
            enrichedCount: enrichedActivities.filter(a => a.enrichmentStatus === 'success').length,
            notFoundCount: enrichedActivities.filter(a => a.enrichmentStatus === 'not_found').length,
            withProductCodes: enrichedActivities.filter(a => a.bookingDetails?.productCode).length
        };

      logger.info('[Perplexity] Successfully enriched activities:', enrichmentStats);

      // 3. SECOND PERPLEXITY CALL: Optimize schedule
      logger.info('[Perplexity] Making second API call for schedule optimization');
      const scheduleQuery = this.buildScheduleOptimizationQuery({
        activities: enrichedActivities,
        days: Math.ceil((new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24)),
        preferences: params.preferences,
        startDate: params.startDate
      });

      const scheduleResponse = await this.chat(scheduleQuery);

      return {
        success: true,
        activities: enrichedActivities,
        schedule: scheduleResponse.schedule || [],
        metadata: {
          originalCount: response.activities.length,
          finalCount: enrichedActivities.length,
                enrichedCount: enrichmentStats.enrichedCount,
                daysPlanned: Math.ceil((new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24)),
                destination,
                enrichmentStats
        }
      };
    } catch (error) {
      logger.error('[Perplexity] Failed to generate activities', error);
      throw error;
    }
  }

  private determineTimeSlot(activity: any): string {
    if (activity.startTime) {
      const hour = parseInt(activity.startTime.split(':')[0]);
      if (hour >= 17) return 'evening';
      if (hour >= 12) return 'afternoon';
      return 'morning';
    }
    return 'morning';
  }

  private determineCategory(activity: any): string {
    const categories = {
      'Cultural & Historical': ['museum', 'history', 'art', 'palace', 'church'],
      'Food & Entertainment': ['food', 'restaurant', 'dining', 'show', 'entertainment'],
      'Nature & Adventure': ['park', 'garden', 'outdoor', 'adventure', 'tour'],
      'Lifestyle & Local': ['shopping', 'market', 'local', 'workshop']
    };

    const description = activity.description?.toLowerCase() || '';
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => description.includes(keyword))) {
        return category;
      }
    }
    
    return 'Lifestyle & Local';
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
              content: `You are a travel activity expert specializing in Viator bookings.

CRITICAL RULES:
1. Return ONLY valid JSON - NO explanatory text
2. ONLY suggest activities that exist on Viator.com with REAL product codes
3. Ensure activities in the same day are geographically close
4. Account for travel time between locations
5. Maintain category distribution (25% each)
6. ALWAYS include accurate price information for each activity
7. NEVER return activities without valid prices

TIME SLOTS:
- Morning (9:00-13:00): Cultural & Nature activities
- Afternoon (14:00-18:00): Adventure & Shopping activities
- Evening (19:00-23:00): Food & Entertainment activities

REQUIRED STRUCTURE:
{
  "day1": {
    "theme": "Day theme based on main activities",
    "morning": [{
      "activity": "EXACT Viator activity name",
      "productCode": "EXACT Viator product code",
      "time": "EXACT available time slot from Viator",
      "duration": "Duration in hours (number)",
      "location": "Specific neighborhood/area",
      "transportation": "How to get there + address",
      "price": {
        "amount": number,
        "currency": string
      },
      "category": "Cultural & Historical|Nature & Adventure|Food & Entertainment|Lifestyle & Local",
      "tip": "Activity-specific tips and highlights",
      "bookingDetails": {
        "provider": "Viator",
        "cancellationPolicy": "EXACT policy",
        "instantConfirmation": boolean,
        "mobileTicket": boolean,
        "price": {
          "amount": number,
          "currency": string
        }
      }
    }],
    "afternoon": [/* Same structure as morning */],
    "evening": [/* Same structure as morning */]
  }
}

IMPORTANT:
- Each activity MUST have a valid price.amount > 0
- All prices must be accurate and current from Viator
- Include REAL Viator product codes and prices
- Do not generate placeholder or estimated prices`
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

      // Log the raw response for debugging
      logger.debug('[Perplexity] Raw API response:', {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
        responsePreview: JSON.stringify(response.data).substring(0, 200)
      });

      // Validate response structure
      if (!response.data) {
        logger.error('[Perplexity] Empty response data');
        return { activities: [] };
      }

      // Extract content from response
      const rawContent = response.data.choices?.[0]?.message?.content;
      if (!rawContent) {
        logger.error('[Perplexity] No content in response:', {
          choices: response.data.choices,
          firstChoice: response.data.choices?.[0],
          message: response.data.choices?.[0]?.message
        });
        return { activities: [] };
      }

      logger.debug('[Perplexity] Raw content:', { 
        contentLength: rawContent.length,
        preview: rawContent.substring(0, 200)
      });

      // Clean and parse the content
      let cleanedContent = this.cleanJsonString(rawContent);
      let parsedContent: any;

      try {
        parsedContent = JSON.parse(cleanedContent);
      } catch (parseError) {
        logger.error('[Activity Generation] JSON parsing failed:', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error',
          cleanedContent: cleanedContent.substring(0, 200) + '...'
        });
        return { activities: [] };
      }

      // Transform the daily itinerary format into activities array
      const transformedContent = this.transformDailyItineraryToActivities(parsedContent);

      // Validate the transformed content
      if (!transformedContent.activities || !Array.isArray(transformedContent.activities)) {
        logger.error('[Activity Generation] Invalid transformed structure:', {
          transformedContent: JSON.stringify(transformedContent).substring(0, 200) + '...'
        });
        return { activities: [] };
      }

      if (transformedContent.activities.length === 0) {
        logger.warn('[Activity Generation] No activities after transformation');
        return { activities: [] };
      }

      // Validate price information
      const activitiesWithPrice = transformedContent.activities.filter(a => a.price?.amount > 0);
      if (activitiesWithPrice.length === 0) {
        logger.error('[Activity Generation] No activities with valid prices');
        return { activities: [] };
      }

      // Log successful transformation
      logger.info('[Activity Generation] Successfully transformed response', {
        activityCount: transformedContent.activities.length,
        activitiesWithPrice: activitiesWithPrice.length,
        averagePrice: activitiesWithPrice.reduce((sum, a) => sum + (a.price?.amount || 0), 0) / activitiesWithPrice.length
      });

      return transformedContent;
    } catch (error) {
      logger.error('[Perplexity] Error in chat:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        apiCallCount: this.perplexityApiCallCount
      });
      
      // Return empty activities array instead of throwing
      return { activities: [] };
    }
  }

  private cleanJsonString(str: string): string {
    try {
      // First remove markdown code blocks if present
      let cleaned = str.replace(/```json\n?|\n?```/g, '');
      
      // Remove any comments (both single line and multi-line)
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      
      // Handle non-numeric values
      cleaned = cleaned.replace(/"amount"\s*:\s*"?varies"?/g, '"amount": 0');
      cleaned = cleaned.replace(/"price"\s*:\s*"?varies"?/g, '"price": 0');
      cleaned = cleaned.replace(/:\s*"?(varies|tbd|unknown|flexible)"?(\s*[,}])/gi, ': 0$2');
      cleaned = cleaned.replace(/"duration"\s*:\s*"?Flexible"?/gi, '"duration": 0');
      cleaned = cleaned.replace(/"duration"\s*:\s*"?varies"?/gi, '"duration": 0');
      
      // Handle any remaining non-numeric values that should be numeric
      cleaned = cleaned.replace(/:\s*"?(unlimited|flexible|varies|tbd|unknown)"?(\s*[,}])/gi, ': 0$2');
      
      // Remove any trailing commas in objects and arrays
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
      
      // Remove any non-JSON content before and after the JSON structure
      const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No valid JSON structure found');
      }
      cleaned = jsonMatch[0];

      // Clean up any remaining whitespace and newlines
      cleaned = cleaned.trim();

      logger.debug('[JSON Cleaning] Cleaned JSON string:', {
        originalLength: str.length,
        cleanedLength: cleaned.length,
        sample: cleaned.substring(0, 100) + '...'
      });

      return cleaned;
    } catch (error) {
      logger.error('[JSON Cleaning] Error cleaning JSON string:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        originalString: str.substring(0, 100) + '...'
      });
      throw error;
    }
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
    logger.info('Starting activity balancing', {
      totalActivities: activities.length,
      days: params.days
    });

    // Group activities by day
    const activitiesByDay = activities.reduce((acc, activity) => {
      acc[activity.dayNumber] = acc[activity.dayNumber] || [];
      acc[activity.dayNumber].push(activity);
      return acc;
    }, {} as Record<number, Activity[]>);

    // Calculate minimum and maximum activities per time slot based on pace preference
    const activityLimits = {
      'relaxed': { min: 1, max: 2 },
      'moderate': { min: 1, max: 3 },
      'intensive': { min: 2, max: 3 }
    }[params.preferences.pacePreference] || { min: 1, max: 3 };

    const balancedActivities = Object.entries(activitiesByDay).flatMap(([day, dayActivities]) => {
      logger.info(`Processing day ${day}`, {
        dayNumber: day,
        activitiesCount: dayActivities.length
      });

      // Score activities based on preferences
      const scoredActivities = dayActivities.map(activity => {
        let score = 0;
        
        // Base score for all activities
        score += 1;
        
        // Score based on matching interests
        params.preferences.interests.forEach(interest => {
          if (activity.commentary?.toLowerCase().includes(interest.toLowerCase()) ||
              activity.description?.toLowerCase().includes(interest.toLowerCase())) {
            score += 0.5;
          }
        });

        // Score based on travel style match
        if (activity.tier?.toLowerCase() === params.preferences.travelStyle.toLowerCase()) {
          score += 0.5;
        }

        // Score based on rating
        if (activity.rating && activity.rating >= 4.0) {
          score += 1;
        }

        return { ...activity, preferenceScore: score };
      });

      // Group activities by time slot
      const timeSlots = ['morning', 'afternoon', 'evening'] as const;
      const activitiesByTimeSlot = new Map<typeof timeSlots[number], Activity[]>();
      
      // Initialize time slots
      timeSlots.forEach(slot => {
        activitiesByTimeSlot.set(slot, []);
      });

      // First pass: Group activities by time slot
      scoredActivities.forEach(activity => {
        const slot = activity.timeSlot as typeof timeSlots[number];
        activitiesByTimeSlot.get(slot)?.push(activity);
      });

      // Second pass: Balance activities across time slots
      const balancedTimeSlots = new Map<typeof timeSlots[number], Activity[]>();
      
      timeSlots.forEach(slot => {
        const slotActivities = activitiesByTimeSlot.get(slot) || [];
        
        // Sort activities by score
        const sortedActivities = slotActivities.sort((a, b) => {
            const scoreCompare = (b.preferenceScore || 0) - (a.preferenceScore || 0);
            if (scoreCompare !== 0) return scoreCompare;
            return (b.rating || 0) - (a.rating || 0);
          });

        // Keep top N activities based on limits
        const selectedActivities = sortedActivities.slice(0, activityLimits.max);
        
        // If we don't have minimum activities, try to borrow from other slots
        if (selectedActivities.length < activityLimits.min) {
          const otherSlots = timeSlots.filter(t => t !== slot);
          for (const otherSlot of otherSlots) {
            const otherActivities = activitiesByTimeSlot.get(otherSlot) || [];
            if (otherActivities.length > activityLimits.min) {
              const activityToMove = otherActivities[otherActivities.length - 1];
              activityToMove.timeSlot = slot;
              selectedActivities.push(activityToMove);
              if (selectedActivities.length >= activityLimits.min) break;
            }
          }
        }

        // Add date to each activity
        const activitiesWithDate = selectedActivities.map(activity => ({
          ...activity,
          date: params.startDate,
          dayNumber: parseInt(day)
        }));

        balancedTimeSlots.set(slot, activitiesWithDate);
      });

      // Combine all balanced activities for this day
      return Array.from(balancedTimeSlots.values()).flat();
    });

    logger.info('Completed activity balancing', {
      originalCount: activities.length,
      finalCount: balancedActivities.length,
      daysProcessed: Object.keys(activitiesByDay).length,
      averagePerDay: balancedActivities.length / Object.keys(activitiesByDay).length
    });

    return balancedActivities;
  }

  private getMatchedPreferences(activity: Activity, preferences: any): string[] {
    const matchedPrefs: string[] = [];
    
    // Helper function to check if text contains any interest
    const containsInterest = (text: string, interests: string[]): boolean => {
      if (!text) return false;
      const normalizedText = text.toLowerCase();
      return interests.some(interest => {
        const normalizedInterest = interest.toLowerCase();
        // Check for exact match or related terms
        return normalizedText.includes(normalizedInterest) ||
          (normalizedInterest === 'culture' && (
            normalizedText.includes('museum') ||
            normalizedText.includes('historical') ||
            normalizedText.includes('heritage') ||
            normalizedText.includes('art') ||
            normalizedText.includes('palace') ||
            normalizedText.includes('monument') ||
            normalizedText.includes('landmark')
          )) ||
          (normalizedInterest === 'food & wine' && (
            normalizedText.includes('culinary') ||
            normalizedText.includes('gastronomy') ||
            normalizedText.includes('wine') ||
            normalizedText.includes('tasting') ||
            normalizedText.includes('restaurant') ||
            normalizedText.includes('cooking') ||
            normalizedText.includes('food tour') ||
            normalizedText.includes('dining')
          ));
      });
    };

    // Check interests in various activity fields
    if (preferences.interests) {
      const fieldsToCheck = [
        activity.name,
        activity.description,
        activity.category,
        activity.highlights?.join(' '),
        activity.bookingDetails?.description
      ].filter(Boolean);

    preferences.interests.forEach(interest => {
        if (fieldsToCheck.some(field => containsInterest(field, [interest]))) {
        matchedPrefs.push(interest);
      }
    });
    }

    // Check travel style match
    if (preferences.travelStyle) {
      const price = activity.price?.amount || 0;
      const tier = price <= 50 ? 'budget' : price <= 150 ? 'medium' : 'premium';
      if (tier === preferences.travelStyle.toLowerCase()) {
      matchedPrefs.push(`${preferences.travelStyle} travel style`);
      }
    }

    // Check accessibility needs
    if (preferences.accessibility) {
    preferences.accessibility.forEach(need => {
        if (activity.bookingDetails?.accessibility?.toLowerCase().includes(need.toLowerCase())) {
        matchedPrefs.push(need);
      }
    });
    }

    // Check dietary restrictions
    if (preferences.dietaryRestrictions) {
    preferences.dietaryRestrictions.forEach(restriction => {
      if (activity.description?.toLowerCase().includes(restriction.toLowerCase())) {
        matchedPrefs.push(restriction);
      }
    });
    }

    // Log preference matching details
    logger.debug('[Preference Matching]', {
      activityName: activity.name,
      matchedPreferences: matchedPrefs,
      checkedFields: [
        activity.name,
        activity.description,
        activity.category,
        activity.highlights?.join(' '),
        activity.bookingDetails?.description
      ].filter(Boolean)
    });

    return [...new Set(matchedPrefs)]; // Remove duplicates
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
      const theme = this.getDayTheme(dayActivities);

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

  private getDayTheme(activities: Activity[]): string {
    const categories = activities.map(a => a.category);
    const mainCategory = this.getMostFrequentCategory(categories);
    return `${mainCategory} Exploration Day`;
  }

  private getMainArea(activities: Activity[]): string {
    return activities.length > 0 ? activities[0].location || 'Various locations' : 'Various locations';
  }

  private getDayHighlightText(activities: Activity[]): string {
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

  async enrichActivity(activity: Activity, params: GenerateActivitiesParams, retryCount = 0): Promise<Activity | null> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

    try {
        logger.info('[Enrichment] Starting activity enrichment:', {
            name: activity.name,
            timeSlot: activity.timeSlot,
            dayNumber: activity.dayNumber
        });

        // Get Viator details first to validate availability
        const viatorService = new ViatorService();
        const date = this.getDateForActivity(activity.dayNumber, params.startDate);
        
        // Validate time slot and get real availability
        const availability = await viatorService.validateTimeSlot(activity, date);
        
        if (!availability.isAvailable) {
            logger.warn('[Enrichment] Activity not available:', {
                name: activity.name,
                date,
                reason: availability.realTimeVerification.reason
        });
        return null;
      }

        // Update time slot based on actual availability
        const updatedTimeSlot = availability.verifiedTimeSlot;
        const exactStartTime = availability.exactStartTime;

        // Get enriched details from Perplexity
        const query = this.buildEnrichmentQuery(activity, {
            ...params,
            timeSlot: updatedTimeSlot,
            exactStartTime,
            availability
        });

        const enriched = await this.getEnrichedDetails(query, params.preferences, date);
        
        if (!enriched || !enriched.activities?.[0]) {
            throw new Error('Failed to get enriched details');
        }

        const enrichedActivity = enriched.activities[0];

        // Calculate preference score
        const preferenceScore = this.calculatePreferenceScore(enrichedActivity, params.preferences);
        
          return {
            ...activity,
            ...enrichedActivity,
            timeSlot: updatedTimeSlot,
            exactStartTime,
            availability,
            preferenceScore,
            scoringDetails: {
                matchedPreferences: this.getMatchedPreferences(enrichedActivity, params.preferences),
                score: preferenceScore,
                timeSlotScore: this.calculateTimeSlotScore(updatedTimeSlot, activity.timeSlot),
                availabilityScore: availability.realTimeVerification.verified ? 1 : 0
        }
      };
    } catch (error) {
        logger.error('[Enrichment] Error enriching activity:', {
        name: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryCount
      });

      if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return this.enrichActivity(activity, params, retryCount + 1);
      }

        return null;
    }
  }

  private calculateTimeSlotScore(actual: string, requested: string): number {
    if (actual === requested) return 1;
    
    const slots = ['morning', 'afternoon', 'evening'];
    const actualIndex = slots.indexOf(actual);
    const requestedIndex = slots.indexOf(requested);
    
    // Calculate distance between slots (0 to 2)
    const distance = Math.abs(actualIndex - requestedIndex);
    
    // Convert to score (1 to 0)
    return 1 - (distance / 2);
  }

  private calculatePreferenceScore(activity: Activity, preferences: any): number {
    let score = 2; // Base score increased to 2
    
    // Get matched preferences
    const matchedPrefs = this.getMatchedPreferences(activity, preferences);
    activity.matchedPreferences = matchedPrefs;

    // Add points for each matched preference (up to 5 points)
    const preferencePoints = Math.min(matchedPrefs.length * 1.5, 5);
    score += preferencePoints;

    // Add points for time slot match (3 points)
    const categoryTimeSlot = this.getPreferredTimeSlot(activity.category);
    if (activity.timeSlot === categoryTimeSlot) {
      score += 3;
    }

    // Add rating and review bonus (up to 2 points)
    if (activity.rating && activity.numberOfReviews) {
      const ratingBonus = Math.min((activity.rating - 3) * 0.5, 1); // Up to 1 point for rating
      const reviewBonus = Math.min(activity.numberOfReviews / 100, 1); // Up to 1 point for reviews
      score += ratingBonus + reviewBonus;
    }

    // Add geographic proximity bonus (2 points)
    // This will be handled by the schedule optimization

    // Add availability bonus (1 point)
    if (activity.availability?.isAvailable) {
      score += 1;
    }

    // Log the scoring details
    logger.debug('[Activity Scoring]', {
      activityName: activity.name,
      baseScore: 2,
      preferencePoints,
      timeSlotMatch: activity.timeSlot === categoryTimeSlot ? 3 : 0,
      ratingBonus: activity.rating ? Math.min((activity.rating - 3) * 0.5, 1) : 0,
      reviewBonus: activity.numberOfReviews ? Math.min(activity.numberOfReviews / 100, 1) : 0,
      availabilityBonus: activity.availability?.isAvailable ? 1 : 0,
      totalScore: score,
      matchedPreferences: matchedPrefs
    });

    activity.preferenceScore = score;
    return score;
  }

  private matchesTravelStyle(category: string, style: string): boolean {
    const styleCategories: Record<string, string[]> = {
        'luxury': ['Premium Tours', 'Fine Dining', 'Cultural & Historical'],
        'active': ['Nature & Adventure', 'Sports & Recreation', 'Walking Tours'],
        'budget': ['Free Tours', 'Local Markets', 'Public Transport'],
        'family': ['Family Friendly', 'Theme Parks', 'Educational'],
        'romantic': ['Sunset Tours', 'Wine & Dining', 'Cruises']
    };

    return styleCategories[style]?.some(cat => 
        category.toLowerCase().includes(cat.toLowerCase())
    ) || false;
  }

  private buildActivityQuery(params: {
    destination: string;
    days: number;
    budget: number;
    currency: string;
    preferences: GenerateActivitiesParams['preferences'];
    startDate: string;
    endDate: string;
  }): string {
    const { destination, days, budget, currency, preferences, startDate, endDate } = params;
    
    // Define accessibility requirements string
    const accessibilityRequirements = preferences.accessibility.length > 0 
      ? `\nACCESSIBILITY REQUIREMENTS: Activities MUST be suitable for travelers with ${preferences.accessibility.join(', ')} needs. Only suggest locations with accessible facilities, transportation, and services.`
      : '';
    
    // Define dietary restrictions string
    const dietaryRestrictions = preferences.dietaryRestrictions.length > 0
      ? `\nDIETARY RESTRICTIONS: All food-related activities MUST offer options for ${preferences.dietaryRestrictions.join(', ')} diets. Verify restaurants/food tours can accommodate these requirements.`
      : '';
    
    // Build pace requirements based on pacePreference
    const paceRequirements = (() => {
      switch(preferences.pacePreference) {
        case 'relaxed':
          return 'Activities should be leisurely paced with no more than 2 activities per day and at least 2-hour breaks between activities. Maximum activity duration: 3 hours.';
        case 'moderate':
          return 'Balance active and relaxation periods with 2-3 activities per day and 1-hour breaks between activities. Maximum activity duration: 4 hours.';
        case 'intense':
          return 'Pack in more experiences with 3-4 activities per day with 30-minute breaks between activities. Maximum activity duration: 5 hours.';
        default:
          return 'Balance active and relaxation periods with 2-3 activities per day and 1-hour breaks between activities.';
      }
    })();
    
    // Build style requirements based on travelStyle
    const styleRequirements = (() => {
      switch(preferences.travelStyle) {
        case 'luxury':
          return 'Focus on premium, high-end experiences, 4-5 star accommodations, private tours, and fine dining.';
        case 'casual':
          return 'Focus on authentic, local experiences, small group tours, neighborhoods off the tourist path, and casual dining.';
        case 'authentic':
          return 'Emphasize activities with local cultural immersion, traditional experiences, smaller vendors, and neighborhood exploration.';
        case 'budget':
          return 'Prioritize free/low-cost activities, affordable dining options, and good value experiences.';
        default:
          return 'Include a mix of premium and affordable options with varied experiences.';
      }
    })();
    
    return `Generate an activity plan for a ${days}-day trip to ${destination} from ${startDate} to ${endDate} with a budget of ${budget} ${currency} for the EXACT INTERESTS: ${preferences.interests.join(', ')}.

KEY REQUIREMENTS:
- ${styleRequirements}
- ${paceRequirements}
- Each activity must include timeSlot (morning/afternoon/evening), duration, price, category.
- Activities must be REAL attractions available in ${destination} with actual pricing.
- Focus EXCLUSIVELY on these interests: ${preferences.interests.join(', ')}
- Ensure variety of activity types with appropriate time slots.${accessibilityRequirements}${dietaryRestrictions}

EXPECTED FORMAT:
{
  "activities": [
    {
      "name": "Activity name",
      "description": "Detailed description",
      "duration": 120,
      "price": {"amount": 50, "currency": "${currency}"},
      "category": "One of: ${preferences.interests.join(' | ')}",
      "location": "Specific area/neighborhood in ${destination}",
      "timeSlot": "morning|afternoon|evening",
      "dayNumber": 1,
      "tier": "budget|medium|premium"
    }
  ]
}

IMPORTANT:
- Do NOT include activities that don't match the specified interests
- Activities MUST align with the ${preferences.travelStyle} travel style
- Respect the ${preferences.pacePreference} pace preference
- Only return valid JSON - no commentary or explanations`;
  }

  private transformDailyItineraryToActivities(content: any): any {
    try {
      const activities: any[] = [];
      const seenActivities = new Set<string>();
      const schedule: any[] = [];
      
      Object.keys(content).forEach(key => {
        if (key.startsWith('day')) {
          const dayNumber = parseInt(key.replace('day', ''));
          const dayData = content[key];
          const dayActivities: any[] = [];
          
          ['morning', 'afternoon', 'evening'].forEach(timeSlot => {
            if (dayData[timeSlot] && Array.isArray(dayData[timeSlot])) {
              dayData[timeSlot].forEach((activity: any) => {
                try {
                  // Create a unique key for deduplication
                  const activityKey = `${activity.activity || activity.name}-${dayNumber}-${timeSlot}`;
                  if (seenActivities.has(activityKey)) {
                    return; // Skip duplicate activities
                  }
                  seenActivities.add(activityKey);

                  // Extract price with proper validation
                  let price = 0;
                  if (typeof activity.price === 'object' && activity.price !== null) {
                    price = activity.price.amount || 0;
                  } else if (typeof activity.price === 'number') {
                    price = activity.price;
                  } else if (typeof activity.price === 'string') {
                    price = activity.price.toLowerCase() === 'free' ? 0 : parseFloat(activity.price) || 0;
                  }

                  // Determine tier based on price
                  const tier = price <= 30 ? 'budget' : price <= 100 ? 'medium' : 'premium';

                  const transformedActivity = {
                    activity: activity.activity || activity.name,
                    name: activity.activity || activity.name,
                    description: activity.description || '',
                    duration: activity.duration || 2,
                    category: activity.category || 'Sightseeing',
                    location: activity.location || 'City Center',
                    price: {
                      amount: price,
                      currency: activity.price?.currency || 'USD'
                    },
                    timeSlot,
                    dayNumber,
                    tier,
                    bookingDetails: {
                      provider: 'Viator',
                      productCode: activity.productCode || '',
                      referenceUrl: activity.referenceUrl || '',
                      instantConfirmation: false
                    },
                    availability: {
                      isAvailable: true,
                      availableTimeSlots: [activity.startTime || '09:00'],
                      exactStartTimes: [activity.startTime || '09:00'],
                      realTimeVerification: {
                        verified: false,
                        lastChecked: new Date().toISOString()
                      }
                    }
                  };

                  activities.push(transformedActivity);
                  dayActivities.push(transformedActivity);

                  logger.debug('[Activity Transform] Successfully transformed activity:', {
                    name: activity.activity || activity.name,
                    price,
                    timeSlot,
                    dayNumber,
                    tier
                  });
                } catch (activityError) {
                  logger.warn('[Activity Transform] Failed to transform activity:', {
                    error: activityError instanceof Error ? activityError.message : 'Unknown error',
                    activity: JSON.stringify(activity).substring(0, 200)
                  });
                }
              });
            }
          });

          // Add the day's schedule
          if (dayActivities.length > 0) {
            schedule.push({
              dayNumber,
              theme: dayData.theme || 'Mixed Activities',
              mainArea: dayData.mainArea || 'City Center',
              activities: dayActivities.sort((a, b) => {
                const timeOrder = { morning: 1, afternoon: 2, evening: 3 };
                return timeOrder[a.timeSlot] - timeOrder[b.timeSlot];
              })
            });
          }
        }
      });

      logger.info('[Activity Transform] Completed transformation:', {
        totalActivities: activities.length,
        activitiesWithPrice: activities.filter(a => a.price?.amount > 0).length,
        averagePrice: activities.reduce((sum, a) => sum + (a.price?.amount || 0), 0) / activities.length,
        priceDistribution: activities.reduce((acc, a) => {
          const priceRange = a.price?.amount ? 
            (a.price.amount <= 30 ? 'budget' : 
             a.price.amount <= 100 ? 'medium' : 
             'premium') : 'unknown';
          acc[priceRange] = (acc[priceRange] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        daysScheduled: schedule.length
      });

      return {
        activities,
        schedule: schedule.sort((a, b) => a.dayNumber - b.dayNumber)
      };
    } catch (error) {
      logger.error('[Activity Transform] Failed to transform activities:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        content: JSON.stringify(content).substring(0, 200)
      });
      return { activities: [], schedule: [] };
    }
  }

  private buildEnrichmentQuery(activity: any, params: any): string {
    return `Analyze this activity for ${params.destination}:
Activity: ${activity.name}
Category: ${activity.category}
Location: ${activity.location}

Consider user preferences:
- Travel Style: ${params.preferences.travelStyle}
- Pace: ${params.preferences.pacePreference}
- Interests: ${params.preferences.interests.join(', ')}
${params.preferences.accessibility.length ? `- Accessibility: ${params.preferences.accessibility.join(', ')}` : ''}
${params.preferences.dietaryRestrictions.length ? `- Dietary: ${params.preferences.dietaryRestrictions.join(', ')}` : ''}

Provide enriched details including:
1. Detailed description
2. Why it's recommended for this traveler
3. How it fits into the day's flow
4. Local insights and tips
5. Best time to visit
6. Transportation options
7. Photo opportunities`;
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

      // Group activities by day
      const schedule = Array.from({ length: days }, (_, i) => {
        const dayNumber = i + 1;
        const dayActivities = activities.filter(a => a.dayNumber === dayNumber);
        return {
          dayNumber,
          theme: this.getDayTheme(dayActivities),
          mainArea: this.getMainArea(dayActivities),
          activities: dayActivities.sort((a, b) => {
            const timeOrder = { morning: 1, afternoon: 2, evening: 3 };
            return timeOrder[a.timeSlot] - timeOrder[b.timeSlot];
          })
        };
      });

      // Log schedule details
      logger.info('Schedule optimization complete:', {
        totalDays: days,
        daysWithActivities: schedule.filter(day => day.activities.length > 0).length,
        activitiesPerDay: schedule.map(day => ({
          dayNumber: day.dayNumber,
          count: day.activities.length,
          timeSlots: day.activities.reduce((acc, a) => {
            acc[a.timeSlot] = (acc[a.timeSlot] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
          }))
        });

      // Generate daily highlights
      const dailyHighlights = schedule.map(day => ({
            dayNumber: day.dayNumber,
        theme: day.theme,
        mainArea: day.mainArea,
        summary: this.getDayHighlightText(day.activities),
        activities: day.activities
      }));

      // Generate trip overview
      const tripOverview = `${days}-day trip to ${destination} featuring ${activities.length} activities across ${schedule.filter(day => day.activities.length > 0).length} days.`;

      // Generate activity fit notes
      const activityFitNotes = activities.map(activity => ({
        name: activity.name,
        dayNumber: activity.dayNumber,
        timeSlot: activity.timeSlot,
        notes: `Scheduled for ${activity.timeSlot} on Day ${activity.dayNumber}. ${activity.availability?.realTimeVerification?.verified ? 'Real-time availability verified.' : 'Availability to be confirmed.'}`
      }));

            return {
        schedule,
        dailyHighlights,
        tripOverview,
        activityFitNotes,
        statistics: {
          totalActivities: activities.length,
          scheduledActivities: activities.filter(a => a.dayNumber).length,
          unscheduledActivities: activities.filter(a => !a.dayNumber).length,
          daysOptimized: days
        }
      };
    } catch (error) {
      logger.error('Failed to optimize schedule:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        activities: activities.length,
        days
      });
        return {
        schedule: [],
        dailyHighlights: [],
        tripOverview: '',
        activityFitNotes: [],
        statistics: {
          totalActivities: 0,
          scheduledActivities: 0,
          unscheduledActivities: 0,
          daysOptimized: 0
        }
      };
    }
  }

  private generateAvailabilityConsiderations(schedule: any[]): string {
    const considerations: string[] = [];
    
    schedule.forEach(day => {
      const dayActivities = day.activities || [];
      const unavailableActivities = dayActivities.filter(a => !a.availability?.isAvailable);
      const limitedAvailability = dayActivities.filter(a => 
        a.availability?.isAvailable && 
        a.availability.exactStartTimes?.length === 1
      );
      
      if (unavailableActivities.length > 0) {
        considerations.push(`Day ${day.dayNumber}: ${unavailableActivities.map(a => a.name).join(', ')} require alternative dates or times.`);
      }
      
      if (limitedAvailability.length > 0) {
        considerations.push(`Day ${day.dayNumber}: ${limitedAvailability.map(a => a.name).join(', ')} have limited time slots available.`);
      }
    });
    
    return considerations.join('\n') || 'All activities have good availability for the selected dates.';
  }

  private determineStartTime(scheduledActivity: any, originalActivity: any): string {
    // If we have exact start times from availability data, use the appropriate one
    if (originalActivity.availability?.timesByCategory) {
        const timeSlot = scheduledActivity.timeSlot || originalActivity.timeSlot;
        const availableTimes = originalActivity.availability.timesByCategory[timeSlot] || [];
        
        if (availableTimes.length > 0) {
            // Sort times and return the earliest one for the time slot
            return availableTimes.sort()[0];
        }
    }

    // If we have exact start times but not categorized
    if (originalActivity.availability?.exactStartTimes?.length > 0) {
        return originalActivity.availability.exactStartTimes[0];
    }

    // If we have real-time verification data
    if (originalActivity.availability?.realTimeVerification?.exactStartTimes?.length > 0) {
        return originalActivity.availability.realTimeVerification.exactStartTimes[0];
    }

    // If no real availability data found, log warning and throw error
    logger.warn('[Schedule] No real availability times found for activity', {
        activityName: originalActivity.name,
        timeSlot: scheduledActivity.timeSlot,
        availability: originalActivity.availability
    });
    
    throw new Error(`No real availability times found for activity: ${originalActivity.name}`);
  }

  private generateAvailabilityNotes(activity: any): string {
    if (!activity.availability) {
      return 'Standard operating hours';
    }
    
    const notes = [];
    
    if (activity.availability.realTimeVerification?.verified) {
      notes.push('Real-time availability verified');
      if (activity.availability.realTimeVerification.exactStartTimes?.length > 0) {
        notes.push(`Available start times: ${activity.availability.realTimeVerification.exactStartTimes.join(', ')}`);
      }
    }
    
    if (activity.availability.operatingHours) {
      notes.push(`Operating hours: ${activity.availability.operatingHours}`);
    }
    
    if (activity.availability.timesByCategory) {
      const slots = Object.entries(activity.availability.timesByCategory)
        .filter(([_, times]) => times.length > 0)
        .map(([slot, times]) => `${slot}: ${times.join(', ')}`);
      
      if (slots.length > 0) {
        notes.push(`Available time slots: ${slots.join(' | ')}`);
      }
    }
    
    return notes.join('. ') || 'Standard operating hours';
  }

  private getDefaultStartTime(timeSlot: string): string {
    switch (timeSlot) {
        case 'morning': return '09:00';
        case 'afternoon': return '14:00';
        case 'evening': return '19:00';
        default: return '09:00';
    }
  }

  private getTimeSlotCategory(time: string): string {
    if (time === 'morning') return 'morning';
    if (time === 'afternoon') return 'afternoon';
    if (time === 'evening') return 'evening';
    return 'unknown';
  }

  private getPreferredTimeSlot(category: string): string {
    const preferredSlots: Record<string, string[]> = {
      'Cultural & Historical': ['morning'],
      'Nature & Adventure': ['morning'],
      'Food & Entertainment': ['evening'],
      'Lifestyle & Local': ['morning']
    };

    return preferredSlots[category]?.[0] || 'morning';
  }

  private buildScheduleOptimizationQuery(params: {
    activities: any[];
    days: number;
    preferences: any;
    startDate: string;
  }): string {
    const { activities, days, preferences, startDate } = params;
    
    // Create date strings for each day of the trip
    const dates = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }
    
    // Define accessibility requirements
    const accessibilityRequirements = preferences.accessibility.length > 0 
      ? `\nACCESSIBILITY REQUIREMENTS:
- Ensure daily routes are accessible for travelers with ${preferences.accessibility.join(', ')} needs
- Plan breaks at accessible facilities
- Schedule activities near accessible transportation
- Allow extra time between activities for mobility considerations
- Group activities in the same area on the same day to minimize travel`
      : '';
    
    // Define dietary requirements
    const dietaryRequirements = preferences.dietaryRestrictions.length > 0
      ? `\nDIETARY REQUIREMENTS:
- Schedule meals at restaurants offering ${preferences.dietaryRestrictions.join(', ')} options
- Include meal breaks with appropriate dining options for dietary needs
- Ensure food tours/experiences can accommodate these restrictions: ${preferences.dietaryRestrictions.join(', ')}`
      : '';
    
    // Define pace requirements
    const paceRequirements = (() => {
      switch(preferences.pacePreference) {
        case 'relaxed':
          return 'Schedule maximum 2 activities per day with at least 2-hour breaks between them. Start days after 9:00 AM and end before 8:00 PM.';
        case 'moderate':
          return 'Schedule 2-3 activities per day with 1-hour breaks between them. Balance active mornings with relaxed afternoons.';
        case 'intense':
          return 'Schedule up to 4 activities per day with 30-minute breaks. Maximize experiences while maintaining a sustainable pace.';
        default:
          return 'Balance activities with adequate rest periods, typically 2-3 activities per day.';
      }
    })();
    
    return `Optimize a ${days}-day schedule for a trip to Paris from ${startDate}. Create a daily plan that distributes these activities across ${days} days with dates: ${dates.join(', ')}.

ACTIVITIES TO SCHEDULE:
${JSON.stringify(activities.map(a => ({
  id: a.id || a.name,
  name: a.name,
  duration: a.duration,
  category: a.category,
  timeSlot: a.timeSlot,
  location: a.location
})))}

SCHEDULING REQUIREMENTS:
- Each day should have a theme based on its activities
- Respect preferred time slots when possible (morning/afternoon/evening)
- Avoid scheduling activities with overlapping times
- Allow sufficient travel time between locations
- ${paceRequirements}
- Prioritize activities matching user interests: ${preferences.interests.join(', ')}
- Ensure schedule reflects ${preferences.travelStyle} travel style${accessibilityRequirements}${dietaryRequirements}

RETURN FORMAT:
{
  "schedule": [
    {
      "dayNumber": 1,
      "date": "${dates[0]}",
      "theme": "Day theme based on activities",
      "mainArea": "Main area/neighborhood for the day",
      "commentary": "Brief description of the day's plan",
      "activities": [
        // Array of activity IDs in chronological order
      ],
      "breaks": {
        "morning": {"startTime": "10:30", "endTime": "11:00", "duration": 30, "suggestion": "Coffee break and light refreshments"},
        "lunch": {"startTime": "12:30", "endTime": "13:30", "duration": 60, "suggestion": "Lunch break at local restaurant"},
        "afternoon": {"startTime": "15:30", "endTime": "16:00", "duration": 30, "suggestion": "Rest and refreshment break"},
        "dinner": {"startTime": "18:30", "endTime": "20:00", "duration": 90, "suggestion": "Dinner at recommended restaurant"}
      },
      "logistics": {
        "transportSuggestions": ["Use public transportation between major attractions", "Consider taxi/ride-sharing for evening activities", "Walking is recommended for nearby locations"],
        "walkingDistances": ["Average walking distance between activities: 15-20 minutes", "Most attractions are within central tourist areas"],
        "timeEstimates": ["Allow 30 minutes for transportation between activities", "Plan to arrive 15 minutes early for guided tours", "Buffer time included for security checks at major attractions"]
      }
    }
    // Repeat for each day
  ],
  "statistics": {
    "totalScheduled": 5,
    "totalUnscheduled": 3,
    "scheduledByDay": [2, 1, 2]
  },
  "unscheduledActivities": [
    // IDs of activities that couldn't be scheduled
  ]
}`;
  }
}

// Export singleton instance
const perplexityClient = new PerplexityService();
export { perplexityClient }; 