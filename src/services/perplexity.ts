import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';
import { ACTIVITY_CATEGORIES, normalizeCategory, determineCategoryFromDescription, ActivityCategory } from '../constants/categories.js';
import { ViatorService } from './viator.js';

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

interface Activity {
  id?: string;
  name: string;
  description?: string;
  category: string;
  price?: number;
  currency?: string;
  duration?: number;
  rating?: number;
  numberOfReviews?: number;
  images?: string[];
  location?: string;
  address?: string;
  timeSlot?: string;
  dayNumber?: number;
  zone?: string;
  openingHours?: string;
  bookingInfo?: {
    productCode?: string;
    cancellationPolicy?: string;
    instantConfirmation?: boolean;
    mobileTicket?: boolean;
    languages?: string[];
  };
  highlights?: string[];
  commentary?: string;
  itineraryHighlight?: string;
  referenceUrl?: string;
  selected?: boolean;
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
    budgetLevel: 'budget' | 'medium' | 'premium';
    priorityFactors: {
      price: number;
      quality: number;
      popularity: number;
    };
    preferredActivities: {
      cultural: boolean;
      outdoor: boolean;
      entertainment: boolean;
      shopping: boolean;
      foodAndDrink: boolean;
    };
    timePreferences: {
      morningActivity: boolean;
      afternoonActivity: boolean;
      eveningActivity: boolean;
    };
    requirements: {
      wheelchairAccessible: boolean;
      familyFriendly: boolean;
      skipLines: boolean;
      guidedTours: boolean;
    };
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

function determinePriceTier(price: number): typeof PRICE_TIERS[number] {
  if (price <= 50) return 'budget';
  if (price <= 150) return 'medium';
  return 'premium';
}

function calculateDistribution(activities: Activity[]): CategoryDistribution {
  const distribution: CategoryDistribution = {};
  const totalActivities = activities.length;

  // Initialize distribution object with all categories and tiers
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
    if (!activity) return;

    const category = normalizeCategory(activity.category);
    if (!distribution[category]) {
      // If category not found, use default category
      distribution['Cultural & Historical'] = {
        count: 0,
        percentage: 0,
        byTier: {
          budget: 0,
          medium: 0,
          premium: 0
        }
      };
    }

    const tier = determinePriceTier(activity.price || 0);
    
    distribution[category].count++;
    distribution[category].byTier[tier]++;
    distribution[category].percentage = (distribution[category].count / totalActivities) * 100;
  });

  // Ensure all percentages are rounded to 2 decimal places
  Object.values(distribution).forEach(cat => {
    cat.percentage = Math.round(cat.percentage * 100) / 100;
  });

  return distribution;
}

interface ActivityScore {
  activity: Activity;
  score: number;
  scoreBreakdown: {
    rating: number;
    reviewCount: number;
    preferenceMatch: number;
    priceValue: number;
    categoryBalance: number;
  };
}

export class PerplexityService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly viatorClient: ViatorService;

  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || '';
    this.baseUrl = 'https://api.perplexity.ai/chat/completions';
    this.viatorClient = new ViatorService();
    
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
${preferences.pacePreference === 'relaxed' ? 
  '- Flexible timing with breaks between activities\n- Later starts in the morning' :
  preferences.pacePreference === 'intensive' ? 
  '- Efficient scheduling to maximize activities\n- Earlier starts to fit more in' :
  '- Balanced timing with reasonable breaks\n- Standard activity start times'}

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
          model: 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: 'You are a travel planning assistant. Return activity suggestions in JSON array format only. Each activity must include: name, description, duration (in hours), price (in USD), category, location, timeSlot (morning/afternoon/evening), dayNumber.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          temperature: 0.3,
          max_tokens: 4000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in Perplexity response');
      }

      logger.debug('[Activity Generation] Raw content received:', {
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });

      try {
        // First try direct JSON parsing
        let activities: Activity[];
        try {
          activities = JSON.parse(content);
        } catch (e) {
          // If direct parsing fails, try to extract JSON
          const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (!jsonMatch) {
            throw new Error('No valid JSON array found in response');
          }
          const jsonContent = jsonMatch[1] || jsonMatch[0];
          activities = JSON.parse(jsonContent.trim());
        }

        // Validate activities array
        if (!Array.isArray(activities)) {
          throw new Error('Parsed content is not an array');
        }

        // Validate each activity has required fields
        activities = activities.filter(activity => {
          return activity && 
                 typeof activity === 'object' && 
                 activity.name && 
                 activity.category &&
                 activity.timeSlot &&
                 activity.dayNumber;
        });

        if (activities.length === 0) {
          throw new Error('No valid activities found in response');
        }

        return activities;

      } catch (parseError) {
        logger.error('[Activity Generation] Parse error:', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error',
          content: content.substring(0, 500)
        });
        throw new Error('Failed to parse activities from response');
      }
    } catch (error) {
      logger.error('[Activity Generation] API error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  async generateActivities(params: GenerateActivitiesParams): Promise<any> {
    try {
      const requestId = Math.random().toString(36).substring(7);
      logger.info('[Activity Generation] Starting', {
        requestId,
        params
      });

      const activities = await this.makePerplexityRequests(this.buildActivityQuery(params));
      
      // Use this.balanceActivities instead of the standalone function
      const balancedActivities = this.balanceActivities(activities, params);
      
      logger.info('[Activity Generation] After balancing', {
        requestId,
        originalCount: activities.length,
        balancedCount: balancedActivities.length,
        balancedIds: balancedActivities.map(a => a.id)
      });

      // Enrich activities with Viator data first
      const enrichedActivities = [];
      for (const activity of balancedActivities) {
        try {
          const viatorData = await this.viatorClient.searchActivity(activity.name);
          if (!viatorData?.[0]) {
            logger.warn('[Activity Generation] No Viator data found for activity', {
              activity: activity.name
            });
            continue; // Skip activities without Viator data
          }

          enrichedActivities.push({
            ...activity,
            date: this.getDateForActivity(activity.dayNumber, params),
            matchedPreferences: this.getMatchedPreferences(activity, params.preferences),
            selected: false,
            // Mandatory Viator data
            price: viatorData[0].price,
            currency: viatorData[0].currency,
            rating: viatorData[0].rating,
            numberOfReviews: viatorData[0].numberOfReviews,
            images: viatorData[0].images,
            location: viatorData[0].location,
            address: viatorData[0].address,
            highlights: viatorData[0].keyHighlights,
            bookingInfo: viatorData[0].bookingInfo,
            // Time-related fields
            timeSlot: activity.timeSlot || 'morning',
            startTime: this.getDefaultStartTime(activity.timeSlot || 'morning'),
            endTime: this.getDefaultEndTime(activity.timeSlot || 'morning', viatorData[0].duration || activity.duration || 2),
            duration: viatorData[0].duration || activity.duration || 2,
            // Availability info
            availability: {
              isAvailable: true,
              operatingHours: viatorData[0].openingHours,
              availableTimeSlots: [activity.timeSlot],
              bestTimeToVisit: activity.timeSlot
            }
          });
        } catch (error) {
          logger.error('[Activity Generation] Failed to fetch Viator data', {
            activity: activity.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          continue; // Skip activities that fail to fetch Viator data
        }
      }

      if (enrichedActivities.length === 0) {
        throw new Error('No activities could be enriched with Viator data');
      }

      // Use calculateDistribution instead of countCategories
      const distribution = calculateDistribution(enrichedActivities);

      // Add validation to ensure required fields
      logger.info('[Activity Generation] Enrichment validation:', {
        requestId,
        activitiesWithMissingFields: enrichedActivities.filter(a => 
          !a.price || !a.images?.length || !a.rating || !a.numberOfReviews
        ).map(a => ({
          name: a.name,
          missingFields: {
            price: !a.price,
            images: !a.images?.length,
            rating: !a.rating,
            numberOfReviews: !a.numberOfReviews
          }
        }))
      });

      const result = {
        activities: enrichedActivities,
        distribution,
        metadata: {
          requestId,
          originalCount: activities.length,
          finalCount: enrichedActivities.length,
          categoryDistribution: distribution,
          daysPlanned: params.days,
          destination: params.destination
        }
      };

      logger.info('[Activity Generation] Completed', {
        requestId,
        originalCount: activities.length,
        finalCount: enrichedActivities.length,
        distribution
      });

      return result;

    } catch (error) {
      logger.error('[Activity Generation] Failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // New method that only enriches existing activity details
  private async enrichActivityDetails(
    activity: Activity,
    params: GenerateActivitiesParams,
    date: string
  ): Promise<Activity | null> {
    try {
      // Only enrich with additional details, not fetch new activities
      const enrichedActivity = {
        ...activity,
        date,
        matchedPreferences: this.getMatchedPreferences(activity, params.preferences),
        commentary: this.ensurePreferenceReferences(
          activity.commentary,
          params.preferences
        ),
        itineraryHighlight: this.ensurePreferenceReferences(
          activity.itineraryHighlight,
          params.preferences,
          true
        ),
        availability: {
          isAvailable: true,
          operatingHours: activity.openingHours,
          availableTimeSlots: [activity.timeSlot],
          bestTimeToVisit: activity.timeSlot
        }
      };

      return enrichedActivity;
    } catch (error) {
      logger.error('Error enriching activity details', {
        name: activity.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // For initial activity planning - uses sonar-pro model
  async chat(query: string, options?: { web_search?: boolean; temperature?: number; max_tokens?: number }) {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

      const chunks = Math.ceil(7 / 3); // Process 3 days at a time
      let allActivities: any[] = [];

      for (let chunk = 0; chunk < chunks; chunk++) {
        console.log('[Perplexity] Sending request with model: sonar-pro');
        const response = await axios.post(
          this.baseUrl,
          {
            model: 'sonar-pro',
            messages: [
              {
                role: 'system',
                content: `You are a travel activity expert specializing in Viator bookings.

ACTIVITY CATEGORIES (MUST be evenly distributed):
1. Cultural & Historical (25% of activities):
   - Museums, palaces, monuments
   - Historical tours, archaeological sites
   - Architecture walks

2. Nature & Adventure (25% of activities):
   - Parks and gardens
   - Hiking and biking tours
   - Adventure sports
   - Wildlife experiences
   - Water activities

3. Food & Entertainment (25% of activities):
   - Food tours and tastings
   - Cooking classes
   - Shows and performances
   - Evening entertainment
   - Local dining experiences

4. Lifestyle & Local (25% of activities):
   - Shopping tours
   - Local markets
   - Wellness activities
   - Photography spots
   - Artisan workshops

GEOGRAPHIC OPTIMIZATION:
- Group activities in the same area for each day
- Consider the main tourist areas and attractions in the destination
- Plan routes to minimize travel time between activities
- Use the most popular tourist zones in the destination

TIME SLOTS:
- Morning (9:00-13:00): Cultural & Nature activities
- Afternoon (14:00-18:00): Adventure & Shopping activities
- Evening (19:00-23:00): Food & Entertainment activities

BALANCE REQUIREMENTS:
- Maximum 1 museum/historical site per day
- At least 1 outdoor/nature activity per day
- One unique food experience per day
- Balance activities across different categories
- Include local specialties and unique experiences

CRITICAL RULES:
1. Return ONLY 3-4 activities per request to avoid response truncation
2. ONLY suggest activities that you can find on Viator.com
3. ALL URLs must be real, active Viator booking links that you verify
4. Copy exact prices, descriptions, and details from Viator listings
5. Do not make up or guess any information - only use what you find on Viator
6. Ensure activities in the same day are geographically close
7. Account for travel time between locations
8. Don't schedule overlapping activities
9. Consider seasonal/weather appropriate activities
10. Maintain STRICT category distribution (25% each)

Return ONLY a valid JSON object without any explanatory text or markdown formatting, following this structure:
{
  "activities": [
    {
      "name": "EXACT name from Viator listing",
      "description": "EXACT description from Viator",
      "duration": hours (number),
      "price": exact price in USD (number),
      "category": "Cultural & Historical|Nature & Adventure|Food & Entertainment|Lifestyle & Local",
      "location": "EXACT location name from Viator",
      "address": "EXACT address from Viator",
      "zone": "Area name in the destination",
      "keyHighlights": ["EXACT highlights from Viator listing"],
      "openingHours": "EXACT operating hours from Viator",
      "rating": exact Viator rating (number),
      "numberOfReviews": exact number of Viator reviews (number),
      "timeSlot": "morning|afternoon|evening",
      "dayNumber": number,
      "referenceUrl": "EXACT Viator booking URL",
      "images": ["EXACT image URLs from Viator"],
      "selected": false,
      "commentary": "2-3 sentences explaining why this activity is recommended and what makes it special",
      "itineraryHighlight": "1-2 sentences explaining how this activity fits into the day's flow",
      "bookingInfo": {
        "cancellationPolicy": "EXACT policy from Viator",
        "instantConfirmation": true/false,
        "mobileTicket": true/false,
        "languages": ["available languages"],
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
            ],
            temperature: options?.temperature ?? 0.1,
            max_tokens: options?.max_tokens ?? 2000,
            web_search: true
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('[Perplexity] Raw response:', JSON.stringify(response.data, null, 2));
        
        // Extract JSON content from the response
        const content = response.data.choices[0].message.content;
        console.log('[Perplexity] Content to parse:', content);
        
        try {
          // First try to parse the content directly
          let parsedContent;
          try {
            parsedContent = JSON.parse(content);
          } catch (e) {
            // If direct parsing fails, try to extract JSON from markdown or text
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              console.error('[Perplexity] No JSON content found in response');
              continue;
            }

            const jsonContent = jsonMatch[1] || jsonMatch[0];
            // Clean the JSON string before parsing
            const cleanedJson = jsonContent
              .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
              .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
              .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
          .trim();

            try {
              parsedContent = JSON.parse(cleanedJson);
            } catch (parseError) {
              console.error('[Perplexity] Failed to parse cleaned JSON:', parseError);
              continue;
            }
          }
          
          // Validate the structure
          if (!parsedContent.activities || !Array.isArray(parsedContent.activities)) {
            console.error('[Perplexity] Invalid response structure: missing activities array');
            continue;
          }

          // Add valid activities to the collection
          allActivities = [...allActivities, ...parsedContent.activities.map((activity: ViatorActivity) => ({
            ...activity,
            selected: false
          }))];
        } catch (e) {
          console.error('[Perplexity] Failed to parse response:', e);
          continue;
        }
      }

      // Return all collected activities
      return {
        activities: allActivities
      };
    } catch (error: any) {
      console.error('[Perplexity] Error calling API:', error.response?.data || error);
      const errorResponse: PerplexityErrorResponse = {
        error: 'Failed to call Perplexity API'
      };
      throw errorResponse;
    }
  }

  // For individual activity details - uses sonar model
  async getEnrichedDetails(query: string, preferences?: GenerateActivitiesParams['preferences'], date?: string): Promise<PerplexityResponse> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: 'You are a travel activity expert specializing in Viator bookings.'
            },
            {
              role: 'user',
              content: query
            }
          ],
          temperature: 0.3,
          max_tokens: 4000,
          web_search: true
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content;
    logger.debug('[Enrichment] Raw content received:', { contentLength: content.length });

    try {
      let enrichedData;
      try {
        enrichedData = JSON.parse(content);
      } catch (e) {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error('[Enrichment] No JSON content found in response');
          throw new Error('No JSON content found in response');
        }

        const jsonContent = jsonMatch[1] || jsonMatch[0];
        const cleanedJson = jsonContent
            .replace(/[\u0000-\u001F]+/g, '')
            .replace(/,\s*([}\]])/g, '$1')
            .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
          .trim();

        logger.debug('[Enrichment] Attempting to parse cleaned JSON:', { cleanedJson });
        enrichedData = JSON.parse(cleanedJson);
      }
      
        if (!enrichedData.activities?.[0]?.commentary || !enrichedData.activities?.[0]?.itineraryHighlight) {
          logger.error('[Enrichment] Missing required fields in enriched data', {
            hasCommentary: !!enrichedData.activities?.[0]?.commentary,
            hasHighlight: !!enrichedData.activities?.[0]?.itineraryHighlight
          });
          
          if (!enrichedData.activities?.[0]?.commentary && preferences) {
            enrichedData.activities[0].commentary = `This activity aligns with your interests in ${preferences.interests.join(' and ')}. It offers a ${preferences.pacePreference} pace experience that matches your ${preferences.travelStyle} travel style.`;
          }
          
          if (!enrichedData.activities?.[0]?.itineraryHighlight && preferences) {
            enrichedData.activities[0].itineraryHighlight = `This activity is well-scheduled for your ${preferences.pacePreference} pace preference and complements other activities in your itinerary.`;
          }
        }

        return enrichedData;
      } catch (e) {
        logger.error('[Enrichment] Failed to parse enriched data', {
          error: e instanceof Error ? e.message : 'Unknown error',
          contentLength: content.length
        });
        throw e;
      }
    } catch (error) {
      logger.error('[Enrichment] Error during enrichment', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
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

  private getDefaultStartTime(timeSlot: string): string {
    switch (timeSlot.toLowerCase()) {
      case 'morning':
        return '09:00';
      case 'afternoon':
        return '14:00';
      case 'evening':
        return '19:00';
      default:
        return '09:00';
    }
  }

  private getDefaultEndTime(timeSlot: string, duration: number): string {
    const startHour = parseInt(this.getDefaultStartTime(timeSlot).split(':')[0]);
    const endHour = startHour + duration;
    return `${endHour.toString().padStart(2, '0')}:00`;
  }

  private scoreActivity(
    activity: Activity, 
    preferences: GenerateActivitiesParams['preferences'],
    existingActivities: Activity[]
  ): ActivityScore {
    const scoreBreakdown = {
      rating: 0,
      reviewCount: 0,
      preferenceMatch: 0,
      priceValue: 0,
      categoryBalance: 0
    };

    // Rating score (0-25 points)
    scoreBreakdown.rating = ((activity.rating || 0) / 5) * 25;

    // Review count score (0-15 points)
    const reviewScore = Math.min((activity.numberOfReviews || 0) / 1000, 1) * 15;
    scoreBreakdown.reviewCount = reviewScore;

    // Preference matching score (0-30 points)
    const matchedPreferences = preferences.interests.filter(interest =>
      activity.description?.toLowerCase().includes(interest.toLowerCase()) ||
      activity.name.toLowerCase().includes(interest.toLowerCase())
    );
    scoreBreakdown.preferenceMatch = (matchedPreferences.length / preferences.interests.length) * 30;

    // Price value score (0-15 points)
    const priceScore = activity.price ? Math.max(0, (200 - activity.price) / 200) * 15 : 0;
    scoreBreakdown.priceValue = priceScore;

    // Category balance score (0-15 points)
    const categoryCount = existingActivities.filter(a => a.category === activity.category).length;
    const categoryScore = Math.max(0, (5 - categoryCount) / 5) * 15;
    scoreBreakdown.categoryBalance = categoryScore;

    // Calculate total score
    const totalScore = Object.values(scoreBreakdown).reduce((sum, score) => sum + score, 0);

    return {
      activity,
      score: totalScore,
      scoreBreakdown
    };
  }

  private balanceActivities(activities: Activity[], params: GenerateActivitiesParams): Activity[] {
    // Score all activities
    const scoredActivities: ActivityScore[] = [];
    const distributedActivities: Activity[] = [];

    // First pass: Score all activities
    activities.forEach(activity => {
      if (!activity) return;
      const score = this.scoreActivity(activity, params.preferences, distributedActivities);
      scoredActivities.push(score);
    });

    // Sort by score
    scoredActivities.sort((a, b) => b.score - a.score);

    logger.info('[Activity Balancing] Scored activities:', {
      totalActivities: scoredActivities.length,
      topScore: scoredActivities[0]?.score,
      bottomScore: scoredActivities[scoredActivities.length - 1]?.score,
      categories: scoredActivities.reduce((acc, curr) => {
        const cat = curr.activity.category;
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    });

    // Calculate targets
    const daysCount = params.days;
    const targetPerDay = 3;
    const totalTargetActivities = daysCount * targetPerDay;
    
    const timeSlots = ['morning', 'afternoon', 'evening'];
    
    // First pass: Fill required slots
    for (let day = 1; day <= daysCount; day++) {
      for (const timeSlot of timeSlots) {
        const availableActivities = scoredActivities
          .filter(scored => scored?.activity && !distributedActivities.includes(scored.activity))
          .filter(scored => {
            return !distributedActivities.some(existing => 
              calculateStringSimilarity(existing.name, scored.activity.name) > 0.9
            );
          });

        if (availableActivities.length > 0) {
          const bestActivity = {
            ...availableActivities[0].activity,
            dayNumber: day,
            timeSlot: timeSlot,
            startTime: this.getDefaultStartTime(timeSlot),
            endTime: this.getDefaultEndTime(timeSlot, availableActivities[0].activity.duration || 2)
          };
          
          distributedActivities.push(bestActivity);
        }
      }
    }

    // Second pass: Fill remaining slots
    while (distributedActivities.length < totalTargetActivities && scoredActivities.length > 0) {
      // ... rest of the balancing logic ...
    }

    return distributedActivities;
  }
}

// Create and export a singleton instance
export const perplexityClient = new PerplexityService(); 