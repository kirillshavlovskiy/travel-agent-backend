import axios from 'axios';
import { calculateStringSimilarity } from '../utils/string';
import { logger } from '../utils/logger';
import { ACTIVITY_CATEGORIES, normalizeCategory } from '../constants/categories.js';
const PRICE_TIERS = ['budget', 'medium', 'premium'];
function determinePriceTier(price) {
    const amount = typeof price === 'number' ? price : price?.amount || 0;
    if (amount <= 50)
        return 'budget';
    if (amount <= 150)
        return 'medium';
    return 'premium';
}
function calculateDistribution(activities) {
    const distribution = {};
    const totalActivities = activities.length;
    // Initialize distribution object
    ACTIVITY_CATEGORIES.forEach((category) => {
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
    activities.forEach((activity) => {
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
function balanceActivities(activities) {
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
    }, {});
    // Balance activities
    const balancedActivities = [];
    // First pass: ensure minimum representation for each category
    ACTIVITY_CATEGORIES.forEach((category) => {
        const categoryActivities = groupedActivities[category.name] || { budget: [], medium: [], premium: [] };
        const totalInCategory = Object.values(categoryActivities).flat().length;
        if (totalInCategory > targetPerCategory) {
            // Remove excess activities, preferring to keep higher rated ones
            const allCategoryActivities = Object.values(categoryActivities).flat()
                .sort((a, b) => (b.rating || 0) - (a.rating || 0));
            balancedActivities.push(...allCategoryActivities.slice(0, targetPerCategory));
        }
        else {
            // Keep all activities in this category
            balancedActivities.push(...Object.values(categoryActivities).flat());
        }
    });
    return balancedActivities;
}
const cleanSimilarActivities = (activities) => {
    logger.info('[Duplicate Cleaning] Starting process', {
        totalActivities: activities.length
    });
    const duplicateGroups = new Map();
    // Normalize activity names for comparison
    const normalizeTitle = (title) => {
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
    const cleanedActivities = [];
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
                if ((best.rating || 0) === 0 && (current.rating || 0) > 0)
                    return current;
                if ((current.rating || 0) === 0 && (best.rating || 0) > 0)
                    return best;
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
        }
        else {
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
function getTimeSlotValue(timeSlot) {
    switch (timeSlot.toLowerCase()) {
        case 'morning': return 0;
        case 'afternoon': return 1;
        case 'evening': return 2;
        default: return -1;
    }
}
function shouldPreferActivity(activity1, activity2) {
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
function countCategories(activities) {
    return activities.reduce((acc, activity) => {
        acc[activity.category] = (acc[activity.category] || 0) + 1;
        return acc;
    }, {});
}
export class PerplexityService {
    constructor() {
        this.apiKey = process.env.PERPLEXITY_API_KEY || '';
        this.baseUrl = 'https://api.perplexity.ai/chat/completions';
        if (!this.apiKey) {
            throw new Error('PERPLEXITY_API_KEY environment variable is required');
        }
    }
    handleApiError(error) {
        const apiError = error;
        logger.error('API Error:', {
            message: apiError.message,
            details: apiError.response
        });
        throw this.handleApiError(error);
    }
    validateTimeSlot(timeSlot) {
        const validTimeSlots = ['morning', 'afternoon', 'evening'];
        const normalizedSlot = timeSlot.toLowerCase();
        return validTimeSlots.includes(normalizedSlot) ? normalizedSlot : 'afternoon';
    }
    handleTimeSlotData(timeSlots) {
        return Object.entries(timeSlots).flatMap(([slot, data]) => {
            const validSlot = this.validateTimeSlot(slot);
            return data.activities.map(activity => ({
                ...activity,
                timeSlot: validSlot
            }));
        });
    }
    async enrichActivityResponse(activity) {
        return {
            id: crypto.randomUUID(),
            model: 'sonar',
            created: Date.now(),
            choices: [{
                    message: {
                        content: JSON.stringify({
                            activities: [activity]
                        })
                    }
                }],
            activities: [activity]
        };
    }
    buildActivityQuery(params) {
        // Simplified prompt to reduce token count and processing time
        return `Suggest activities in ${params.destination} for a ${params.days}-day trip.
Budget: ${params.budget} ${params.currency} per day
Style: ${params.preferences.travelStyle}
Interests: ${params.preferences.interests.join(', ')}

Rules:
1. Only include real activities from Viator
2. Mix different activity types
3. Consider budget constraints
4. Group by area to minimize travel

Return JSON array:
[{
  "name": "exact Viator activity name",
  "description": "brief description",
  "duration": number (hours),
  "price": number,
  "category": "activity category",
  "location": "area/neighborhood",
  "timeSlot": "morning|afternoon|evening",
  "dayNumber": number
}]`;
    }
    async makePerplexityRequests(query) {
        const maxRetries = 3;
        const baseDelay = 2000;
        const timeout = 30000;
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info(`[Perplexity] Making API request - Attempt ${attempt}/${maxRetries}`, {
                    queryLength: query.length,
                    isEnrichmentQuery: query.includes('Provide details for')
                });
                const response = await axios.post(this.baseUrl, {
                    model: 'sonar',
                    messages: [
                        {
                            role: 'system',
                            content: 'Return only valid JSON arrays of activities.'
                        },
                        {
                            role: 'user',
                            content: query
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 1000,
                    web_search: false
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout,
                    validateStatus: (status) => status === 200
                });
                logger.debug('[Perplexity] Raw API response:', {
                    status: response.status,
                    hasChoices: !!response.data?.choices,
                    contentLength: response.data?.choices?.[0]?.message?.content?.length
                });
                const content = response.data?.choices?.[0]?.message?.content;
                if (!content || typeof content !== 'string') {
                    throw new Error('Invalid response structure');
                }
                logger.debug('[Perplexity] Response content:', {
                    content: content.substring(0, 200) + '...',
                    isEnrichmentQuery: query.includes('Provide details for')
                });
                const activities = this.parseActivitiesFromContent(content);
                if (!Array.isArray(activities) || activities.length === 0) {
                    throw new Error('No valid activities found in response');
                }
                logger.info('[Perplexity] Successfully parsed activities', {
                    count: activities.length,
                    isEnrichmentQuery: query.includes('Provide details for')
                });
                return activities;
            }
            catch (error) {
                lastError = error;
                const status = lastError.response?.status;
                const isTimeout = status === 524 || lastError.code === 'ECONNABORTED';
                const shouldRetry = attempt < maxRetries && (isTimeout || status === 429);
                logger.error(`[Perplexity] Request failed:`, {
                    attempt,
                    status,
                    isTimeout,
                    willRetry: shouldRetry,
                    error: lastError.message,
                    isEnrichmentQuery: query.includes('Provide details for'),
                    responseData: lastError.response?.data
                });
                if (!shouldRetry)
                    break;
                const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000) +
                    Math.floor(Math.random() * 1000);
                logger.info(`[Perplexity] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError || new Error('Failed to get activities');
    }
    parseActivitiesFromContent(content) {
        try {
            // First try direct JSON parse
            let activities;
            try {
                const parsed = JSON.parse(content);
                activities = Array.isArray(parsed) ? parsed : parsed.activities || [];
            }
            catch (e) {
                // If direct parse fails, try to extract JSON from markdown
                const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\[([\s\S]*?)\]/) || content.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No JSON content found in response');
                }
                const jsonContent = jsonMatch[1] || jsonMatch[0];
                // Enhanced JSON cleaning with more robust handling
                const cleanedJson = jsonContent
                    .replace(/[\u0000-\u001F]+/g, '') // Remove control characters
                    .replace(/,(\s*[}\]])/g, '$1') // Fix trailing commas
                    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3') // Convert single quoted property names to double quotes
                    .replace(/([{,]\s*)(\w+)(?=\s*:)/g, '$1"$2"') // Quote unquoted property names
                    .replace(/:\s*'([^']*)'/g, ':"$1"') // Convert single quoted values to double quotes
                    .replace(/`([^`]*)`/g, '"$1"') // Convert backtick quotes to double quotes
                    .replace(/\n/g, ' ') // Remove newlines
                    .replace(/\\"/g, '"') // Fix escaped quotes
                    .replace(/"{2,}/g, '"') // Fix multiple consecutive quotes
                    .replace(/(?<=:)\s*"(\d+(?:\.\d+)?)"(?=\s*[,}])/g, '$1') // Convert quoted numbers back to numbers
                    .trim();
                logger.debug('[Activity Generation] Attempting to parse cleaned JSON:', { cleanedJson });
                const parsed = JSON.parse(cleanedJson);
                activities = Array.isArray(parsed) ? parsed : parsed.activities || [];
            }
            // Normalize and validate each activity
            return activities.map(activity => ({
                name: activity.name || '',
                description: activity.description || '',
                timeSlot: activity.timeSlot?.split('|')[0] || 'afternoon',
                category: activity.category?.split('|')[0] || 'Cultural',
                dayNumber: activity.dayNumber || 1,
                duration: typeof activity.duration === 'number' ? activity.duration : 2,
                selected: false,
                location: activity.location || '',
                rating: activity.rating,
                numberOfReviews: activity.numberOfReviews,
                price: activity.price,
                address: activity.address,
                images: activity.images,
                referenceUrl: activity.referenceUrl,
                bookingInfo: activity.bookingInfo,
                commentary: activity.commentary || '',
                itineraryHighlight: activity.itineraryHighlight || ''
            }));
        }
        catch (error) {
            const parseError = error;
            logger.error('Failed to parse activities from content:', parseError);
            throw new Error('Invalid activity data format');
        }
    }
    async generateActivities(params) {
        try {
            logger.info('[Activity Generation] Starting', {
                destination: params.destination,
                days: params.days
            });
            // Phase 1: Get basic activity list with minimal details
            const activitiesPerDay = 4; // Target 4 activities per day
            const totalActivities = params.days * activitiesPerDay;
            const initialQuery = `List exactly ${totalActivities} popular activities in ${params.destination} suitable for a ${params.days}-day trip.
Budget: ${params.budget} ${params.currency} per day
Style: ${params.preferences.travelStyle}
Interests: ${params.preferences.interests.join(', ')}

Rules:
1. Must return exactly ${totalActivities} activities
2. Only include real activities from Viator
3. Mix different activity types (cultural, adventure, food, etc.)
4. Consider budget constraints
5. Group by area to minimize travel
6. Include a mix of morning, afternoon, and evening activities
7. Ensure activities are available and bookable

Return JSON array:
[{
  "name": "exact Viator activity name",
  "description": "brief description",
  "duration": number (hours),
  "price": number,
  "category": "activity category",
  "location": "area/neighborhood",
  "timeSlot": "morning|afternoon|evening",
  "dayNumber": number
}]`;
            const basicActivities = await this.makePerplexityRequests(initialQuery);
            // Keep all activities that were successfully retrieved
            logger.info(`[Activity Generation] Retrieved ${basicActivities.length} basic activities`);
            // Phase 2: Enrich activities - attempt to enrich all activities
            const enrichedActivities = [];
            for (const activity of basicActivities) {
                try {
                    const enrichedActivity = await this.enrichBasicActivity(activity, params);
                    if (enrichedActivity) {
                        enrichedActivities.push(enrichedActivity);
                    }
                }
                catch (error) {
                    logger.warn(`Failed to enrich activity ${activity.name}`, {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                    // Keep the basic activity even if enrichment fails
                    enrichedActivities.push({
                        ...activity,
                        selected: false,
                        timeSlot: this.validateTimeSlot('afternoon'),
                        commentary: activity.description || ''
                    });
                }
            }
            logger.info(`[Activity Generation] Successfully enriched ${enrichedActivities.length} activities`);
            // Generate trip-level summary and planning logic
            const tripSummary = await this.generateTripSummary(enrichedActivities, params);
            // Group activities by day
            const activitiesByDay = enrichedActivities.reduce((acc, activity) => {
                acc[activity.dayNumber] = acc[activity.dayNumber] || [];
                acc[activity.dayNumber].push(activity);
                return acc;
            }, {});
            // Generate day-level planning logic and enrich activities with context
            const dayPlans = await Promise.all(Object.entries(activitiesByDay).map(async ([dayNumber, activities]) => {
                const planning = await this.generateDayPlanning(activities, parseInt(dayNumber), params);
                const enrichedDayActivities = await Promise.all(activities.map(activity => this.enrichActivityWithContext(activity, activities, params)));
                return {
                    dayNumber: parseInt(dayNumber),
                    planning,
                    activities: enrichedDayActivities
                };
            }));
            return {
                tripSummary,
                dayPlans,
                activities: enrichedActivities,
                metadata: {
                    originalCount: basicActivities.length,
                    finalCount: enrichedActivities.length,
                    daysPlanned: params.days,
                    destination: params.destination
                }
            };
        }
        catch (error) {
            const err = error;
            logger.error('[Activity Generation] Failed', {
                error: err.message,
                stack: err.stack
            });
            throw err;
        }
    }
    async enrichBasicActivity(activity, params) {
        try {
            logger.info('[Activity Enrichment] Starting enrichment for activity', {
                activityName: activity.name,
                currentTimeSlot: activity.timeSlot,
                category: activity.category
            });
            const enrichmentQuery = `Provide details for "${activity.name}" in ${params.destination}:
- Estimated price range
- Best time to visit (morning/afternoon/evening)
- Location/area
- Brief description

Return as JSON with these fields only.`;
            logger.debug('[Activity Enrichment] Sending enrichment query', {
                query: enrichmentQuery,
                destination: params.destination
            });
            const enrichedData = await this.makePerplexityRequests(enrichmentQuery);
            logger.debug('[Activity Enrichment] Received enriched data', {
                activityName: activity.name,
                rawData: enrichedData,
                dataLength: enrichedData?.length
            });
            if (!enrichedData?.[0]) {
                logger.warn('[Activity Enrichment] No enriched data received', {
                    activityName: activity.name
                });
                // If enrichment fails, return the basic activity with defaults
                const defaultActivity = {
                    ...activity,
                    selected: false,
                    timeSlot: this.validateTimeSlot('afternoon'),
                    commentary: activity.description || ''
                };
                logger.info('[Activity Enrichment] Returning default activity data', {
                    activityName: activity.name,
                    timeSlot: defaultActivity.timeSlot
                });
                return defaultActivity;
            }
            const bestTimeToVisit = enrichedData[0].bestTimeToVisit || 'afternoon';
            logger.debug('[Activity Enrichment] Processing enriched data', {
                activityName: activity.name,
                bestTimeToVisit,
                enrichedFields: Object.keys(enrichedData[0])
            });
            const enrichedActivity = {
                ...activity,
                ...enrichedData[0],
                selected: false,
                timeSlot: this.validateTimeSlot(bestTimeToVisit),
                commentary: enrichedData[0].description || activity.description || ''
            };
            logger.info('[Activity Enrichment] Successfully enriched activity', {
                activityName: activity.name,
                finalTimeSlot: enrichedActivity.timeSlot,
                hasDescription: !!enrichedActivity.description,
                hasCommentary: !!enrichedActivity.commentary
            });
            return enrichedActivity;
        }
        catch (error) {
            logger.error('[Activity Enrichment] Failed to enrich activity', {
                activityName: activity.name,
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : 'Unknown error',
                response: error instanceof Error && 'response' in error ? {
                    status: error.response?.status,
                    data: error.response?.data
                } : undefined
            });
            // Return the basic activity with defaults if enrichment fails
            const fallbackActivity = {
                ...activity,
                selected: false,
                timeSlot: this.validateTimeSlot('afternoon'),
                commentary: activity.description || ''
            };
            logger.info('[Activity Enrichment] Returning fallback activity data', {
                activityName: activity.name,
                timeSlot: fallbackActivity.timeSlot
            });
            return fallbackActivity;
        }
    }
    // For initial activity planning - uses sonar model
    async chat(query, options) {
        const maxRetries = 3;
        const baseDelay = 2000;
        const timeout = 30000; // Increased timeout to 30 seconds
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!this.apiKey) {
                    throw new Error('Perplexity API key is not configured');
                }
                logger.info('[Perplexity] Sending request', {
                    attempt,
                    maxRetries,
                    timeout,
                    queryLength: query.length,
                    isScheduling: query.includes('schedule these activities')
                });
                const response = await axios.post(this.baseUrl, {
                    model: 'sonar',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a travel activity expert. Return only basic activity details in JSON format.'
                        },
                        {
                            role: 'user',
                            content: query
                        }
                    ],
                    temperature: options?.temperature ?? 0.3,
                    max_tokens: options?.max_tokens ?? 1000,
                    web_search: false
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout
                });
                logger.debug('[Perplexity] Raw response received', {
                    status: response.status,
                    hasChoices: !!response.data?.choices,
                    contentLength: response.data?.choices?.[0]?.message?.content?.length
                });
                const content = response.data.choices[0].message.content;
                try {
                    // Extract JSON from the content
                    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\[([\s\S]*?)\]/) || content.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) {
                        throw new Error('No JSON content found in response');
                    }
                    const jsonContent = jsonMatch[1] || jsonMatch[0];
                    const cleanedJson = jsonContent
                        .replace(/[\u0000-\u001F]+/g, '')
                        .replace(/,(\s*[}\]])/g, '$1')
                        .replace(/([{,]\s*)(\w+)(?=\s*:)/g, '$1"$2":')
                        .replace(/:\s*'([^']*)'/g, ':"$1"')
                        .replace(/`/g, '"')
                        .replace(/\n/g, ' ')
                        .trim();
                    logger.debug('[Perplexity] Attempting to parse JSON', {
                        jsonLength: cleanedJson.length,
                        sample: cleanedJson.substring(0, 100)
                    });
                    const parsedContent = JSON.parse(cleanedJson);
                    const activities = Array.isArray(parsedContent) ? parsedContent : parsedContent.activities || [];
                    logger.info('[Perplexity] Successfully parsed activities', {
                        count: activities.length,
                        attempt
                    });
                    return {
                        activities: activities.map((activity) => ({
                            ...activity,
                            selected: false,
                            timeSlot: activity.timeSlot || 'afternoon',
                            category: activity.category || 'Cultural',
                            dayNumber: activity.dayNumber || 1
                        }))
                    };
                }
                catch (parseError) {
                    logger.error('[Perplexity] Failed to parse response', {
                        error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
                        content: content.substring(0, 200)
                    });
                    throw new Error('Failed to parse Perplexity response');
                }
            }
            catch (error) {
                const apiError = error;
                const status = apiError.response?.status;
                const isTimeout = status === 524 || apiError.code === 'ECONNABORTED';
                const shouldRetry = attempt < maxRetries && (isTimeout || status === 429);
                logger.error('[Perplexity] Request failed', {
                    attempt,
                    error: apiError.message,
                    status,
                    isTimeout,
                    willRetry: shouldRetry
                });
                lastError = apiError;
                if (!shouldRetry)
                    break;
                const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000) +
                    Math.floor(Math.random() * 1000);
                logger.info(`[Perplexity] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Failed to call Perplexity API: ' + (lastError?.message || 'Unknown error'));
    }
    // For individual activity details - uses sonar model
    async getEnrichedDetails(query, userPreferences, date) {
        try {
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            logger.info('[Enrichment] Starting activity enrichment');
            const systemPrompt = `You are a travel activity expert. Provide only basic activity details.

Return JSON:
{
  "activities": [{
    "name": "activity name",
    "location": "specific area/address",
    "timeSlot": "morning|afternoon|evening",
    "operatingHours": "opening hours"
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
                        content: query
                    }
                ],
                temperature: 0.3,
                max_tokens: 1000,
                web_search: false
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });
            const content = response.data.choices[0].message.content;
            logger.debug('[Enrichment] Raw content received:', { contentLength: content.length });
            try {
                // First try to parse the content directly
                let enrichedData;
                try {
                    enrichedData = JSON.parse(content);
                }
                catch (e) {
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
            }
            catch (e) {
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
        }
        catch (error) {
            logger.error('[Enrichment] Error during enrichment', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async cleanAndBalanceActivities(activities, params) {
        try {
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
            }, {});
            // Calculate time slots based on pace preference
            const timeSlotConfigs = {
                'relaxed': {
                    morning: { start: '10:00', end: '13:00', maxActivities: 1 },
                    afternoon: { start: '14:30', end: '17:30', maxActivities: 1 },
                    evening: { start: '19:00', end: '22:00', maxActivities: 1 }
                },
                'moderate': {
                    morning: { start: '09:00', end: '13:00', maxActivities: 2 },
                    afternoon: { start: '14:00', end: '18:00', maxActivities: 2 },
                    evening: { start: '18:30', end: '22:00', maxActivities: 1 }
                },
                'intensive': {
                    morning: { start: '08:00', end: '13:00', maxActivities: 2 },
                    afternoon: { start: '13:30', end: '18:00', maxActivities: 2 },
                    evening: { start: '18:30', end: '22:30', maxActivities: 2 }
                }
            };
            const timeSlotConfig = timeSlotConfigs[preferences.pacePreference] || timeSlotConfigs.moderate;
            // Process each day's activities
            const balancedActivities = await Promise.all(Object.entries(activitiesByDay).map(async ([day, dayActivities]) => {
                logger.info(`Processing day ${day}`, {
                    dayNumber: day,
                    activitiesCount: dayActivities.length
                });
                // Score activities based on preferences and constraints
                const scoredActivities = dayActivities.map(activity => {
                    let score = 0;
                    // Base score for all activities
                    score += 1;
                    // Score based on matching interests
                    preferences.interests.forEach(interest => {
                        if (activity.commentary?.toLowerCase().includes(interest.toLowerCase()) ||
                            activity.description?.toLowerCase().includes(interest.toLowerCase())) {
                            score += 0.5;
                        }
                    });
                    // Score based on travel style match
                    if (activity.tier?.toLowerCase() === preferences.travelStyle.toLowerCase()) {
                        score += 0.5;
                    }
                    // Score based on rating
                    if (activity.rating && activity.rating >= 4.0) {
                        score += 1;
                    }
                    // Adjust score based on activity duration
                    const duration = typeof activity.duration === 'number' ? activity.duration : 2;
                    if (duration <= 2)
                        score += 0.3; // Prefer shorter activities for flexibility
                    if (duration > 4)
                        score -= 0.3; // Penalize very long activities
                    return { ...activity, preferenceScore: score, duration };
                });
                // Sort activities by score
                const sortedActivities = scoredActivities.sort((a, b) => b.preferenceScore - a.preferenceScore);
                // Initialize time slots for the day
                const timeSlots = {
                    morning: { activities: [], remainingTime: 4 * 60 },
                    afternoon: { activities: [], remainingTime: 4 * 60 },
                    evening: { activities: [], remainingTime: 3 * 60 }
                };
                // Helper function to check if activity fits in time slot
                const activityFitsTimeSlot = (activity, slot) => {
                    const slotConfig = timeSlotConfig[slot];
                    return timeSlots[slot].remainingTime >= activity.duration * 60 &&
                        timeSlots[slot].activities.length < slotConfig.maxActivities;
                };
                // First pass: Allocate activities to their preferred time slots
                for (const activity of sortedActivities) {
                    const preferredSlot = activity.timeSlot;
                    if (activityFitsTimeSlot(activity, preferredSlot)) {
                        timeSlots[preferredSlot].activities.push(activity);
                        timeSlots[preferredSlot].remainingTime -= activity.duration * 60;
                    }
                }
                // Second pass: Reallocate activities that didn't fit their preferred slots
                const unallocatedActivities = sortedActivities.filter(activity => !Object.values(timeSlots).some(slot => slot.activities.includes(activity)));
                for (const activity of unallocatedActivities) {
                    // Try to find the best alternative time slot
                    const availableSlots = Object.entries(timeSlots)
                        .filter(([slot]) => activityFitsTimeSlot(activity, slot))
                        .sort(([, a], [, b]) => b.remainingTime - a.remainingTime);
                    if (availableSlots.length > 0) {
                        const [bestSlot] = availableSlots;
                        activity.timeSlot = bestSlot;
                        timeSlots[bestSlot].activities.push(activity);
                        timeSlots[bestSlot].remainingTime -= activity.duration * 60;
                    }
                }
                // Combine all allocated activities
                const allocatedActivities = Object.entries(timeSlots)
                    .flatMap(([slot, data]) => data.activities.map(activity => ({
                    ...activity,
                    timeSlot: slot,
                    startTime: timeSlotConfig[slot].start
                })));
                logger.info(`Completed day ${day} processing`, {
                    dayNumber: day,
                    originalCount: dayActivities.length,
                    allocatedCount: allocatedActivities.length,
                    byTimeSlot: Object.fromEntries(Object.entries(timeSlots).map(([slot, data]) => [
                        slot,
                        { count: data.activities.length, remainingTime: data.remainingTime }
                    ]))
                });
                return allocatedActivities;
            }));
            const finalActivities = balancedActivities.flat();
            logger.info('Completed activity balancing', {
                originalCount: activities.length,
                finalCount: finalActivities.length,
                daysProcessed: Object.keys(activitiesByDay).length,
                averagePerDay: finalActivities.length / Object.keys(activitiesByDay).length
            });
            return finalActivities;
        }
        catch (err) {
            const error = err;
            logger.error('Failed to balance activities', {
                message: error.message || 'Unknown error',
                stack: error.stack,
                responseData: error.response?.data
            });
            throw error;
        }
    }
    getMatchedPreferences(activity, preferences) {
        const matchedPrefs = [];
        // Check interests
        preferences.interests.forEach(interest => {
            if (activity.commentary?.toLowerCase().includes(interest.toLowerCase()) ||
                activity.description?.toLowerCase().includes(interest.toLowerCase())) {
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
    ensurePreferenceReferences(text, preferences, isItineraryHighlight = false) {
        if (!text)
            return '';
        // If the text already mentions preferences, return it
        const hasPreferences = preferences.interests.some(interest => text.toLowerCase().includes(interest.toLowerCase()));
        if (hasPreferences)
            return text;
        // Add preference context if missing
        const relevantPreferences = this.getRelevantPreferences(preferences);
        if (isItineraryHighlight) {
            return `${text} This timing aligns well with your ${preferences.pacePreference} pace preference${relevantPreferences ? ` and accommodates ${relevantPreferences}` : ''}.`;
        }
        else {
            return `${text} This activity particularly suits your interests in ${relevantPreferences || 'the selected preferences'}.`;
        }
    }
    getRelevantPreferences(preferences) {
        const parts = [];
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
    getDateForActivity(dayNumber, params) {
        const startDate = new Date(params.flightTimes?.arrival || Date.now());
        const activityDate = new Date(startDate);
        activityDate.setDate(startDate.getDate() + (dayNumber - 1));
        return activityDate.toISOString().split('T')[0];
    }
    determineOptimalTimeSlot(activity, verification, pacePreference) {
        if (!verification)
            return activity.timeSlot;
        // If the recommended slot is available, use it
        if (verification.recommendedTimeSlot &&
            verification.availableTimeSlots?.includes(verification.recommendedTimeSlot)) {
            return verification.recommendedTimeSlot;
        }
        // If the current slot is available, keep it
        if (verification.availableTimeSlots?.includes(activity.timeSlot)) {
            return activity.timeSlot;
        }
        // Otherwise, pick the first available slot
        return verification.availableTimeSlots?.[0] || activity.timeSlot;
    }
    generateDayHighlights(activities) {
        const dayHighlights = [];
        const activitiesByDay = new Map();
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
                return timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
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
    getMostFrequentCategory(categories) {
        const categoryCounts = categories.reduce((acc, category) => {
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(categoryCounts)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || 'Mixed Activities';
    }
    getDayTheme(mainCategory, activities) {
        const categoryThemes = {
            'Cultural & Historical': 'Historic Exploration',
            'Nature & Adventure': 'Outdoor Adventure',
            'Food & Entertainment': 'Culinary & Culture',
            'Lifestyle & Local': 'Local Experience'
        };
        // Check for special combinations
        const hasEvening = activities.some(a => a.timeSlot === 'evening');
        const hasFood = activities.some(a => a.category === 'Food & Entertainment');
        const hasCultural = activities.some(a => a.category === 'Cultural & Historical');
        if (hasEvening && hasFood)
            return 'Food & Nightlife';
        if (hasCultural && hasFood)
            return 'Culture & Cuisine';
        return categoryThemes[mainCategory] || 'Mixed Activities';
    }
    generateDayHighlightText(activities) {
        const morning = activities.find(a => a.timeSlot === 'morning');
        const afternoon = activities.find(a => a.timeSlot === 'afternoon');
        const evening = activities.find(a => a.timeSlot === 'evening');
        const parts = [];
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
    async generateDailySummaries(activities) {
        logger.info('[Daily Highlights] Starting to generate daily summaries');
        // Group activities by day
        const activitiesByDay = activities.reduce((acc, activity) => {
            acc[activity.dayNumber] = acc[activity.dayNumber] || [];
            acc[activity.dayNumber].push(activity);
            return acc;
        }, {});
        const dailySummaries = [];
        for (const [dayNumber, dayActivities] of Object.entries(activitiesByDay)) {
            try {
                // Sort activities by time slot
                const sortedActivities = dayActivities.sort((a, b) => getTimeSlotValue(a.timeSlot) - getTimeSlotValue(b.timeSlot));
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
                const response = await axios.post(this.baseUrl, {
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
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
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
            }
            catch (error) {
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
    async findNextAvailableDate(activity, originalDate, maxAttempts = 30 // Look up to 30 days ahead
    ) {
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
            }
            catch (error) {
                logger.error('Error checking availability for date:', {
                    date: dateStr,
                    activity: activity.name,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
        return null;
    }
    async enrichActivity(activity, params, date) {
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
            const adjustedTimeSlot = this.determineOptimalTimeSlot(activity, timeSlotVerification, params.preferences.pacePreference);
            return {
                ...activity,
                ...enrichedData.activities[0],
                id: activity.id,
                timeSlot: adjustedTimeSlot,
                date: date,
                matchedPreferences: this.getMatchedPreferences(enrichedData.activities[0], params.preferences),
                commentary: this.ensurePreferenceReferences(enrichedData.activities[0].commentary || activity.commentary, params.preferences),
                itineraryHighlight: this.ensurePreferenceReferences(enrichedData.activities[0].itineraryHighlight || activity.itineraryHighlight, params.preferences, true),
                availability: {
                    isAvailable: true,
                    operatingHours: timeSlotVerification?.operatingHours,
                    availableTimeSlots: timeSlotVerification?.availableTimeSlots || [],
                    bestTimeToVisit: timeSlotVerification?.bestTimeToVisit,
                    nextAvailableDate: date !== enrichedData.activities[0].date ? enrichedData.activities[0].date : undefined
                }
            };
        }
        catch (error) {
            logger.error('Error enriching activity', {
                name: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null;
        }
    }
    processApiError(error) {
        if (error instanceof Error) {
            const apiError = error;
            logger.error('API Error:', {
                message: apiError.message,
                details: apiError.response
            });
            if (apiError.response?.status === 500) {
                throw new Error('API server error: ' + apiError.message);
            }
            throw apiError;
        }
        throw new Error('Unknown API error occurred');
    }
    async generateTripSummary(activities, params) {
        const query = `Analyze this ${params.days}-day trip to ${params.destination}:
${activities.map(a => `Day ${a.dayNumber}: ${a.name} (${a.timeSlot})`).join('\n')}

User Preferences:
- Travel Style: ${params.preferences.travelStyle}
- Pace: ${params.preferences.pacePreference}
- Interests: ${params.preferences.interests.join(', ')}

Provide a comprehensive trip analysis covering:
1. Overall trip flow and progression
2. Daily themes and their rationale
3. Location-based organization strategy
4. Activity category distribution
5. Key highlights and unique experiences

Return as detailed JSON matching the TripSummary interface.`;
        const response = await this.chat(query);
        return response.tripSummary;
    }
    async generateDayPlanning(dayActivities, dayNumber, params) {
        const query = `Analyze Day ${dayNumber} of the ${params.days}-day trip to ${params.destination}:
${dayActivities.map(a => `${a.timeSlot}: ${a.name}`).join('\n')}

User Preferences:
- Travel Style: ${params.preferences.travelStyle}
- Pace: ${params.preferences.pacePreference}
- Interests: ${params.preferences.interests.join(', ')}

Provide detailed planning logic covering:
1. Day theme and rationale
2. Activity flow and timing logic
3. Location-based organization
4. Pace considerations
5. Meal and break suggestions
6. Weather and seasonal factors

Return as detailed JSON matching the DayPlanningLogic interface.`;
        const response = await this.chat(query);
        return response.dayPlanning;
    }
    async enrichActivityWithContext(activity, dayActivities, params) {
        const query = `Analyze this activity in the context of Day ${activity.dayNumber}:
Activity: ${activity.name} (${activity.timeSlot})
Other activities this day:
${dayActivities.filter(a => a.name !== activity.name).map(a => `${a.timeSlot}: ${a.name}`).join('\n')}

User Preferences:
- Travel Style: ${params.preferences.travelStyle}
- Pace: ${params.preferences.pacePreference}
- Interests: ${params.preferences.interests.join(', ')}

Provide detailed commentary on:
1. How this activity fits the day's theme
2. Connection to nearby activities
3. Timing considerations
4. Alternative options
5. Special considerations based on user preferences

Return as JSON with commentary and itineraryHighlight fields.`;
        const response = await this.chat(query);
        return {
            ...activity,
            commentary: response.commentary,
            itineraryHighlight: response.itineraryHighlight
        };
    }
}
// Create and export a singleton instance
export const perplexityClient = new PerplexityService();
function generateSchedulePrompt(activities, preferences) {
    return `Schedule these activities for ${preferences.destination}:
${activities.map(a => `- ${a.name}`).join('\n')}

Return JSON:
{
  "schedule": [{
    "dayNumber": number,
    "activities": [{ "name": string, "timeSlot": "morning|afternoon|evening" }]
  }]
}`;
}
// For schedule optimization - uses sonar model
async function chat(prompt, options = {}) {
    const maxRetries = 3;
    const baseDelay = 2000; // Start with 2 second delay
    const timeout = 15000; // 15 second timeout
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            logger.info('[Perplexity] Sending schedule optimization request', {
                attempt,
                maxRetries
            });
            const response = await axios.post(this.baseUrl, {
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a travel itinerary expert. Return only valid JSON.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: options?.temperature ?? 0.3,
                max_tokens: options?.max_tokens ?? 2000 // Reduced from 4000
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout // Add explicit timeout
            });
            // Check if we got HTML instead of JSON
            const content = response.data?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || content.trim().startsWith('<')) {
                throw new Error('Received HTML response instead of JSON');
            }
            try {
                const parsedContent = JSON.parse(content);
                return parsedContent;
            }
            catch (parseError) {
                logger.error('[Perplexity] Failed to parse schedule response:', {
                    error: parseError,
                    content: content.substring(0, 200) // Log first 200 chars only
                });
                throw new Error('Failed to parse schedule optimization response');
            }
        }
        catch (error) {
            const isTimeout = error.code === 'ECONNABORTED' ||
                error.response?.status === 524 ||
                error.message.includes('timeout');
            const shouldRetry = attempt < maxRetries &&
                (isTimeout || error.response?.status === 429);
            logger.error('[Perplexity] Request failed:', {
                attempt,
                error: error.message,
                status: error.response?.status,
                isTimeout,
                willRetry: shouldRetry
            });
            if (!shouldRetry) {
                throw new Error('Failed to optimize schedule: ' + error.message);
            }
            // Exponential backoff with jitter
            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000) +
                Math.floor(Math.random() * 1000);
            logger.info(`[Perplexity] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
