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
  duration?: number | { min: number; max: number };
  price?: number;
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
  date?: string;
  timeSlotVerification?: TimeSlotVerification;
  availability?: {
    isAvailable: boolean;
    operatingHours?: string;
    availableTimeSlots: string[];
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
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

function determinePriceTier(price: number): typeof PRICE_TIERS[number] {
  if (price <= 50) return 'budget';
  if (price <= 150) return 'medium';
  return 'premium';
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
    const tier = determinePriceTier(activity.price || 0);
    
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
    const tier = determinePriceTier(activity.price || 0);
    
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
  return (activity1.price || 0) < (activity2.price || 0);
}

function countCategories(activities: Activity[]): Record<string, number> {
  return activities.reduce((acc, activity) => {
    acc[activity.category] = (acc[activity.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

// Add new interface for time slot verification
interface TimeSlotVerification {
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
        throw new Error('No content in Perplexity response');
      }

      logger.debug('[Activity Generation] Raw content received:', { contentLength: content.length });

      try {
        // First try to parse the content directly
        let parsedContent;
        try {
          parsedContent = JSON.parse(content);
        } catch (e) {
          // If direct parsing fails, try to extract JSON from markdown or text
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            logger.error('[Activity Generation] No JSON content found in response');
            throw new Error('No JSON content found in response');
          }

          const jsonContent = jsonMatch[1] || jsonMatch[0];
          // Clean the JSON string before parsing
          const cleanedJson = jsonContent
            .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
            .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
            .replace(/([{,]\s*)'([^']+)':/g, '$1"$2":') // Convert single quotes to double quotes for property names
            .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
            .replace(/\n/g, ' ') // Replace newlines with spaces
            .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
            .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert single quoted values to double quotes
            .replace(/([{,]\s*)"([^"]+)":\s*"([^"]*)"/g, '$1"$2":"$3"') // Normalize spacing around colons
            .trim();

            logger.debug('[Activity Generation] Attempting to parse cleaned JSON:', { cleanedJson });
            parsedContent = JSON.parse(cleanedJson);
        }

        // Validate the structure
        if (!parsedContent.activities) {
          // Try to extract activities from schedule structure
          if (parsedContent.schedule?.[0]?.activities) {
            parsedContent = {
              activities: parsedContent.schedule[0].activities
            };
          } else if (Array.isArray(parsedContent.schedule)) {
            parsedContent = {
              activities: parsedContent.schedule
            };
          } else {
            logger.error('[Perplexity] Invalid response structure:', parsedContent);
            throw new Error('Invalid response structure');
          }
        }

        if (!Array.isArray(parsedContent.activities)) {
          logger.error('[Perplexity] Activities is not an array:', parsedContent.activities);
          throw new Error('Activities is not an array');
        }

        // Add valid activities to the collection
        const validActivities = parsedContent.activities.filter(activity => 
          activity && 
          activity.name &&
          activity.category &&
          activity.timeSlot
        );

        if (validActivities.length === 0) {
          logger.warn('[Perplexity] No valid activities found in response');
          throw new Error('No valid activities found in response');
        }

        logger.info('[Perplexity] Found valid activities:', {
          count: validActivities.length,
          categories: validActivities.map(a => a.category)
        });

        // Add duration validation and normalization
        const normalizedActivities = validActivities.map(activity => {
          // Normalize duration to minutes
          let duration = 0;
          if (activity.duration) {
            if (typeof activity.duration === 'number') {
              duration = activity.duration;
            } else if (typeof activity.duration === 'object') {
              if (activity.duration.fixedDurationInMinutes) {
                duration = activity.duration.fixedDurationInMinutes;
              } else if (activity.duration.min && activity.duration.max) {
                duration = Math.floor((activity.duration.min + activity.duration.max) / 2);
              }
            } else if (typeof activity.duration === 'string') {
              // Try to extract number of hours/minutes from string
              const hourMatch = activity.duration.match(/(\d+)\s*(?:hours?|hrs?)/i);
              const minuteMatch = activity.duration.match(/(\d+)\s*(?:minutes?|mins?)/i);
              
              if (hourMatch) {
                duration += parseInt(hourMatch[1]) * 60;
              }
              if (minuteMatch) {
                duration += parseInt(minuteMatch[1]);
              }
            }
          }

          return {
            ...activity,
            duration: duration || 120, // Default to 2 hours if no duration specified
            durationDisplay: duration ? 
              duration >= 60 ? 
                `${Math.floor(duration / 60)} hour${Math.floor(duration / 60) !== 1 ? 's' : ''}${duration % 60 ? ` ${duration % 60} minutes` : ''}` : 
                `${duration} minutes` :
              '2 hours'
          };
        });
        
        logger.info('[Activity Generation] Successfully parsed activities', {
          totalActivities: normalizedActivities.length,
          firstActivity: normalizedActivities[0]?.name
        });

        return normalizedActivities;
      } catch (error) {
        logger.error('[Activity Generation] Failed to parse Perplexity response', { content, error });
        throw new Error('Invalid JSON response from Perplexity');
      }
    } catch (error) {
      logger.error('[Activity Generation] Error calling Perplexity API', error);
      throw error;
    }
  }

  async generateActivities(params: GenerateActivitiesParams): Promise<any> {
    try {
      logger.info('Received activity generation request', params);

      // 1. Initial activity generation
      const query = this.buildActivityQuery(params);
      logger.debug('Sending query to Perplexity API', { query });
      const activities = await this.makePerplexityRequests(query);
      
      // 2. Clean and balance activities
      const balancedActivities = await this.cleanAndBalanceActivities(activities, params);
      
      // Log category distribution before enrichment
      const distribution = countCategories(balancedActivities);
      logger.info('Category distribution after balancing:', distribution);
      
      // 3. Enrich activities with detailed information
      const enrichedActivities = [];
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

      // 4. Generate daily summaries
      const dailySummaries = await this.generateDailyHighlights(enrichedActivities);

      // 5. Generate day highlights
      const dayHighlights = this.generateDayHighlights(enrichedActivities);

      return {
        activities: enrichedActivities,
        dailySummaries,
        dayHighlights,
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
    } catch (error) {
      logger.error('Failed to generate activities', error);
      throw error;
    }
  }

  // For initial activity planning - uses sonar model
  async chat(query: string, options?: { web_search?: boolean; temperature?: number; max_tokens?: number }) {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

      const chunks = Math.ceil(7 / 3); // Process 3 days at a time
      let allActivities: any[] = [];

      for (let chunk = 0; chunk < chunks; chunk++) {
        console.log('[Perplexity] Sending request with model: sonar');
        const response = await axios.post(
          this.baseUrl,
          {
            model: 'sonar',
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
              .replace(/([{,]\s*)'([^']+)':/g, '$1"$2":') // Convert single quotes to double quotes for property names
              .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
              .replace(/\n/g, ' ') // Replace newlines with spaces
              .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
              .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert single quoted values to double quotes
              .replace(/([{,]\s*)"([^"]+)":\s*"([^"]*)"/g, '$1"$2":"$3"') // Normalize spacing around colons
              .trim();

            try {
              parsedContent = JSON.parse(cleanedJson);
            } catch (parseError) {
              console.error('[Perplexity] Failed to parse cleaned JSON:', parseError);
              continue;
            }
          }
          
          // Validate the structure
          if (!parsedContent.activities) {
            // Try to extract activities from schedule structure
            if (parsedContent.schedule?.[0]?.activities) {
              parsedContent = {
                activities: parsedContent.schedule[0].activities
              };
            } else if (Array.isArray(parsedContent.schedule)) {
              parsedContent = {
                activities: parsedContent.schedule
              };
            } else {
              logger.error('[Perplexity] Invalid response structure:', parsedContent);
              continue;
            }
          }

          if (!Array.isArray(parsedContent.activities)) {
            logger.error('[Perplexity] Activities is not an array:', parsedContent.activities);
            continue;
          }

          // Add valid activities to the collection
          const validActivities = parsedContent.activities.filter(activity => 
            activity && 
            activity.name &&
            activity.category &&
            activity.timeSlot
          );

          if (validActivities.length === 0) {
            logger.warn('[Perplexity] No valid activities found in response');
            continue;
          }

          logger.info('[Perplexity] Found valid activities:', {
            count: validActivities.length,
            categories: validActivities.map(a => a.category)
          });

          allActivities = [...allActivities, ...validActivities.map((activity: ViatorActivity) => ({
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
          .replace(/([{,]\s*)'([^']+)':/g, '$1"$2":') // Convert single quotes to double quotes for property names
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Ensure property names are quoted
          .replace(/\n/g, ' ') // Replace newlines with spaces
          .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
          .replace(/:\s*'([^']*?)'/g, ':"$1"') // Convert single quoted values to double quotes
          .replace(/([{,]\s*)"([^"]+)":\s*"([^"]*)"/g, '$1"$2":"$3"') // Normalize spacing around colons
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
          .sort((a, b) => (b.preferenceScore - a.preferenceScore) || ((b.rating || 0) - (a.rating || 0)));
        
        if (categoryActivities.length > 0) {
          selectedActivities.push(categoryActivities[0]);
        }
      });

      // If we don't have minimum activities yet, add more based on score
      while (selectedActivities.length < minActivitiesPerDay && scoredActivities.length > selectedActivities.length) {
        const remainingActivities = scoredActivities
          .filter(a => !selectedActivities.includes(a))
          .sort((a, b) => (b.preferenceScore - a.preferenceScore) || ((b.rating || 0) - (a.rating || 0)));

        if (remainingActivities.length > 0) {
          selectedActivities.push(remainingActivities[0]);
        } else {
          break;
        }
      }

      // Try to distribute activities across time slots if possible
      const timeSlots = ['morning', 'afternoon', 'evening'];
      const activitiesByTimeSlot = new Map<string, Activity[]>();
      
      selectedActivities.forEach(activity => {
        const slot = activity.timeSlot;
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

      logger.info(`Completed day ${day} processing`, {
        dayNumber: day,
        originalCount: dayActivities.length,
        selectedCount: selectedActivities.length,
        categories: Array.from(categories),
        timeSlots: Array.from(activitiesByTimeSlot.keys())
      });

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
    date: string
  ): Promise<Activity | null> {
    try {
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
          originalDate: date
        });
        
        const nextAvailable = await this.findNextAvailableDate(activity, date);
        
        if (!nextAvailable) {
          logger.warn('No available dates found for activity', {
            name: activity.name,
            originalDate: date
          });
          return null;
        }

        // Re-run enrichment with new date
        return this.enrichActivity(activity, params, nextAvailable.date);
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
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
}

// Create and export a singleton instance
export const perplexityClient = new PerplexityService(); 

const optimizeSchedule = async (activities: any[], days: number, destination: string): Promise<any> => {
  try {
    const query = `Optimize this ${days}-day schedule for ${destination} with these activities:
${activities.map(a => `- ${a.name} (${a.duration || 'N/A'} hours)`).join('\n')}

REQUIREMENTS:
1. Create a balanced schedule across ${days} days
2. Group nearby activities on the same day
3. Consider activity durations and opening hours
4. Allow 2-4 activities per day
5. Mix different types of activities

FOR EACH ACTIVITY PROVIDE:
1. Commentary: Why this activity fits user's interests and schedule (3-4 sentences)
2. Itinerary Highlight: How it connects with other activities that day (2-3 sentences)
3. Scoring Reason: Specific reasons for time slot and day placement

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
  "tripOverview": "overall trip organization logic"
}`;

    const response = await perplexityClient.chat(query);
    
    // Preserve the commentary and highlights when transforming activities
    if (response?.schedule) {
      response.schedule = response.schedule.map((day: any) => ({
        ...day,
        activities: day.activities.map((activity: any) => ({
          ...activity,
          commentary: activity.commentary || `This activity was selected because ${activity.scoringReason}`,
          itineraryHighlight: activity.itineraryHighlight || `Fits well with the day's ${day.dayPlanningLogic}`
        }))
      }));
    }

    return response;
  } catch (error) {
    // ... error handling ...
  }
}; 