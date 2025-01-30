import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';

interface PerplexityResponse {
  text: string;
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
  id?: string;  // Add optional id field
  name: string;
  description: string;
  location: string;
  category: string;
  timeSlot: string;
  dayNumber: number;
  rating: number;
  numberOfReviews: number;
  price: number;
  duration?: number;  // Duration in minutes
  keyHighlights?: string[];
  openingHours?: string;
  address?: string;
  zone?: string;
  referenceUrl?: string;
  images?: string[];
  commentary?: string;
  itineraryHighlight?: string;
  bookingInfo?: {
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
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
}

interface DailyItinerarySummary {
  dayNumber: number;
  summary: string;
  activities: Activity[];
}

const ACTIVITY_CATEGORIES = [
  'Cultural & Historical',
  'Nature & Adventure',
  'Food & Entertainment',
  'Lifestyle & Local'
];

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

  // Initialize distribution object
  ACTIVITY_CATEGORIES.forEach(category => {
    distribution[category] = {
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
  activities.forEach(activity => {
    const category = activity.category;
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
  const groupedActivities = cleanedActivities.reduce((acc, activity) => {
    const category = activity.category;
    const tier = determinePriceTier(activity.price);
    
    if (!acc[category]) {
      acc[category] = { budget: [], medium: [], premium: [] };
    }
    acc[category][tier].push(activity);
    return acc;
  }, {} as Record<string, Record<typeof PRICE_TIERS[number], Activity[]>>);

  // Balance activities
  const balancedActivities: Activity[] = [];
  
  // First pass: ensure minimum representation for each category
  ACTIVITY_CATEGORIES.forEach(category => {
    const categoryActivities = groupedActivities[category] || { budget: [], medium: [], premium: [] };
    const totalInCategory = Object.values(categoryActivities).flat().length;
    
    if (totalInCategory > targetPerCategory) {
      // Remove excess activities, preferring to keep higher rated ones
      const allCategoryActivities = Object.values(categoryActivities).flat()
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));
      
      balancedActivities.push(...allCategoryActivities.slice(0, targetPerCategory));
    } else {
      // Keep all activities in this category
      balancedActivities.push(...Object.values(categoryActivities).flat());
    }
  });

  // Second pass: balance price tiers within each category
  const finalActivities = balancedActivities.reduce((acc, activity) => {
    const category = activity.category;
    const tier = determinePriceTier(activity.price);
    
    if (!acc[category]) {
      acc[category] = { budget: [], medium: [], premium: [] };
    }
    
    // Only add if we haven't exceeded target for this tier
    if (acc[category][tier].length < Math.ceil(targetPerCategory / 3)) {
      acc[category][tier].push(activity);
    }
    
    return acc;
  }, {} as Record<string, Record<typeof PRICE_TIERS[number], Activity[]>>);

  // Flatten and sort by rating within each category
  const result = Object.values(finalActivities)
    .flatMap(tierGroups => 
      Object.values(tierGroups)
        .flat()
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    );

  const finalDistribution = calculateDistribution(result);
  
  logger.info('[Activity Balancing] Final distribution after balancing', {
    originalCount: activities.length,
    cleanedCount: cleanedActivities.length,
    finalCount: result.length,
    distribution: finalDistribution
  });

  return result;
}

const cleanSimilarActivities = (activities: Activity[]): Activity[] => {
  console.log('[Perplexity] Starting duplicate cleaning process with activities:', 
    activities.map(a => ({
      id: a.id || `activity-${Math.random().toString(36).substr(2, 9)}`,
      name: a.name,
      rating: a.rating,
      reviews: a.numberOfReviews,
      price: a.price
    }))
  );

  const duplicateGroups = new Map<string, Activity[]>();
  
  // Group similar activities
  for (const activity of activities) {
    let foundMatch = false;
    for (const [key, group] of duplicateGroups) {
      const baseActivity = group[0];
      const similarity = calculateStringSimilarity(baseActivity.name, activity.name);
      
      console.log('[Perplexity] Checking similarity:', {
        activity1: baseActivity.name,
        activity2: activity.name,
        similarity,
        threshold: 0.6
      });

      if (similarity > 0.6) {
        const existingGroup = duplicateGroups.get(key);
        if (existingGroup) {
          existingGroup.push(activity);
          console.log('[Perplexity] Found similar activities:', {
            group: key,
            activities: existingGroup.map(a => ({
              name: a.name,
              rating: a.rating,
              reviews: a.numberOfReviews
            }))
          });
        }
        foundMatch = true;
        break;
      }
    }
    
    if (!foundMatch) {
      const activityId = activity.id || `activity-${Math.random().toString(36).substr(2, 9)}`;
      duplicateGroups.set(activityId, [activity]);
    }
  }

  // Keep only the best activity from each group
  const cleanedActivities: Activity[] = [];
  for (const group of duplicateGroups.values()) {
    if (group.length > 1) {
      console.log('[Perplexity] Processing duplicate group:', 
        group.map(a => ({
          name: a.name,
          rating: a.rating,
          reviews: a.numberOfReviews,
          price: a.price
        }))
      );
      
      const bestActivity = group.reduce((best: Activity, current: Activity) => 
        shouldPreferActivity(current, best) ? current : best
      );
      
      console.log('[Perplexity] Selected best activity:', {
        name: bestActivity.name,
        rating: bestActivity.rating,
        reviews: bestActivity.numberOfReviews,
        price: bestActivity.price,
        reason: 'Highest rating/reviews combination'
      });
      
      cleanedActivities.push(bestActivity);
    } else {
      cleanedActivities.push(group[0]);
    }
  }

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
  return (activity1.price || 0) < (activity2.price || 0);
}

function countCategories(activities: Activity[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    acc[activity.category] = (acc[activity.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
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
    return `Create a ${params.days}-day activity plan for ${params.destination} with the following requirements:

BUDGET & QUALITY:
- Daily budget: ${params.budget} ${params.currency} per person
- Minimum rating: 4.0+ stars on Viator
- Must have at least 50 reviews

ACTIVITY CATEGORIES (MUST be evenly distributed across days):
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

TIME SLOTS:
- Morning (9:00-13:00): Cultural & Nature activities
- Afternoon (14:00-18:00): Adventure & Shopping activities
- Evening (19:00-23:00): Food & Entertainment activities

BALANCE REQUIREMENTS:
- Maximum 1 museum/historical site per day
- At least 1 outdoor/nature activity per day
- One unique food experience per day
- Include at least:
  * 2 nature/adventure activities
  * 2 local cultural experiences
  * 1 evening entertainment
  * 1 hands-on workshop or class

OUTPUT FORMAT:
Return a JSON array of activities, each with:
{
  "name": "EXACT Viator activity name",
  "timeSlot": "morning|afternoon|evening",
  "category": "Cultural & Historical|Nature & Adventure|Food & Entertainment|Lifestyle & Local",
  "dayNumber": 1-${params.days},
  "expectedDuration": "in minutes",
  "commentary": "2-3 sentences explaining why this activity is recommended and what makes it special",
  "itineraryHighlight": "1-2 sentences explaining how this activity fits into the day's flow",
  "selected": false
}

CRITICAL RULES:
1. ONLY suggest activities that exist on Viator.com
2. Use EXACT names from Viator listings
3. Ensure activities in the same day are geographically close
4. Account for travel time between locations
5. Don't schedule overlapping activities
6. Consider seasonal/weather appropriate activities
7. Set selected to false for all activities
8. Include thoughtful commentary for each activity
9. Maintain STRICT category distribution (25% each)

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
              content: 'You are a helpful travel planning assistant.'
            },
            {
              role: 'user',
              content: query
            }
          ]
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
        throw new Error('No content in Perplexity response');
      }

      try {
        const parsed = JSON.parse(content);
        return parsed.activities || [];
      } catch (error) {
        logger.error('Failed to parse Perplexity response', { content, error });
        throw new Error('Invalid JSON response from Perplexity');
      }
    } catch (error) {
      logger.error('Error calling Perplexity API', error);
      throw error;
    }
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

  async generateActivities(params: GenerateActivitiesParams): Promise<any> {
    try {
      logger.info('Received activity generation request', params);

      const query = this.buildActivityQuery(params);
      logger.debug('Sending query to Perplexity API', { query });

      const activities = await this.makePerplexityRequests(query);
      
      // Balance activities before generating summaries
      const balancedActivities = balanceActivities(activities);
      logger.info('Successfully balanced activities', {
        originalCount: activities.length,
        balancedCount: balancedActivities.length
      });

      // Generate daily summaries with balanced activities
      const dailySummaries = await this.generateDailyHighlights(balancedActivities);

      return {
        activities: balancedActivities,
        dailySummaries
      };

    } catch (error) {
      logger.error('Failed to generate activities', error);
      throw error;
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
  async getEnrichedDetails(query: string): Promise<PerplexityResponse> {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

      logger.info('[Enrichment] Starting activity enrichment', { query });

      const response = await axios.post(this.baseUrl, {
        model: 'sonar',
          messages: [
            {
              role: 'system',
            content: `You are a travel activity expert specializing in Viator bookings.
Your task is to search through Viator's platform to find and recommend REAL, BOOKABLE activities.

SEARCH PROCESS:
1. Search Viator.com for available activities
2. Sort activities by rating and popularity
3. Find multiple activities across different price ranges
4. Verify each activity exists and is currently bookable
5. Copy exact details from the Viator listings

CRITICAL RULES:
1. ONLY suggest activities that you can find on Viator.com
2. ALL URLs must be real, active Viator booking links that you verify
3. Include EXACT booking URLs in this format:
   - https://www.viator.com/tours/[city]/[activity-name]/[product-code]
4. Copy exact prices, descriptions, and details from Viator listings
5. Do not make up or guess any information - only use what you find
6. If you cannot find activities, return a JSON object with an error field

COMMENTARY REQUIREMENTS:
1. For each activity, provide:
   - A 2-3 sentence commentary explaining why this activity is recommended
   - A 1-2 sentence explanation of how it fits into an itinerary
2. Focus on:
   - Unique selling points
   - Historical or cultural significance
   - Special experiences or access
   - Local insights
   - Practical benefits (skip-the-line, guided tour, etc.)

Return ONLY a valid JSON object without any explanatory text or markdown formatting, following this structure:
{
  "activities": [
    {
      "name": "EXACT name from Viator listing",
      "provider": "Viator",
      "price": exact price in USD,
      "price_category": "budget" or "medium" or "premium",
      "duration": hours (number),
      "dayNumber": number,
      "category": "Cultural & Historical|Nature & Adventure|Food & Entertainment|Lifestyle & Local",
      "location": "EXACT location name from Viator",
      "address": "EXACT address from Viator",
      "keyHighlights": ["EXACT highlights from Viator listing"],
      "openingHours": "EXACT operating hours from Viator",
      "rating": exact Viator rating (number),
      "numberOfReviews": exact number of Viator reviews,
      "preferredTimeOfDay": "morning" or "afternoon" or "evening",
      "referenceUrl": "EXACT Viator booking URL",
      "images": ["EXACT image URLs from Viator"],
      "commentary": "2-3 sentences explaining why this activity is recommended and what makes it special",
      "itineraryHighlight": "1-2 sentences explaining how this activity fits into the day's flow",
      "bookingInfo": {
        "provider": "Viator",
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
          temperature: 0.1,
          max_tokens: 4000,
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
      
      // Log enrichment details for each activity
      if (enrichedData.activities) {
        enrichedData.activities.forEach((activity: any, index: number) => {
          logger.info('[Enrichment] Activity details enriched', {
            activityIndex: index,
            name: activity.name,
            hasCommentary: !!activity.commentary,
            hasHighlight: !!activity.itineraryHighlight,
            commentaryLength: activity.commentary?.length || 0,
            highlightLength: activity.itineraryHighlight?.length || 0,
            category: activity.category,
            enrichedFields: Object.keys(activity).filter(key => 
              ['keyHighlights', 'openingHours', 'address', 'images', 'bookingInfo'].includes(key) && 
              activity[key] != null
            )
          });
        });

        logger.info('[Enrichment] Enrichment summary', {
          totalActivities: enrichedData.activities.length,
          activitiesWithCommentary: enrichedData.activities.filter((a: any) => a.commentary).length,
          activitiesWithHighlights: enrichedData.activities.filter((a: any) => a.itineraryHighlight).length,
          categoryCounts: enrichedData.activities.reduce((acc: any, a: any) => {
            acc[a.category] = (acc[a.category] || 0) + 1;
            return acc;
          }, {})
        });
      }

      return enrichedData;
    } catch (e) {
      logger.error('[Enrichment] Failed to parse enriched data', {
        error: e instanceof Error ? e.message : 'Unknown error',
        contentLength: content.length,
        rawContent: content
      });
        return {
          text: content,
          error: 'Failed to parse activity data'
        };
      }
    } catch (error) {
    logger.error('[Enrichment] Error during enrichment', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
      throw error;
    }
  }
}

// Create and export a singleton instance
export const perplexityClient = new PerplexityService(); 