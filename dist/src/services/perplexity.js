import axios from 'axios';
import { logger } from '../utils/logger';
import { ViatorService } from './viator';
export class PerplexityService {
    constructor() {
        this.perplexityApiCallCount = 0;
        this.apiKey = process.env.PERPLEXITY_API_KEY || '';
        this.baseUrl = 'https://api.perplexity.ai/chat/completions';
        this.resetPerplexityApiCallCount();
        if (!this.apiKey) {
            throw new Error('PERPLEXITY_API_KEY environment variable is required');
        }
    }
    getPerplexityApiCallCount() {
        return this.perplexityApiCallCount;
    }
    resetPerplexityApiCallCount() {
        this.perplexityApiCallCount = 0;
    }
    getDateForActivity(dayNumber, startDate) {
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
        }
        catch (error) {
            logger.error('[Perplexity] Error calculating activity date:', {
                dayNumber,
                startDate,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return new Date().toISOString().split('T')[0];
        }
    }
    async generateActivities(params) {
        try {
            logger.info('Received activity generation request', params);
            // 1. Generate activities with essential data and insights
            const query = this.buildActivityQuery(params);
            logger.debug('Sending query to Perplexity API', { query });
            const response = await this.chat(query);
            if (!response.activities || response.activities.length === 0) {
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
            // Add default durations if missing
            const activitiesWithDuration = response.activities.map(activity => ({
                ...activity,
                duration: activity.duration || 120 // Default 2 hours if no duration specified
            }));
            // 2. Clean and balance activities
            const balancedActivities = await this.cleanAndBalanceActivities(activitiesWithDuration, params);
            logger.info('Successfully balanced activities', {
                originalCount: activitiesWithDuration.length,
                balancedCount: balancedActivities.length
            });
            // 3. Enrich with additional details
            const enrichedActivities = await Promise.all(balancedActivities.map(async (activity) => {
                try {
                    // Get enriched details for the activity
                    const enriched = await this.getEnrichedDetails(activity.name);
                    // Preserve original price if it exists
                    const price = activity.price?.amount > 0 ? activity.price : {
                        amount: activity.bookingDetails?.price?.amount || 0,
                        currency: activity.bookingDetails?.price?.currency || params.currency
                    };
                    logger.debug('[Activity Enrichment] Price information:', {
                        activityName: activity.name,
                        originalPrice: activity.price,
                        bookingDetailsPrice: activity.bookingDetails?.price,
                        finalPrice: price
                    });
                    // Return enriched activity with fallback to original data
                    return {
                        ...activity,
                        name: activity.name || 'Explore Local Attractions',
                        description: enriched.description || activity.description || activity.commentary || '',
                        duration: activity.duration || 120,
                        price, // Use preserved price
                        rating: enriched.rating || activity.rating || 4.0,
                        numberOfReviews: enriched.reviews || activity.numberOfReviews || 50,
                        images: enriched.images?.length ? enriched.images : [{
                                source: 'placeholder',
                                url: `https://placehold.co/600x400?text=${encodeURIComponent(activity.name)}`
                            }],
                        location: activity.location || params.destination,
                        address: activity.location || params.destination,
                        keyHighlights: enriched.highlights || activity.keyHighlights || [],
                        openingHours: enriched.openingHours || '',
                        referenceUrl: activity.bookingDetails?.referenceUrl || '',
                        commentary: activity.commentary || '',
                        itineraryHighlight: activity.itineraryHighlight || '',
                        category: activity.category || 'Cultural & Historical',
                        timeSlot: activity.timeSlot || 'morning',
                        dayNumber: activity.dayNumber || 1,
                        bookingDetails: {
                            provider: activity.bookingDetails?.provider || 'Viator',
                            productCode: activity.bookingDetails?.productCode || '',
                            referenceUrl: activity.bookingDetails?.referenceUrl || '',
                            instantConfirmation: !!activity.bookingDetails?.instantConfirmation,
                            mobileTicket: !!activity.bookingDetails?.mobileTicket,
                            price // Include price in booking details
                        }
                    };
                }
                catch (error) {
                    logger.warn('Failed to enrich activity', {
                        name: activity.name,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                    // Return original activity with minimal defaults
                    return {
                        ...activity,
                        name: activity.name || 'Explore Local Attractions',
                        description: activity.description || activity.commentary || '',
                        duration: activity.duration || 120,
                        price: activity.price || {
                            amount: activity.bookingDetails?.price?.amount || 0,
                            currency: activity.bookingDetails?.price?.currency || params.currency
                        },
                        rating: activity.rating || 4.0,
                        numberOfReviews: activity.numberOfReviews || 50,
                        images: [{
                                source: 'placeholder',
                                url: `https://placehold.co/600x400?text=${encodeURIComponent(activity.name || 'Activity')}`
                            }],
                        location: activity.location || params.destination,
                        address: activity.location || params.destination,
                        keyHighlights: activity.keyHighlights || [],
                        openingHours: '',
                        referenceUrl: activity.bookingDetails?.referenceUrl || '',
                        commentary: activity.commentary || '',
                        itineraryHighlight: activity.itineraryHighlight || '',
                        category: activity.category || 'Cultural & Historical',
                        timeSlot: activity.timeSlot || 'morning',
                        dayNumber: activity.dayNumber || 1,
                        bookingDetails: {
                            provider: activity.bookingDetails?.provider || 'Viator',
                            productCode: activity.bookingDetails?.productCode || '',
                            referenceUrl: activity.bookingDetails?.referenceUrl || '',
                            instantConfirmation: !!activity.bookingDetails?.instantConfirmation,
                            mobileTicket: !!activity.bookingDetails?.mobileTicket,
                            price: activity.bookingDetails?.price || {
                                amount: 0,
                                currency: params.currency
                            }
                        }
                    };
                }
            }));
            // Log price statistics
            const priceStats = {
                totalActivities: enrichedActivities.length,
                activitiesWithPrice: enrichedActivities.filter(a => a.price?.amount > 0).length,
                averagePrice: enrichedActivities.reduce((sum, a) => sum + (a.price?.amount || 0), 0) / enrichedActivities.length,
                priceDistribution: enrichedActivities.reduce((acc, a) => {
                    const priceRange = a.price?.amount ?
                        (a.price.amount <= 30 ? 'budget' :
                            a.price.amount <= 100 ? 'medium' :
                                'premium') : 'unknown';
                    acc[priceRange] = (acc[priceRange] || 0) + 1;
                    return acc;
                }, {})
            };
            logger.info('[Activity Generation] Price statistics:', priceStats);
            return {
                success: true,
                activities: enrichedActivities,
                dailySummaries: response.schedule || [],
                metadata: {
                    originalCount: response.activities.length,
                    finalCount: enrichedActivities.length,
                    enrichedCount: enrichedActivities.filter(a => a.price?.amount > 0).length,
                    daysPlanned: params.days,
                    destination: params.destination,
                    priceStats
                }
            };
        }
        catch (error) {
            logger.error('Failed to generate activities', error);
            throw error;
        }
    }
    // For initial activity planning - uses sonar model
    async chat(query, options) {
        try {
            this.perplexityApiCallCount++;
            logger.info('[Perplexity] Making API call:', {
                promptLength: query.length,
                apiCallCount: this.perplexityApiCallCount
            });
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            const response = await axios.post(this.baseUrl, {
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
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
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
            let parsedContent;
            try {
                parsedContent = JSON.parse(cleanedContent);
            }
            catch (parseError) {
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
        }
        catch (error) {
            logger.error('[Perplexity] Error in chat:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                apiCallCount: this.perplexityApiCallCount
            });
            // Return empty activities array instead of throwing
            return { activities: [] };
        }
    }
    cleanJsonString(str) {
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
        }
        catch (error) {
            logger.error('[JSON Cleaning] Error cleaning JSON string:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                originalString: str.substring(0, 100) + '...'
            });
            throw error;
        }
    }
    getTimeSlot(time) {
        if (!time)
            return 'morning';
        const hour = parseInt(time.split(':')[0]);
        if (hour < 13)
            return 'morning';
        if (hour < 18)
            return 'afternoon';
        return 'evening';
    }
    estimateDuration(time) {
        if (!time)
            return 120; // default 2 hours
        const [start, end] = time.split('-').map(t => {
            const [hours, minutes] = t.split(':').map(Number);
            return hours * 60 + minutes;
        });
        return end - start;
    }
    normalizeActivity(activity, dayNumber, timeSlot) {
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
    parseReviewCount(reviews) {
        if (typeof reviews === 'number')
            return reviews;
        if (!reviews)
            return 0;
        const match = reviews.toString().match(/(\d+)(?:\+|,000\+)?/);
        if (!match)
            return 0;
        const number = parseInt(match[1]);
        if (reviews.includes('000+') || reviews.includes('k+')) {
            return number * 1000;
        }
        return number;
    }
    parseCost(cost) {
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
    async getEnrichedDetails(query, userPreferences, date) {
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
        logger.info('Starting activity balancing', {
            totalActivities: activities.length,
            days: params.days
        });
        // Group activities by day
        const activitiesByDay = activities.reduce((acc, activity) => {
            acc[activity.dayNumber] = acc[activity.dayNumber] || [];
            acc[activity.dayNumber].push(activity);
            return acc;
        }, {});
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
            const timeSlots = ['morning', 'afternoon', 'evening'];
            const activitiesByTimeSlot = new Map();
            // Initialize time slots
            timeSlots.forEach(slot => {
                activitiesByTimeSlot.set(slot, []);
            });
            // First pass: Group activities by time slot
            scoredActivities.forEach(activity => {
                const slot = activity.timeSlot;
                activitiesByTimeSlot.get(slot)?.push(activity);
            });
            // Second pass: Balance activities across time slots
            const balancedTimeSlots = new Map();
            timeSlots.forEach(slot => {
                const slotActivities = activitiesByTimeSlot.get(slot) || [];
                // Sort activities by score
                const sortedActivities = slotActivities.sort((a, b) => {
                    const scoreCompare = (b.preferenceScore || 0) - (a.preferenceScore || 0);
                    if (scoreCompare !== 0)
                        return scoreCompare;
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
                            if (selectedActivities.length >= activityLimits.min)
                                break;
                        }
                    }
                }
                balancedTimeSlots.set(slot, selectedActivities);
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
    getMatchedPreferences(activity, preferences) {
        const matchedPrefs = [];
        // Helper function to check if text contains any interest
        const containsInterest = (text, interests) => {
            if (!text)
                return false;
            const normalizedText = text.toLowerCase();
            return interests.some(interest => {
                const normalizedInterest = interest.toLowerCase();
                // Check for exact match or related terms
                return normalizedText.includes(normalizedInterest) ||
                    (normalizedInterest === 'culture' && (normalizedText.includes('museum') ||
                        normalizedText.includes('historical') ||
                        normalizedText.includes('heritage') ||
                        normalizedText.includes('art') ||
                        normalizedText.includes('palace') ||
                        normalizedText.includes('monument') ||
                        normalizedText.includes('landmark'))) ||
                    (normalizedInterest === 'food & wine' && (normalizedText.includes('culinary') ||
                        normalizedText.includes('gastronomy') ||
                        normalizedText.includes('wine') ||
                        normalizedText.includes('tasting') ||
                        normalizedText.includes('restaurant') ||
                        normalizedText.includes('cooking') ||
                        normalizedText.includes('food tour') ||
                        normalizedText.includes('dining')));
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
    getMostFrequentCategory(categories) {
        const categoryCounts = categories.reduce((acc, category) => {
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(categoryCounts)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || 'Mixed Activities';
    }
    getDayTheme(activities) {
        const categories = activities.map(a => a.category);
        const mainCategory = this.getMostFrequentCategory(categories);
        return `${mainCategory} Exploration Day`;
    }
    getMainArea(activities) {
        return activities.length > 0 ? activities[0].location || 'Various locations' : 'Various locations';
    }
    getDayHighlightText(activities) {
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
    async generateDailyHighlights(activities) {
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
    async enrichActivity(activity, params, retryCount = 0) {
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
        }
        catch (error) {
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
    calculateTimeSlotScore(actual, requested) {
        if (actual === requested)
            return 1;
        const slots = ['morning', 'afternoon', 'evening'];
        const actualIndex = slots.indexOf(actual);
        const requestedIndex = slots.indexOf(requested);
        // Calculate distance between slots (0 to 2)
        const distance = Math.abs(actualIndex - requestedIndex);
        // Convert to score (1 to 0)
        return 1 - (distance / 2);
    }
    calculatePreferenceScore(activity, preferences) {
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
    matchesTravelStyle(category, style) {
        const styleCategories = {
            'luxury': ['Premium Tours', 'Fine Dining', 'Cultural & Historical'],
            'active': ['Nature & Adventure', 'Sports & Recreation', 'Walking Tours'],
            'budget': ['Free Tours', 'Local Markets', 'Public Transport'],
            'family': ['Family Friendly', 'Theme Parks', 'Educational'],
            'romantic': ['Sunset Tours', 'Wine & Dining', 'Cruises']
        };
        return styleCategories[style]?.some(cat => category.toLowerCase().includes(cat.toLowerCase())) || false;
    }
    buildActivityQuery(params) {
        const { destination, days, budget, currency, preferences, flightTimes } = params;
        return `Find ${days} days of real, bookable activities in ${destination} on Viator.com.

Key Requirements:
- Daily budget range: Consider activities within ${budget} ${currency}
- Activities must be currently bookable on Viator
- Mix of morning, afternoon, and evening activities
- Geographically sensible routing each day
- Balance between cultural, adventure, food, and local experiences

CRITICAL RULES:
1. Return ONLY a valid JSON object - NO explanatory text
2. ONLY suggest activities that exist on Viator.com with REAL product codes
3. Ensure activities in the same day are geographically close
4. Account for travel time between locations
5. Maintain category distribution (25% each)
6. ALWAYS include accurate price information for each activity

Return a JSON object with this EXACT structure:
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
        "currency": "${currency}"
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
          "currency": "${currency}"
        }
      }
    }],
    "afternoon": [/* Same structure as morning */],
    "evening": [/* Same structure as morning */]
  }
  // Repeat for each day
}

IMPORTANT:
- Each activity MUST have a valid price.amount > 0
- All prices should be in ${currency}
- Total daily activities cost should not exceed ${budget} ${currency}
- Include REAL Viator product codes and prices`;
    }
    transformDailyItineraryToActivities(content) {
        try {
            const activities = [];
            // Handle daily itinerary format
            Object.keys(content).forEach(key => {
                if (key.startsWith('day')) {
                    const dayNumber = parseInt(key.replace('day', ''));
                    const dayData = content[key];
                    ['morning', 'afternoon', 'evening'].forEach(timeSlot => {
                        if (dayData[timeSlot] && Array.isArray(dayData[timeSlot])) {
                            dayData[timeSlot].forEach((activity) => {
                                try {
                                    // Extract price information from the activity
                                    const price = {
                                        amount: activity.price?.amount ||
                                            parseFloat(activity.price) ||
                                            (activity.bookingDetails?.price?.amount) ||
                                            0,
                                        currency: activity.price?.currency ||
                                            activity.bookingDetails?.price?.currency ||
                                            'USD'
                                    };
                                    // Log price extraction
                                    logger.debug('[Activity Transform] Extracting price:', {
                                        activityName: activity.activity || activity.name,
                                        rawPrice: activity.price,
                                        bookingDetailsPrice: activity.bookingDetails?.price,
                                        extractedPrice: price
                                    });
                                    // Create availability information
                                    const availability = {
                                        isAvailable: true,
                                        availableTimeSlots: [timeSlot],
                                        realTimeVerification: {
                                            verified: false,
                                            lastChecked: new Date().toISOString()
                                        },
                                        pricing: price // Include price in availability
                                    };
                                    activities.push({
                                        id: `${dayNumber}-${timeSlot}-${activities.length}`,
                                        name: activity.activity || activity.name || 'Unnamed Activity',
                                        description: activity.description || activity.tip || '',
                                        duration: parseFloat(activity.duration) || 2,
                                        category: activity.category || 'General',
                                        location: activity.location || '',
                                        timeSlot,
                                        dayNumber,
                                        price, // Add price information
                                        availability, // Add availability information
                                        bookingDetails: {
                                            provider: activity.bookingDetails?.provider || 'Viator',
                                            productCode: activity.productCode || activity.bookingDetails?.productCode || '',
                                            referenceUrl: activity.bookingDetails?.referenceUrl || activity.booking_url || '',
                                            instantConfirmation: !!activity.bookingDetails?.instantConfirmation,
                                            mobileTicket: !!activity.bookingDetails?.mobileTicket,
                                            price // Include price in booking details
                                        }
                                    });
                                    logger.debug('[Activity Transform] Successfully transformed activity:', {
                                        name: activity.activity || activity.name,
                                        price,
                                        timeSlot,
                                        dayNumber,
                                        hasBookingDetails: !!activity.bookingDetails,
                                        productCode: activity.productCode || activity.bookingDetails?.productCode
                                    });
                                }
                                catch (activityError) {
                                    logger.warn('[Activity Transform] Failed to transform activity:', {
                                        error: activityError instanceof Error ? activityError.message : 'Unknown error',
                                        activity: JSON.stringify(activity).substring(0, 200)
                                    });
                                }
                            });
                        }
                    });
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
                }, {})
            });
            return {
                activities,
                schedule: activities.length > 0 ? [{
                        dayNumber: 1,
                        activities: activities.filter(a => a.dayNumber === 1)
                    }] : []
            };
        }
        catch (error) {
            logger.error('[Activity Transform] Failed to transform activities:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                content: JSON.stringify(content).substring(0, 200)
            });
            return { activities: [] };
        }
    }
    determineCategory(activity) {
        const activityLower = activity.toLowerCase();
        if (activityLower.includes('museum') || activityLower.includes('palace') || activityLower.includes('monument')) {
            return 'Cultural & Historical';
        }
        if (activityLower.includes('park') || activityLower.includes('garden') || activityLower.includes('walk')) {
            return 'Nature & Adventure';
        }
        if (activityLower.includes('restaurant') || activityLower.includes('food') || activityLower.includes('dinner')) {
            return 'Food & Entertainment';
        }
        return 'Lifestyle & Local';
    }
    buildEnrichmentQuery(activity, params) {
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
    async optimizeSchedule(activities, days, destination) {
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
${preselectedActivities.map(a => `- ${a.name} (${a.duration || 'N/A'} minutes, ${a.timeSlot}, Day ${a.dayNumber})
   Available times: ${a.availability?.exactStartTimes?.join(', ') || 'Any time'}
   Operating hours: ${a.availability?.operatingHours || 'Standard hours'}
   Real-time verified: ${a.availability?.realTimeVerification?.verified ? 'Yes' : 'No'}`).join('\n')}

AVAILABLE ACTIVITIES TO FILL GAPS:
${unselectedActivities.map(a => `- ${a.name} (${a.duration || 'N/A'} minutes)
   Available slots: ${a.availability?.availableTimeSlots?.join(', ') || 'Any'}
   Operating hours: ${a.availability?.operatingHours || 'Standard hours'}
   Best time to visit: ${a.availability?.bestTimeToVisit || 'Flexible'}`).join('\n')}

REQUIREMENTS:
1. CRITICAL: Include ALL preselected activities in their specified days and time slots
2. For each time slot WITHOUT a preselected activity, suggest 2-3 alternatives
3. Create a balanced schedule across ${days} days
4. Group nearby activities for each time slot
5. Consider activity durations and operating hours
6. Allow multiple options per time slot for flexibility
7. IMPORTANT: Only schedule activities during their available time slots and operating hours

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
4. Availability considerations and backup options

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
      "scoringReason": "specific placement reasoning",
      "availabilityNotes": "details about time slot verification and operating hours"
    }],
    "dayPlanningLogic": "string"
  }],
  "tripOverview": "string",
  "activityFitNotes": "string",
  "availabilityConsiderations": "string"
}`;
            const response = await this.chat(query);
            if (!response?.schedule) {
                logger.error('Failed to generate optimized schedule - no schedule returned from API');
                throw new Error('Failed to generate optimized schedule - no schedule returned from API');
            }
            logger.info('Schedule optimization reasoning:', {
                tripOverview: response.tripOverview,
                activityFitNotes: response.activityFitNotes,
                availabilityConsiderations: response.availabilityConsiderations
            });
            // Verify that all preselected activities are included in their specified slots
            const missingPreselected = preselectedActivities.filter(preselected => {
                return !response.schedule.some(day => day.dayNumber === preselected.dayNumber &&
                    day.activities.some(activity => activity.name === preselected.name &&
                        activity.timeSlot === preselected.timeSlot &&
                        this.isTimeSlotAvailable(activity, preselected.availability)));
            });
            if (missingPreselected.length > 0) {
                logger.error('Schedule optimization failed - missing preselected activities:', {
                    missing: missingPreselected.map(a => ({
                        name: a.name,
                        day: a.dayNumber,
                        timeSlot: a.timeSlot,
                        availableSlots: a.availability?.availableTimeSlots
                    }))
                });
                throw new Error('Schedule optimization failed - some preselected activities are missing');
            }
            // Preserve activity details when transforming schedule
            const enrichedSchedule = response.schedule.map((day) => ({
                ...day,
                activities: day.activities.map((scheduledActivity) => {
                    // First try to find a matching preselected activity
                    const preselected = preselectedActivities.find(a => a.name === scheduledActivity.name &&
                        a.dayNumber === day.dayNumber &&
                        a.timeSlot === scheduledActivity.timeSlot);
                    if (preselected) {
                        return {
                            ...preselected,
                            ...scheduledActivity,
                            selected: true,
                            commentary: scheduledActivity.commentary || preselected.commentary,
                            itineraryHighlight: scheduledActivity.itineraryHighlight || preselected.itineraryHighlight,
                            scoringReason: scheduledActivity.scoringReason || preselected.scoringReason,
                            availabilityNotes: this.generateAvailabilityNotes(preselected)
                        };
                    }
                    // If not preselected, look for the original activity
                    const originalActivity = activities.find(a => a.name === scheduledActivity.name);
                    if (!originalActivity) {
                        logger.warn('Could not find original activity details:', {
                            activityName: scheduledActivity.name,
                            dayNumber: day.dayNumber,
                            timeSlot: scheduledActivity.timeSlot
                        });
                        return scheduledActivity;
                    }
                    return {
                        ...originalActivity,
                        ...scheduledActivity,
                        timeSlot: scheduledActivity.timeSlot || originalActivity.timeSlot,
                        startTime: this.determineStartTime(scheduledActivity, originalActivity),
                        commentary: scheduledActivity.commentary || originalActivity.commentary,
                        itineraryHighlight: scheduledActivity.itineraryHighlight || originalActivity.itineraryHighlight,
                        scoringReason: scheduledActivity.scoringReason || originalActivity.scoringReason,
                        availabilityNotes: this.generateAvailabilityNotes(originalActivity)
                    };
                })
            }));
            return {
                schedule: enrichedSchedule,
                tripOverview: response.tripOverview,
                activityFitNotes: response.activityFitNotes,
                availabilityConsiderations: response.availabilityConsiderations
            };
        }
        catch (error) {
            logger.error('Failed to optimize schedule:', error);
            throw error;
        }
    }
    isTimeSlotAvailable(activity, availability) {
        if (!availability)
            return true;
        const timeSlot = activity.timeSlot;
        return availability.availableTimeSlots?.includes(timeSlot) ||
            availability.realTimeVerification?.exactStartTimes?.some(time => this.getTimeSlotCategory(time) === timeSlot) || false;
    }
    determineStartTime(scheduledActivity, originalActivity) {
        if (scheduledActivity.startTime)
            return scheduledActivity.startTime;
        if (originalActivity.availability?.realTimeVerification?.exactStartTimes?.length > 0) {
            const timeSlot = scheduledActivity.timeSlot;
            const matchingTimes = originalActivity.availability.realTimeVerification.exactStartTimes
                .filter(time => this.getTimeSlotCategory(time) === timeSlot);
            if (matchingTimes.length > 0)
                return matchingTimes[0];
        }
        return this.getDefaultStartTime(scheduledActivity.timeSlot);
    }
    generateAvailabilityNotes(activity) {
        if (!activity.availability)
            return 'Standard operating hours';
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
        if (activity.availability.bestTimeToVisit) {
            notes.push(`Best time to visit: ${activity.availability.bestTimeToVisit}`);
        }
        return notes.join('. ') || 'Standard operating hours';
    }
    getDefaultStartTime(timeSlot) {
        switch (timeSlot) {
            case 'morning': return '09:00';
            case 'afternoon': return '14:00';
            case 'evening': return '19:00';
            default: return '09:00';
        }
    }
    getTimeSlotCategory(time) {
        if (time === 'morning')
            return 'morning';
        if (time === 'afternoon')
            return 'afternoon';
        if (time === 'evening')
            return 'evening';
        return 'unknown';
    }
    getPreferredTimeSlot(category) {
        const preferredSlots = {
            'Cultural & Historical': ['morning'],
            'Nature & Adventure': ['morning'],
            'Food & Entertainment': ['evening'],
            'Lifestyle & Local': ['morning']
        };
        return preferredSlots[category]?.[0] || 'morning';
    }
}
// Export singleton instance
const perplexityClient = new PerplexityService();
export { perplexityClient };
