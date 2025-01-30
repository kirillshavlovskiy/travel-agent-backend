import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';
export function cleanSimilarActivities(activities) {
    const similarityThreshold = 0.7; // Adjust this value to control sensitivity
    const result = [];
    const processed = new Set();
    for (let i = 0; i < activities.length; i++) {
        if (processed.has(i))
            continue;
        let bestActivity = activities[i];
        let similarIndices = [i];
        // Find similar activities
        for (let j = i + 1; j < activities.length; j++) {
            if (processed.has(j))
                continue;
            const activity1 = activities[i];
            const activity2 = activities[j];
            // Check if activities are similar
            const nameSimilarity = calculateStringSimilarity(activity1.name, activity2.name);
            const sameDayAndTime = activity1.dayNumber === activity2.dayNumber &&
                activity1.timeSlot === activity2.timeSlot;
            const sameLocation = activity1.location === activity2.location;
            const sameCategory = activity1.category === activity2.category;
            if ((nameSimilarity > similarityThreshold || (sameLocation && sameCategory)) && sameDayAndTime) {
                similarIndices.push(j);
                // Update best activity based on rating, reviews, and price
                if (shouldPreferActivity(activity2, bestActivity)) {
                    bestActivity = activity2;
                }
            }
        }
        // Mark all similar activities as processed
        similarIndices.forEach(idx => processed.add(idx));
        result.push(bestActivity);
    }
    return result;
}
function shouldPreferActivity(activity1, activity2) {
    // Prefer activities with significantly better ratings
    if (activity1.rating - activity2.rating > 0.3)
        return true;
    if (activity2.rating - activity1.rating > 0.3)
        return false;
    // If ratings are similar, prefer activities with more reviews
    if (activity1.numberOfReviews > activity2.numberOfReviews * 1.5)
        return true;
    if (activity2.numberOfReviews > activity1.numberOfReviews * 1.5)
        return false;
    // If both rating and reviews are similar, prefer the cheaper option
    return activity1.price < activity2.price;
}
export class PerplexityService {
    constructor() {
        this.apiKey = process.env.PERPLEXITY_API_KEY || '';
        this.baseUrl = 'https://api.perplexity.ai/chat/completions';
        if (!this.apiKey) {
            throw new Error('PERPLEXITY_API_KEY environment variable is required');
        }
    }
    buildActivityQuery(params) {
        return `Create a ${params.days}-day activity plan for ${params.destination} with the following requirements:

BUDGET & QUALITY:
- Daily budget: ${params.budget} ${params.currency} per person
- Minimum rating: 4.0+ stars on Viator
- Must have at least 50 reviews

ACTIVITY CATEGORIES:
- Cultural (museums, churches, historic sites)
- Outdoor (parks, walking tours, nature)
- Entertainment (shows, performances)
- Food & Drink (tastings, dining experiences)
- Shopping (markets, shopping areas)
- Adventure (sports, active experiences)

GEOGRAPHIC OPTIMIZATION:
- Group activities in the same area for each day
- Plan routes to minimize travel time between activities
- Consider main tourist areas and attractions
- Include both central locations and notable surrounding areas
- Account for public transportation and walking distances

TIME SLOTS:
- Morning (9:00-13:00): Prefer cultural & outdoor activities
- Afternoon (14:00-18:00): Prefer shopping & adventure activities
- Evening (19:00-23:00): Prefer food & entertainment activities

BALANCE REQUIREMENTS:
- Maximum 2 museums or similar attractions per day
- At least 1 outdoor activity per day
- Mix food experiences between lunches and dinners
- Include at least:
  * 2 walking tours to explore different areas
  * 2 food/culinary experiences
  * 1 cultural performance or show
  * 1 iconic landmark or attraction visit
  * 1 local experience (cooking class, workshop, or similar)

OUTPUT FORMAT:
Return a JSON array of activities, each with:
{
  "name": "EXACT Viator activity name",
  "timeSlot": "morning|afternoon|evening",
  "category": "Cultural|Outdoor|Entertainment|Food & Drink|Shopping|Adventure",
  "dayNumber": 1-${params.days},
  "expectedDuration": "in minutes",
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

Return ONLY a valid JSON array of activities.`;
    }
    async generateActivities(params) {
        try {
            logger.info('Received activity generation request', params);
            const query = this.buildActivityQuery(params);
            logger.debug('Sending query to Perplexity API', { query });
            const response = await axios.post(this.baseUrl, {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful travel planning assistant specialized in creating detailed activity itineraries using Viator activities.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ],
                temperature: 0.1,
                max_tokens: 4000
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.data || !response.data.choices || !response.data.choices[0]?.message?.content) {
                logger.error('Invalid response from Perplexity API', response.data);
                throw new Error('Invalid response format from Perplexity API');
            }
            const content = response.data.choices[0].message.content;
            try {
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed : parsed.activities || [];
            }
            catch (error) {
                logger.error('Failed to parse Perplexity response', { content, error });
                throw new Error('Invalid JSON response from Perplexity');
            }
        }
        catch (error) {
            logger.error('Failed to generate activities', error);
            if (axios.isAxiosError(error)) {
                logger.error('Axios error details:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    url: error.config?.url,
                    method: error.config?.method
                });
                throw new Error(`API request failed: ${error.response?.status} ${error.response?.statusText}`);
            }
            throw error;
        }
    }
    // For initial activity planning - uses sonar-pro model
    async chat(query, options) {
        try {
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            // Extract destination and days from query
            const destination = query.match(/in\s+([^,\n]+)/)?.[1] || '';
            const days = query.match(/(\d+)-day activity plan/)?.[1] || '7';
            const numDays = parseInt(days, 10);
            const chunks = Math.ceil(numDays / 3);
            let allActivities = [];
            for (let chunk = 0; chunk < chunks; chunk++) {
                const startDay = chunk * 3 + 1;
                const endDay = Math.min(startDay + 2, numDays);
                const chunkQuery = query.replace(/Generate a \d+-day activity plan/, `Generate activities for days ${startDay} to ${endDay}`);
                console.log('[Perplexity] Sending request with model: sonar-pro');
                const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                    model: 'sonar-pro',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a travel activity expert who helps plan detailed itineraries. Search for activities ONLY on Viator.com.

BUDGET & QUALITY:
- Respect the daily budget per person
- Minimum rating: 4.0+ stars on Viator
- Must have at least 50 reviews

ACTIVITY CATEGORIES:
- Cultural & Historical (museums, palaces, monuments, archaeological sites, historical tours)
- Arts & Entertainment (theaters, concerts, shows, galleries, performances, cinema)
- Food & Culinary (food tours, cooking classes, wine tastings, gourmet experiences)
- Nature & Wildlife (national parks, gardens, wildlife tours, bird watching, safaris)
- Adventure & Sports (hiking, biking, kayaking, climbing, skiing, surfing)
- Water Activities (cruises, boat tours, snorkeling, diving, beach activities)
- Wellness & Relaxation (spa treatments, yoga classes, thermal baths, meditation)
- Photography & Art (photo tours, art walks, workshops, studio visits)
- Local Experiences (traditional crafts, local markets, community visits)
- Family & Kids (theme parks, interactive museums, family-friendly tours)
- Nightlife & Evening (pub crawls, night tours, sunset cruises, evening shows)
- Religious & Spiritual (temples, churches, spiritual sites, pilgrimages)
- Shopping & Fashion (boutique tours, fashion districts, artisan markets)
- Educational & Workshop (language classes, craft workshops, educational tours)
- Seasonal & Festival (holiday events, cultural festivals, seasonal activities)

GEOGRAPHIC OPTIMIZATION:
- Group activities in the same area for each day
- Plan routes to minimize travel time between activities
- Consider main tourist areas and attractions
- Include both central locations and notable surrounding areas
- Account for public transportation and walking distances

TIME SLOTS:
- Morning (9:00-13:00): Prefer cultural & outdoor activities
- Afternoon (14:00-18:00): Prefer shopping & adventure activities
- Evening (19:00-23:00): Prefer food & entertainment activities

BALANCE REQUIREMENTS:
- Maximum 2 museums or similar attractions per day
- At least 1 outdoor activity per day
- Mix food experiences between lunches and dinners
- Balance activities across different categories
- Include local specialties and unique experiences for the destination
- Consider the destination's most popular and highly-rated activities

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

Return ONLY a valid JSON object without any explanatory text or markdown formatting, following this structure:
{
  "activities": [
    {
      "name": "EXACT name from Viator listing",
      "description": "EXACT description from Viator",
      "duration": hours (number),
      "price": exact price in USD (number),
      "category": "Cultural|Outdoor|Entertainment|Food & Drink|Shopping|Adventure",
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
                            content: chunkQuery
                        }
                    ],
                    temperature: options?.temperature ?? 0.1,
                    max_tokens: options?.max_tokens ?? 2000,
                    web_search: true
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                console.log('[Perplexity] Raw response:', JSON.stringify(response.data, null, 2));
                // Extract JSON content from the response
                const content = response.data.choices[0].message.content;
                console.log('[Perplexity] Content to parse:', content);
                try {
                    // First try to parse the content directly
                    let parsedContent;
                    try {
                        parsedContent = JSON.parse(content);
                    }
                    catch (e) {
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
                        }
                        catch (parseError) {
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
                    allActivities = [...allActivities, ...parsedContent.activities.map((activity) => ({
                            ...activity,
                            selected: false
                        }))];
                }
                catch (e) {
                    console.error('[Perplexity] Failed to parse response:', e);
                    continue;
                }
            }
            // Return all collected activities
            return {
                activities: allActivities
            };
        }
        catch (error) {
            console.error('[Perplexity] Error calling API:', error.response?.data || error);
            const errorResponse = {
                error: 'Failed to call Perplexity API'
            };
            throw errorResponse;
        }
    }
    // For individual activity details - uses sonar model
    async getEnrichedDetails(query) {
        try {
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
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
      "category": "Cultural" or "Adventure" or "Food" or "Nature" or "Entertainment" or "Shopping" or "Relaxation",
      "location": "EXACT location name from Viator",
      "address": "EXACT address from Viator",
      "keyHighlights": ["EXACT highlights from Viator listing"],
      "openingHours": "EXACT operating hours from Viator",
      "rating": exact Viator rating (number),
      "numberOfReviews": exact number of Viator reviews,
      "preferredTimeOfDay": "morning" or "afternoon" or "evening",
      "referenceUrl": "EXACT Viator booking URL",
      "images": ["EXACT image URLs from Viator"],
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
            // Parse the response text as JSON
            const content = response.data.choices[0].message.content;
            try {
                return JSON.parse(content);
            }
            catch (e) {
                console.error('Failed to parse Perplexity response:', e);
                // If parsing fails, return a structured response with just the text
                return {
                    text: content,
                    error: 'Failed to parse activity data'
                };
            }
        }
        catch (error) {
            console.error('Error calling Perplexity API:', error);
            throw error;
        }
    }
}
// Create and export a singleton instance
export const perplexityClient = new PerplexityService();
