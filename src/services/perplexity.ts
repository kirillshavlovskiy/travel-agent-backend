import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';

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
  logger.info('[Duplicate Cleaning] Starting process', {
    totalActivities: activities.length
  });

  const duplicateGroups = new Map<string, Activity[]>();
  
  // Enhanced normalization for activity names
  const normalizeTitle = (title: string): string => {
    return title
      .toLowerCase()
      // Remove common variations and filler words
      .replace(/tickets?|tours?|guided|exclusive|semi-private|private|direct|entry|access|skip.*line|priority|admission|experience|visit/gi, '')
      .replace(/\([^)]*\)/g, '') // Remove text in parentheses
      .replace(/with.*$/i, '') // Remove "with..." suffixes
      .replace(/\b(the|to|at|in|for|from|by|and|or)\b/gi, '') // Remove common prepositions and conjunctions
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
      
      // Use stricter similarity threshold (0.6) but with additional checks
      if (similarity > 0.6) {
        // Additional verification checks
        const durationMatch = !activity.duration || !baseActivity.duration || 
          Math.abs(activity.duration - baseActivity.duration) <= 30; // Allow 30 min difference
        
        const locationMatch = !activity.location || !baseActivity.location ||
          calculateStringSimilarity(
            activity.location.toLowerCase(),
            baseActivity.location.toLowerCase()
          ) > 0.8;
        
        const categoryMatch = !activity.category || !baseActivity.category ||
          activity.category === baseActivity.category;
        
        const timeMatch = !activity.timeSlot || !baseActivity.timeSlot ||
          activity.timeSlot === baseActivity.timeSlot;

        // Consider activities similar if they have high name similarity AND
        // match on at least location or duration, plus category
        if ((durationMatch || locationMatch) && categoryMatch && timeMatch) {
          group.push(activity);
          foundMatch = true;
          logger.debug('[Duplicate Cleaning] Found similar activity', {
            original: baseActivity.name,
            duplicate: activity.name,
            similarity,
            duration: activity.duration,
            location: activity.location,
            durationMatch,
            locationMatch,
            categoryMatch
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
  return (activity1.price || 0) < (activity2.price || 0);
}

function countCategories(activities: Activity[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    acc[activity.category] = (acc[activity.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

// Add interface for image data
interface ActivityImage {
  source: string;
  url: string;
}

// Add interface for enriched activity data
interface EnrichedActivityData {
  name: string;
  description: string;
  duration: number;
  price: number | {
    amount: number;
    currency: string;
  };
  rating: number | string;
  numberOfReviews: number | string;
  images: Array<string | ActivityImage>;
  location: string;
  address: string;
  keyHighlights: string[];
  openingHours: string;
  referenceUrl: string;
  bookingInfo?: {
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
  };
}

interface PerplexityActivityResponse {
  activities: Array<Activity & Partial<EnrichedActivityData>>;
  dailySummaries: Array<{
    dayNumber: number;
    summary: string;
    dayHighlight: string;
    practicalTips: string;
  }>;
}

// Add default durations by category and time slot
const DEFAULT_DURATIONS = {
  'Cultural & Historical': {
    morning: 3,
    afternoon: 3,
    evening: 2
  },
  'Nature & Adventure': {
    morning: 4,
    afternoon: 3,
    evening: 2
  },
  'Food & Entertainment': {
    morning: 2,
    afternoon: 3,
    evening: 3
  },
  'Lifestyle & Local': {
    morning: 2,
    afternoon: 3,
    evening: 2
  }
} as const;

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

CRITICAL RULES:
1. Return ONLY a valid JSON array - NO explanatory text before or after
2. NO markdown formatting
3. NO introduction or conclusion text
4. ONLY suggest activities that exist on Viator.com
5. Use EXACT names from Viator listings
6. Ensure activities in the same day are geographically close
7. Account for travel time between locations
8. Don't schedule overlapping activities
9. Consider seasonal/weather appropriate activities
10. Maintain STRICT category distribution (25% each)

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
Return ONLY a JSON array of activities, each with:
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

REMEMBER: Return ONLY the JSON array with NO additional text or formatting.`;
  }

  private async makePerplexityRequests(query: string): Promise<PerplexityActivityResponse> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          model: 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful travel planning assistant. Return ONLY a valid JSON object without any explanatory text.'
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

      logger.debug('[Activity Generation] Raw content received:', { contentLength: content.length });

      try {
        // First try to parse the content directly
        let parsedContent: PerplexityActivityResponse;
        try {
          parsedContent = JSON.parse(content);
        } catch (e) {
          // If direct parsing fails, try to extract JSON object
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            logger.error('[Activity Generation] No JSON object found in response');
            throw new Error('No JSON object found in response');
          }

          const jsonContent = jsonMatch[0];
          // Clean the JSON string before parsing
          const cleanedJson = jsonContent
            .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
            .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
            .trim();

          logger.debug('[Activity Generation] Attempting to parse cleaned JSON:', { cleanedJson });
          parsedContent = JSON.parse(cleanedJson);
        }

        // Validate response structure
        if (!parsedContent.activities || !Array.isArray(parsedContent.activities)) {
          throw new Error('Invalid response structure: missing activities array');
        }

        if (!parsedContent.dailySummaries || !Array.isArray(parsedContent.dailySummaries)) {
          logger.warn('[Activity Generation] Missing daily summaries, using empty array');
          parsedContent.dailySummaries = [];
        }
        
        logger.info('[Activity Generation] Successfully parsed response', {
          totalActivities: parsedContent.activities.length,
          totalSummaries: parsedContent.dailySummaries.length
        });

        return parsedContent;
      } catch (error) {
        logger.error('[Activity Generation] Failed to parse Perplexity response', { content, error });
        throw new Error('Invalid JSON response from Perplexity');
      }
    } catch (error) {
      logger.error('[Activity Generation] Error calling Perplexity API', error);
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

      // 1. Generate activities with essential data and insights
      const query = `Create a ${params.days}-day activity plan for ${params.destination} with the following requirements:

CRITICAL RULES:
1. Return ONLY a valid JSON object - NO explanatory text
2. Focus on finding REAL activities that exist on Viator.com
3. Ensure activities in the same day are geographically close
4. Account for travel time between locations
5. Maintain category distribution (25% each)

BUDGET & CATEGORIES:
- Daily budget: ${params.budget} ${params.currency}
- Categories (25% each):
  * Cultural & Historical
  * Nature & Adventure
  * Food & Entertainment
  * Lifestyle & Local

TIME SLOTS:
- Morning (9:00-13:00)
- Afternoon (14:00-18:00)
- Evening (19:00-23:00)

REQUIRED FIELDS FOR EACH ACTIVITY:
1. name: Activity name as found on Viator
2. location: General area/neighborhood
3. category: One of the four main categories
4. timeSlot: morning|afternoon|evening
5. dayNumber: 1-${params.days}
6. duration: Approximate duration in hours (number)
7. commentary: 2-3 sentences on why this activity is recommended for the traveler
8. itineraryHighlight: How this activity fits into the day's flow

DAILY INSIGHTS:
For each day, provide:
1. summary: Natural flowing paragraph connecting the day's activities
2. dayHighlight: Main theme or highlight of the day
3. practicalTips: Local transportation and timing advice

Return a JSON object with:
{
  "activities": [
    {
      "name": string,
      "location": string,
      "category": string,
      "timeSlot": string,
      "dayNumber": number,
      "duration": number,
      "commentary": string,
      "itineraryHighlight": string
    }
  ],
  "dailySummaries": [
    {
      "dayNumber": number,
      "summary": string,
      "dayHighlight": string,
      "practicalTips": string
    }
  ]
}`;

      logger.debug('Sending query to Perplexity API', { query });
      const response = await this.makePerplexityRequests(query) as PerplexityActivityResponse;
      
      // Add default durations if missing
      const activitiesWithDuration = response.activities.map(activity => ({
        ...activity,
        duration: activity.duration || DEFAULT_DURATIONS[activity.category as keyof typeof DEFAULT_DURATIONS]?.[activity.timeSlot as keyof typeof DEFAULT_DURATIONS['Cultural & Historical']] || 2
      }));
      
      // 2. Clean and balance activities
      const balancedActivities = balanceActivities(activitiesWithDuration);
      logger.info('Successfully balanced activities', {
        originalCount: activitiesWithDuration.length,
        balancedCount: balancedActivities.length
      });

      // 3. Enrich with Viator data
      const enrichedActivities = await Promise.all(
        balancedActivities.map(async (activity) => {
          try {
            // Search Viator for exact activity details
            const enrichedData = await this.getEnrichedDetails(
              `Find this exact activity on Viator in ${params.destination}: ${activity.name}`
            );
            
            // Ensure we have valid enriched data
            const enriched = enrichedData.activities?.[0] as EnrichedActivityData | undefined;
            if (!enriched) {
              logger.warn('No enriched data found for activity', { name: activity.name });
              // Return activity with default values
              return {
                ...activity,
                rating: 4.0,
                numberOfReviews: 50,
                images: [{
                  source: 'placeholder',
                  url: `https://placehold.co/600x400?text=${encodeURIComponent(activity.name)}`
                }],
                description: activity.commentary || '',
                keyHighlights: [],
                openingHours: '',
                referenceUrl: '',
                bookingInfo: {
                  cancellationPolicy: 'Free cancellation available',
                  instantConfirmation: true,
                  mobileTicket: true,
                  languages: ['English']
                }
              };
            }

            // Handle price data
            let price = {
              amount: 0,
              currency: params.currency
            };
            if (typeof enriched.price === 'number') {
              price = {
                amount: enriched.price,
                currency: params.currency
              };
            } else if (enriched.price && typeof (enriched.price as any).amount === 'number') {
              price = enriched.price as { amount: number; currency: string };
            }

            // Handle images data with proper validation
            const images = enriched.images?.length ? 
              enriched.images.map(img => {
                // Ensure we have a valid URL string
                let imageUrl: string;
                if (typeof img === 'string') {
                  imageUrl = img;
                } else if (typeof img === 'object' && img !== null && 'url' in img) {
                  imageUrl = (img as ActivityImage).url;
                } else {
                  // Default to placeholder if invalid image data
                  imageUrl = `https://placehold.co/600x400?text=${encodeURIComponent(activity.name)}`;
                }

                // Validate URL
                try {
                  new URL(imageUrl); // This will throw if URL is invalid
                  return {
                    source: 'viator',
                    url: imageUrl
                  };
                } catch {
                  // If URL is invalid, use placeholder
                  return {
                    source: 'placeholder',
                    url: `https://placehold.co/600x400?text=${encodeURIComponent(activity.name)}`
                  };
                }
              }) : [{
                source: 'placeholder',
                url: `https://placehold.co/600x400?text=${encodeURIComponent(activity.name)}`
              }];

            // Ensure all required fields are present and properly typed
            return {
              ...activity,
              name: enriched.name || activity.name,
              description: enriched.description || activity.commentary || '',
              duration: activity.duration, // Keep original duration
              price,
              rating: parseFloat(enriched.rating?.toString() || '4.0'),
              numberOfReviews: parseInt(enriched.numberOfReviews?.toString() || '50'),
              images,
              location: enriched.location || activity.location,
              address: enriched.address || activity.location,
              keyHighlights: enriched.keyHighlights || [],
              openingHours: enriched.openingHours || '',
              referenceUrl: enriched.referenceUrl || '',
              // Preserve our generated insights
              commentary: activity.commentary,
              itineraryHighlight: activity.itineraryHighlight,
              bookingInfo: {
                cancellationPolicy: enriched.bookingInfo?.cancellationPolicy || 'Free cancellation available',
                instantConfirmation: enriched.bookingInfo?.instantConfirmation || true,
                mobileTicket: enriched.bookingInfo?.mobileTicket || true,
                languages: enriched.bookingInfo?.languages || ['English']
              }
            };
          } catch (error) {
            logger.warn('Failed to enrich activity', {
              name: activity.name,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            // Return activity with default values on error
            return {
              ...activity,
              rating: 4.0,
              numberOfReviews: 50,
              images: [{
                source: 'placeholder',
                url: `https://placehold.co/600x400?text=${encodeURIComponent(activity.name)}`
              }],
              description: activity.commentary || '',
              keyHighlights: [],
              openingHours: '',
              referenceUrl: '',
              bookingInfo: {
                cancellationPolicy: 'Free cancellation available',
                instantConfirmation: true,
                mobileTicket: true,
                languages: ['English']
              }
            };
          }
        })
      );

      return {
        activities: enrichedActivities,
        dailySummaries: response.dailySummaries || [],
        metadata: {
          originalCount: response.activities.length,
          finalCount: enrichedActivities.length,
          daysPlanned: params.days,
          destination: params.destination
        }
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
      
      // Validate and clean up activity data
      if (enrichedData.activities) {
        enrichedData.activities = enrichedData.activities.map((activity: any) => {
          // Ensure price is a valid number
          if (!activity.price || activity.price <= 0) {
            logger.warn('[Enrichment] Invalid price detected, activity will be filtered', {
              name: activity.name,
              price: activity.price
            });
            return null;
          }

          // Ensure price_category is valid
          if (!activity.price_category || !['budget', 'medium', 'premium'].includes(activity.price_category)) {
            activity.price_category = determinePriceTier(activity.price);
            logger.info('[Enrichment] Fixed price category', {
              name: activity.name,
              price: activity.price,
              category: activity.price_category
            });
          }

          return activity;
        }).filter(Boolean); // Remove null entries
      }

      // Log enrichment details
      if (enrichedData.activities) {
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