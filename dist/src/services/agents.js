import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
const SYSTEM_MESSAGE = `You are an AI travel budget expert. Your role is to:
1. Provide accurate cost estimates for travel expenses
2. Consider seasonality, location, and number of travelers
3. Always return responses in valid JSON format
4. Include min and max ranges for each price tier
5. Provide brief descriptions explaining the estimates
6. Consider local market conditions and currency
7. Base estimates on real-world data and current market rates`;
export class VacationBudgetAgent {
    constructor(flightService) {
        this.startTime = Date.now();
        this.flightService = flightService;
    }
    async fetchWithRetry(url, options, retries = 3) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                return response;
            }
            catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
            }
        }
        throw lastError || new Error('Failed to fetch after retries');
    }
    async queryPerplexity(prompt, category) {
        try {
            logger.info(`[${category.toUpperCase()}] Making Perplexity API request`);
            const response = await this.fetchWithRetry('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-sonar-small-128k-online',
                    messages: [
                        {
                            role: 'system',
                            content: SYSTEM_MESSAGE
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    options: {
                        search: true,
                        temperature: 0.1,
                        max_tokens: 4000
                    }
                })
            }, 3);
            if (!response.ok) {
                throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
            }
            const result = await response.json();
            return result.choices[0].message.content;
        }
        catch (error) {
            logger.error(`[${category.toUpperCase()}] Perplexity API error:`, error);
            return this.getDefaultCategoryData(category);
        }
    }
    generateFlightSearchUrl(flight) {
        try {
            const [from, to] = (flight.route || '').split(' to ').map((s) => s.trim());
            if (!from || !to)
                return '';
            const fromCode = from.match(/\(([A-Z]{3})\)/) ? from.match(/\(([A-Z]{3})\)/)?.[1] : from;
            const toCode = to.match(/\(([A-Z]{3})\)/) ? to.match(/\(([A-Z]{3})\)/)?.[1] : to;
            const outDate = new Date(flight.outbound).toISOString().split('T')[0];
            const inDate = new Date(flight.inbound).toISOString().split('T')[0];
            return `https://www.kayak.com/flights/${fromCode}-${toCode}/${outDate}/${inDate}`;
        }
        catch (error) {
            logger.error('[Flight URL] Error generating flight URL:', error);
            return '';
        }
    }
    transformAmadeusFlight(flight) {
        const segments = flight.itineraries[0].segments;
        const firstSegment = segments[0];
        const lastSegment = segments[segments.length - 1];
        const returnSegments = flight.itineraries[1]?.segments || [];
        const returnFirstSegment = returnSegments[0];
        const returnLastSegment = returnSegments[returnSegments.length - 1];
        const route = `${firstSegment.departure.iataCode} to ${lastSegment.arrival.iataCode}`;
        const flightRef = {
            id: `${firstSegment.carrierCode}${firstSegment.number}-${Date.now()}`,
            airline: firstSegment.carrierCode,
            route,
            price: {
                amount: parseFloat(flight.price.total),
                currency: flight.price.currency
            },
            outbound: firstSegment.departure.at,
            inbound: returnFirstSegment ? returnFirstSegment.departure.at : '',
            duration: `${flight.itineraries[0].duration}${returnSegments.length ? ` / ${flight.itineraries[1].duration}` : ''}`,
            layovers: segments.length - 1 + returnSegments.length - 1,
            flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
            tier: this.determineFlightTier(flight),
            referenceUrl: this.generateFlightSearchUrl({
                route,
                outbound: firstSegment.departure.at,
                inbound: returnFirstSegment ? returnFirstSegment.departure.at : '',
            }),
            details: {
                outbound: {
                    duration: flight.itineraries[0].duration,
                    segments: segments.map(segment => ({
                        departure: {
                            airport: segment.departure.iataCode,
                            terminal: segment.departure.terminal,
                            time: segment.departure.at
                        },
                        arrival: {
                            airport: segment.arrival.iataCode,
                            terminal: segment.arrival.terminal,
                            time: segment.arrival.at
                        },
                        duration: segment.duration,
                        flightNumber: `${segment.carrierCode}${segment.number}`,
                        aircraft: {
                            code: segment.aircraft.code
                        },
                        airline: {
                            code: segment.carrierCode,
                            name: segment.carrierCode // You might want to add a mapping for full airline names
                        }
                    }))
                },
                inbound: returnSegments.length > 0 ? {
                    duration: flight.itineraries[1].duration,
                    segments: returnSegments.map(segment => ({
                        departure: {
                            airport: segment.departure.iataCode,
                            terminal: segment.departure.terminal,
                            time: segment.departure.at
                        },
                        arrival: {
                            airport: segment.arrival.iataCode,
                            terminal: segment.arrival.terminal,
                            time: segment.arrival.at
                        },
                        duration: segment.duration,
                        flightNumber: `${segment.carrierCode}${segment.number}`,
                        aircraft: {
                            code: segment.aircraft.code
                        },
                        airline: {
                            code: segment.carrierCode,
                            name: segment.carrierCode
                        }
                    }))
                } : undefined,
                policies: {
                    cancellation: flight.policies?.cancellation || 'Standard cancellation policy',
                    changes: flight.policies?.changes || 'Standard change policy',
                    refund: flight.policies?.refund || 'Standard refund policy',
                    checkedBags: flight.policies?.checkedBags || 1,
                    carryOn: flight.policies?.carryOn || 1,
                    seatSelection: flight.policies?.seatSelection || true
                }
            },
            cabinClass: flight.travelerPricings[0].fareDetailsBySegment[0].cabin,
            bookingClass: flight.travelerPricings[0].fareDetailsBySegment[0].class,
            airlineCode: firstSegment.carrierCode
        };
        return flightRef;
    }
    getDefaultCategoryData(category) {
        const defaultTier = {
            min: 0,
            max: 0,
            average: 0,
            confidence: 0,
            source: 'Default due to API error',
            references: []
        };
        switch (category) {
            case 'flights':
                return {
                    flights: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            case 'hotels':
                return {
                    hotels: {
                        searchDetails: {
                            location: '',
                            dates: {
                                checkIn: '',
                                checkOut: ''
                            },
                            guests: 0
                        },
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
            default:
                return {
                    [category]: {
                        budget: defaultTier,
                        medium: defaultTier,
                        premium: defaultTier
                    }
                };
        }
    }
    async handleTravelRequest(request) {
        try {
            const response = {
                requestDetails: {
                    departureLocation: request.departureLocation,
                    destinations: request.destinations,
                    travelers: Number(request.travelers),
                    startDate: request.startDate,
                    endDate: request.endDate,
                    currency: 'USD'
                }
            };
            // Calculate number of days
            const days = Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / (1000 * 60 * 60 * 24));
            // Ensure we have a valid API base URL
            const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
            // Generate activities
            const activitiesResponse = await fetch(`${apiBaseUrl}/api/activities/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    destination: request.destinations[0].label,
                    days,
                    budget: request.budgetLimit,
                    currency: 'USD',
                    preferences: {
                        travelStyle: request.preferences?.travelStyle || 'balanced',
                        pacePreference: request.preferences?.pacePreference || 'moderate',
                        interests: request.preferences?.interests || ['General'],
                        accessibility: request.preferences?.accessibility || ['Standard'],
                        dietaryRestrictions: request.preferences?.dietaryRestrictions || []
                    }
                })
            });
            if (!activitiesResponse.ok) {
                const errorText = await activitiesResponse.text();
                logger.error('Failed to generate activities:', {
                    status: activitiesResponse.status,
                    error: errorText
                });
                throw new Error(`Failed to generate activities: ${activitiesResponse.status}`);
            }
            let activitiesData;
            try {
                const responseText = await activitiesResponse.text();
                logger.info('Raw activities response received:', {
                    status: activitiesResponse.status,
                    responseLength: responseText.length,
                    responsePreview: responseText.substring(0, 200)
                });
                activitiesData = JSON.parse(responseText);
                // Check if we have the expected data structure
                if (!activitiesData?.data?.activities) {
                    logger.error('Invalid activities data structure:', {
                        hasData: !!activitiesData?.data,
                        dataKeys: activitiesData?.data ? Object.keys(activitiesData.data) : []
                    });
                    throw new Error('Invalid activities data structure');
                }
                // Transform activities
                const transformedActivities = await this.transformActivities(activitiesData.data.activities, days, request.destinations[0].label);
                if (!transformedActivities || transformedActivities.length === 0) {
                    logger.warn('No activities were transformed, using defaults');
                    response.activities = this.getDefaultCategoryData('activities').activities;
                }
                else {
                    // Group activities by tier but preserve all enriched data
                    const groupedActivities = transformedActivities.reduce((acc, activity) => {
                        const tier = activity.tier || this.determineActivityTier(activity.price?.amount || 0);
                        if (!acc[tier]) {
                            acc[tier] = {
                                references: [],
                                min: Infinity,
                                max: -Infinity,
                                average: 0
                            };
                        }
                        acc[tier].references.push(activity);
                        const price = activity.price?.amount || 0;
                        acc[tier].min = Math.min(acc[tier].min, price);
                        acc[tier].max = Math.max(acc[tier].max, price);
                        return acc;
                    }, {});
                    // Calculate averages and set response
                    response.activities = {
                        budget: {
                            min: groupedActivities.budget?.min || 0,
                            max: groupedActivities.budget?.max || 30,
                            average: groupedActivities.budget?.average || 15,
                            confidence: 0.7,
                            source: "Activities API",
                            references: groupedActivities.budget?.references || []
                        },
                        medium: {
                            min: groupedActivities.medium?.min || 30,
                            max: groupedActivities.medium?.max || 100,
                            average: groupedActivities.medium?.average || 65,
                            confidence: 0.7,
                            source: "Activities API",
                            references: groupedActivities.medium?.references || []
                        },
                        premium: {
                            min: groupedActivities.premium?.min || 100,
                            max: groupedActivities.premium?.max || request.budgetLimit,
                            average: groupedActivities.premium?.average || (100 + request.budgetLimit) / 2,
                            confidence: 0.7,
                            source: "Activities API",
                            references: groupedActivities.premium?.references || []
                        }
                    };
                    // Store all enriched activities separately
                    logger.info('[Activities Response] Storing enriched activities', {
                        totalActivities: transformedActivities.length,
                        enrichedActivitiesDetails: transformedActivities.map(activity => ({
                            name: activity.name,
                            dayNumber: activity.dayNumber,
                            timeSlot: activity.timeSlot,
                            category: activity.category,
                            hasBookingDetails: !!activity.bookingDetails,
                            hasAvailability: !!activity.availability,
                            tier: activity.tier,
                            price: activity.price,
                            rating: activity.rating,
                            numberOfReviews: activity.numberOfReviews
                        }))
                    });
                    response.enrichedActivities = transformedActivities;
                    // Add daily summaries and metadata
                    if (activitiesData.data.dailySummaries) {
                        response.dailySummaries = activitiesData.data.dailySummaries;
                    }
                    if (activitiesData.data.dayHighlights) {
                        response.dayHighlights = activitiesData.data.dayHighlights;
                    }
                    response.itineraryMetadata = {
                        totalDays: days,
                        destination: request.destinations[0].label,
                        preferences: request.preferences
                    };
                }
                return response;
            }
            catch (error) {
                logger.error('Failed to process activities:', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                });
                // Return default data in case of error
                response.activities = this.getDefaultCategoryData('activities').activities;
                return response;
            }
        }
        catch (error) {
            logger.error('Error in handleTravelRequest:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    determineFlightTier(flight) {
        const cabinClass = flight.travelerPricings[0].fareDetailsBySegment[0].cabin;
        const price = parseFloat(flight.price.total);
        if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
            return 'premium';
        }
        else if (cabinClass === 'PREMIUM_ECONOMY') {
            return 'medium';
        }
        else if (price <= 1000) {
            return 'budget';
        }
        else if (price <= 2000) {
            return 'medium';
        }
        else {
            return 'premium';
        }
    }
    constructPrompt(params) {
        const { category, request, destination, userPreferences } = params;
        if (category && request) {
            return `Search for available activities in ${request.destinations[0].label} with these requirements:

SEARCH PROCESS:
1. Search both platforms:
   - Search Viator.com for ${request.destinations[0].label} activities
   - Search GetYourGuide.com for ${request.destinations[0].label} activities
2. Sort by: Best Rating
3. Find at least 3 activities from each platform
4. Focus on category: ${category}
${request.preferences ? `\nAdditional preferences: ${JSON.stringify(request.preferences)}` : ''}

VALIDATION RULES:
1. Activities must have valid booking URLs
2. Copy exact details from the listings
3. Include activities across different price points
4. Include activities with different durations and times

For each activity found, provide details in this JSON format:
{
  "${category}": {
    "budget": {
      "min": number,
      "max": number,
      "average": number,
      "confidence": number,
      "source": "string",
      "references": [
        {
          "name": "EXACT name from listing",
          "provider": "Viator" or "GetYourGuide",
          "price": number,
          "duration": number,
          "description": "EXACT description from listing",
          "booking_url": "EXACT URL from listing"
        }
      ]
    },
    "medium": { same structure },
    "premium": { same structure }
  }
}`;
        }
        // If we have destination and userPreferences, it's for single activity generation
        if (destination) {
            return `Search for available activities in ${destination} with these requirements:

SEARCH PROCESS:
1. Search both platforms:
   - Search Viator.com for ${destination} activities
   - Search GetYourGuide.com for ${destination} activities
2. Sort by: Best Rating
3. Find at least 3 activities from each platform${category ? `\n4. Focus on category: ${category}` : ''}
${userPreferences ? `\nAdditional preferences: ${userPreferences}` : ''}

VALIDATION RULES:
1. Activities must have valid booking URLs
2. Copy exact details from the listings
3. Include activities across different price points
4. Include activities with different durations and times

For each activity found, provide details in this JSON format:
{
  "activities": [
    {
      "name": "EXACT name from listing",
      "provider": "Viator" or "GetYourGuide",
      "price": exact price in USD,
      "price_category": "budget" (<$30), "medium" ($30-$100), or "premium" (>$100),
      "duration": hours (number),
      "typical_time": "morning", "afternoon", or "evening",
      "description": "EXACT description from listing",
      "highlights": ["EXACT highlights from listing"],
      "rating": exact rating (number),
      "review_count": exact number of reviews,
      "booking_url": "EXACT URL from listing",
      "languages": ["available languages"],
      "cancellation_policy": "EXACT policy from listing",
      "location": {
        "meeting_point": "EXACT meeting point",
        "address": "EXACT address if provided"
      },
      "booking_info": {
        "instant_confirmation": true/false,
        "mobile_ticket": true/false,
        "min_participants": number,
        "max_participants": number
      }
    }
  ]
}`;
        }
        throw new Error('Invalid parameters for constructPrompt');
    }
    constructHotelPrompt(request) {
        const destination = request.destinations[0].label;
        const checkIn = request.startDate;
        const checkOut = request.endDate;
        const travelers = request.travelers;
        const budget = request.budgetLimit;
        let prompt = `Provide detailed hotel recommendations in ${destination} for ${travelers} travelers, checking in on ${checkIn} and checking out on ${checkOut}.`;
        if (budget) {
            prompt += `\nConsider total budget of ${budget} USD when suggesting options.`;
        }
        prompt += `\n\nIMPORTANT RULES:
1. Prioritize hotels with direct booking websites
2. All URLs must be complete and include check-in/out dates when possible
3. All images must be from official hotel sources
4. Prices must reflect actual rates for the specified dates
5. Only include hotels that can be booked online
6. Verify that all links and images are accessible
7. Include major hotel chains when available in each tier`;
        return prompt;
    }
    cleanJsonResponse(content) {
        logger.debug('Content before cleaning:', content);
        try {
            // First try to parse it directly in case it's already valid JSON
            try {
                JSON.parse(content);
                return content;
            }
            catch (e) {
                // If direct parsing fails, proceed with cleaning
            }
            // Remove any markdown code block markers
            content = content.replace(/```json\n?|\n?```/g, '');
            // Remove any text before the first {
            content = content.substring(content.indexOf('{'));
            // Find the last complete activity object by looking for the last complete closing brace
            const lastCompleteActivity = content.lastIndexOf('}, {');
            if (lastCompleteActivity !== -1) {
                content = content.substring(0, lastCompleteActivity + 1) + ']}';
            }
            else {
                // If we can't find a complete activity, try to find the last complete object
                const lastCompleteBrace = content.lastIndexOf('}');
                if (lastCompleteBrace !== -1) {
                    content = content.substring(0, lastCompleteBrace + 1);
                }
            }
            // Quote unquoted property names
            content = content.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            // Fix duration ranges by taking the average
            content = content.replace(/"duration"\s*:\s*"?(\d+)-(\d+)"?/g, (match, start, end) => {
                const avg = (parseInt(start) + parseInt(end)) / 2;
                return `"duration": ${avg}`;
            });
            // Convert any remaining duration ranges to single numbers
            content = content.replace(/"duration"\s*:\s*"([0-9.]+)"/g, '"duration": $1');
            // Quote unquoted boolean values
            content = content.replace(/:\s*(true|false)(\s*[,}])/gi, ':"$1"$2');
            // Clean up any malformed URLs
            content = content.replace(/(\/[^\/]+)\1{10,}/g, '/malformed-url-removed');
            // Try to parse the cleaned content
            try {
                const parsed = JSON.parse(content);
                return JSON.stringify(parsed, null, 2);
            }
            catch (error) {
                logger.error('Failed to parse cleaned JSON:', { error, content });
                // Return a valid activities array with a single placeholder activity
                return JSON.stringify({
                    activities: [{
                            name: "Placeholder Activity",
                            description: "Unable to generate activity details. Please try again.",
                            duration: 2,
                            price: 0,
                            category: "General",
                            location: "To be determined",
                            exact_address: "",
                            opening_hours: "",
                            startTime: "09:00",
                            endTime: "11:00",
                            rating: 0,
                            number_of_reviews: 0,
                            key_highlights: ["Please try generating another activity"],
                            preferred_time_of_day: "morning",
                            bookingDetails: {
                                provider: "GetYourGuide",
                                referenceUrl: "",
                                cancellationPolicy: "Free cancellation",
                                instantConfirmation: true,
                                mobileTicket: true,
                                languages: ["English"],
                                minParticipants: 1,
                                maxParticipants: 10,
                                pickupIncluded: false,
                                pickupLocation: "",
                                accessibility: "Standard",
                                restrictions: []
                            },
                            images: []
                        }]
                }, null, 2);
            }
        }
        catch (error) {
            logger.error('Failed to clean JSON response:', { error, content });
            // Return a valid empty activities array as fallback
            return JSON.stringify({
                activities: []
            }, null, 2);
        }
    }
    async querySingleActivity(prompt) {
        logger.debug('Starting activity generation with prompt:', prompt);
        try {
            logger.debug('Generated prompt length:', prompt.length);
            const result = await this.fetchWithRetry('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-sonar-small-128k-online',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a travel activity expert specializing in Viator and GetYourGuide bookings.
Your task is to search through Viator and GetYourGuide's platforms to find and recommend REAL, BOOKABLE activities.

SEARCH PROCESS:
1. First search Viator.com for premium activities ($100+)
2. Then search GetYourGuide.com for budget/medium activities (under $100)
3. Use the search filters on each platform to find activities matching the requirements
4. Verify each activity exists and is currently bookable
5. Copy exact details from the actual listings

CRITICAL RULES:
1. ONLY suggest activities that you can find on these platforms
2. ALL URLs must be real, active booking links that you verify
3. Premium activities ($100+) MUST be from Viator.com
4. Budget/medium activities (under $100) MUST be from GetYourGuide.com
5. Include EXACT booking URLs in this format:
   - Viator: https://www.viator.com/tours/[city]/[activity-name]/[product-code]
   - GetYourGuide: https://www.getyourguide.com/[city]/[activity-code]
6. Copy exact prices, descriptions, and details from the listings
7. Do not make up or guess any information - only use what you find
8. If you can't find a suitable activity, say so instead of making one up

For each activity you find, include:
{
  "name": "EXACT name from provider",
  "description": "EXACT description from provider",
  "price": number (exact price in USD),
  "duration": number (in hours),
  "location": "Specific venue/location name",
  "address": "Full street address",
  "openingHours": "Actual operating hours",
  "keyHighlights": ["Real highlights from provider"],
  "rating": number (from provider reviews),
  "numberOfReviews": number (actual count),
  "category": "Activity type",
  "dayNumber": number,
  "timeSlot": "morning" | "afternoon" | "evening",
  "referenceUrl": "EXACT booking URL",
  "images": ["Real image URLs"],
  "priceCategory": "budget" | "medium" | "premium",
  "bookingDetails": {
    "provider": "Viator" | "GetYourGuide",
    "cancellationPolicy": "Exact policy from listing",
    "instantConfirmation": boolean,
    "mobileTicket": boolean,
    "languages": ["Available languages"],
    "minParticipants": number,
    "maxParticipants": number,
    "pickupIncluded": boolean,
    "pickupLocation": "If included",
    "accessibility": "From listing",
    "restrictions": ["From listing"]
  }
}`
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    options: {
                        temperature: 0.1,
                        max_tokens: 4000,
                        web_search: true
                    }
                })
            }, 3);
            if (!result.ok) {
                throw new Error(`Perplexity API request failed: ${result.status} ${result.statusText}`);
            }
            const data = await result.json();
            logger.debug('Received response from Perplexity:', {
                contentLength: data.choices?.[0]?.message?.content?.length,
                hasChoices: !!data.choices,
                firstChoice: data.choices?.[0]?.message,
                searchResults: data.choices?.[0]?.message?.search_results
            });
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('Invalid response from Perplexity API');
            }
            const content = data.choices[0].message.content;
            logger.debug('Raw content from Perplexity API:', content);
            try {
                // Try to parse the content directly first
                return JSON.parse(content);
            }
            catch (e) {
                logger.warn('Failed to parse content directly, attempting to clean:', e);
                // Clean the content and try again
                let cleanContent = content
                    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1') // Remove markdown code blocks
                    .replace(/^[^{]*({[\s\S]*})[^}]*$/, '$1') // Extract just the JSON object
                    .trim();
                logger.debug('Cleaned content:', cleanContent);
                try {
                    return JSON.parse(cleanContent);
                }
                catch (e) {
                    logger.error('Failed to parse cleaned content:', e);
                    throw new Error('Failed to parse activity data');
                }
            }
        }
        catch (error) {
            logger.error('Error in querySingleActivity:', error);
            throw error;
        }
    }
    isValidJson(str) {
        try {
            JSON.parse(str);
            return true;
        }
        catch {
            return false;
        }
    }
    determineActivityTier(price) {
        if (price <= 30)
            return 'budget';
        if (price <= 100)
            return 'medium';
        return 'premium';
    }
    async generateSingleActivity(params) {
        const prompt = this.constructPrompt({
            destination: params.destination,
            category: params.category,
            userPreferences: params.userPreferences
        });
        const result = await this.querySingleActivity(prompt);
        if (result.error) {
            return this.createPlaceholderActivity({
                dayNumber: params.dayNumber,
                timeSlot: params.timeOfDay,
                tier: params.budget
            });
        }
        return {
            ...result,
            dayNumber: params.dayNumber,
            timeSlot: params.timeOfDay,
            tier: params.budget
        };
    }
    getPriceRangeForTier(budget, currency) {
        const budgetNum = typeof budget === 'string' ? this.getBudgetAmount(budget) : budget;
        switch (budget) {
            case 'budget':
                return { min: 0, max: 30 };
            case 'medium':
                return { min: 30, max: 100 };
            case 'premium':
                return { min: 100, max: budgetNum }; // Use the total budget as max for premium
            default:
                return { min: 0, max: budgetNum };
        }
    }
    getBudgetAmount(tier) {
        switch (tier.toLowerCase()) {
            case 'budget':
                return 30;
            case 'medium':
                return 100;
            case 'premium':
                return 500; // Default max for premium tier
            default:
                return 100; // Default to medium tier budget
        }
    }
    groupFlightsByTier(flights) {
        const result = flights.reduce((acc, flight) => {
            const tier = this.determineFlightTier(flight);
            if (!acc[tier]) {
                acc[tier] = {
                    min: Infinity,
                    max: -Infinity,
                    average: 0,
                    confidence: 0.9, // Higher confidence for real data
                    source: 'Amadeus',
                    references: []
                };
            }
            const price = parseFloat(flight.price.total);
            acc[tier].min = Math.min(acc[tier].min, price);
            acc[tier].max = Math.max(acc[tier].max, price);
            acc[tier].references.push(this.transformAmadeusFlight(flight));
            return acc;
        }, {});
        // Calculate averages
        Object.keys(result).forEach(tier => {
            const refs = result[tier].references;
            result[tier].average =
                refs.reduce((sum, ref) => sum + ref.price, 0) / refs.length;
        });
        return result;
    }
    async transformActivities(activities, days, destination) {
        logger.info('[Agents] Starting activity transformation:', {
            totalActivities: activities.length,
            days,
            destination
        });
        const transformedActivities = [];
        for (const [index, activity] of activities.entries()) {
            try {
                logger.debug('[Agents] Processing activity:', {
                    name: activity.name,
                    index,
                    originalTimeSlot: activity.timeSlot,
                    originalDayNumber: activity.dayNumber,
                    originalPrice: activity.price,
                    hasBookingDetails: !!activity.bookingDetails,
                    hasAvailability: !!activity.availability
                });
                // Transform the activity
                const transformed = this.validateAndTransformActivity(activity, {
                    destination,
                    dayNumber: activity.dayNumber || Math.floor(index / 3) + 1,
                    timeOfDay: activity.timeSlot || this.determineTimeSlot(index % 3)
                });
                logger.debug('[Agents] Activity transformed:', {
                    name: transformed.name,
                    dayNumber: transformed.dayNumber,
                    timeSlot: transformed.timeSlot,
                    price: {
                        amount: transformed.price?.amount,
                        currency: transformed.price?.currency,
                        source: transformed.availability?.realTimeVerification?.verified ? 'realtime' : 'original'
                    },
                    bookingDetails: {
                        provider: transformed.bookingDetails?.provider,
                        productCode: transformed.bookingDetails?.productCode,
                        hasPrice: !!transformed.bookingDetails?.price
                    },
                    availability: {
                        isAvailable: transformed.availability?.isAvailable,
                        timeSlots: transformed.availability?.availableTimeSlots,
                        verified: transformed.availability?.realTimeVerification?.verified,
                        hasPricing: !!transformed.availability?.pricing
                    }
                });
                transformedActivities.push(transformed);
            }
            catch (error) {
                logger.error('[Agents] Error transforming activity:', {
                    activity: activity.name,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
        }
        // Optimize the schedule
        logger.info('[Agents] Starting schedule optimization');
        const optimizedActivities = await this.optimizeSchedule(transformedActivities, days, destination);
        // Log price distribution after optimization
        const priceDistribution = optimizedActivities.reduce((acc, curr) => {
            const tier = this.determineActivityTier(curr.price?.amount || 0);
            if (!acc[tier]) {
                acc[tier] = {
                    count: 0,
                    totalAmount: 0,
                    activities: []
                };
            }
            acc[tier].count++;
            acc[tier].totalAmount += curr.price?.amount || 0;
            acc[tier].activities.push({
                name: curr.name,
                price: curr.price,
                dayNumber: curr.dayNumber,
                timeSlot: curr.timeSlot
            });
            return acc;
        }, {});
        logger.info('[Agents] Schedule optimization completed:', {
            originalCount: activities.length,
            optimizedCount: optimizedActivities.length,
            daysScheduled: new Set(optimizedActivities.map(a => a.dayNumber)).size,
            priceDistribution,
            timeSlotDistribution: optimizedActivities.reduce((acc, curr) => {
                acc[curr.timeSlot] = (acc[curr.timeSlot] || 0) + 1;
                return acc;
            }, {}),
            categoryDistribution: optimizedActivities.reduce((acc, curr) => {
                acc[curr.category] = (acc[curr.category] || 0) + 1;
                return acc;
            }, {})
        });
        return optimizedActivities;
    }
    validateAndTransformActivity(activity, params) {
        logger.info('[Agents] Starting activity transformation:', {
            activityName: activity.name,
            originalPrice: activity.price,
            originalAvailability: activity.availability
        });
        // Extract and validate price information from all possible sources
        const priceInfo = this.extractPrice(activity);
        logger.debug('[Agents] Extracted price:', {
            activityName: activity.name,
            extractedPrice: priceInfo,
            originalPrice: activity.price,
            bookingDetailsPrice: activity.bookingDetails?.price,
            availabilityPrice: activity.availability?.pricing?.amount
        });
        // Extract and validate availability information
        const availability = this.extractAvailability(activity, params);
        logger.debug('[Agents] Extracted availability:', {
            activityName: activity.name,
            availability,
            originalAvailability: activity.availability,
            hasRealTimeVerification: availability.realTimeVerification?.verified,
            exactStartTimes: availability.realTimeVerification?.exactStartTimes
        });
        // Get the exact start time from real-time verification if available
        let exactStartTime = null;
        if (availability.realTimeVerification?.verified &&
            availability.realTimeVerification.exactStartTimes?.length > 0) {
            // Get the time that best matches the time slot
            const timeSlot = activity.timeSlot || params.timeOfDay || 'morning';
            const timeSlotRanges = {
                morning: { start: '06:00', end: '12:00' },
                afternoon: { start: '12:00', end: '17:00' },
                evening: { start: '17:00', end: '23:59' }
            };
            exactStartTime = availability.realTimeVerification.exactStartTimes.find(time => {
                const timeRange = timeSlotRanges[timeSlot];
                return time >= timeRange.start && time <= timeRange.end;
            }) || availability.realTimeVerification.exactStartTimes[0];
            logger.info('[Agents] Found exact start time:', {
                activityName: activity.name,
                timeSlot,
                exactStartTime,
                availableTimes: availability.realTimeVerification.exactStartTimes
            });
        }
        // Transform the activity with validated data
        const transformedActivity = {
            ...activity,
            price: priceInfo,
            availability,
            timeSlot: activity.timeSlot || params.timeOfDay || 'morning',
            dayNumber: activity.dayNumber || params.dayNumber || 1,
            startTime: exactStartTime || this.getDefaultStartTime(activity.timeSlot || params.timeOfDay || 'morning'),
            bookingDetails: {
                ...activity.bookingDetails,
                price: priceInfo,
                productCode: activity.bookingDetails?.productCode || '',
                provider: activity.bookingDetails?.provider || 'Unknown'
            }
        };
        // Add price to availability if real-time verification exists
        if (transformedActivity.availability?.realTimeVerification?.verified) {
            transformedActivity.availability.pricing = priceInfo;
        }
        logger.info('[Agents] Activity transformation completed:', {
            activityName: transformedActivity.name,
            finalPrice: {
                amount: transformedActivity.price?.amount,
                currency: transformedActivity.price?.currency
            },
            hasAvailability: !!transformedActivity.availability,
            availabilityStatus: transformedActivity.availability?.isAvailable,
            timeSlot: transformedActivity.timeSlot,
            exactStartTime: transformedActivity.startTime,
            bookingProvider: transformedActivity.bookingDetails?.provider,
            productCode: transformedActivity.bookingDetails?.productCode
        });
        return transformedActivity;
    }
    getDefaultStartTime(timeSlot) {
        const defaultTimes = {
            morning: '09:00',
            afternoon: '14:00',
            evening: '19:00'
        };
        return defaultTimes[timeSlot] || '09:00';
    }
    extractPrice(activity) {
        // Check all possible price sources in order of priority
        const priceSources = [
            // Availability pricing (from real-time data)
            activity.availability?.pricing,
            // Direct price object
            activity.price,
            // Booking details price
            activity.bookingDetails?.price,
            // Default price
            { amount: 0, currency: 'USD' }
        ].filter(Boolean);
        // Find first valid price
        const bestPrice = priceSources.find(price => price && typeof price.amount === 'number' && price.amount > 0) || priceSources[priceSources.length - 1];
        if (!bestPrice || bestPrice.amount === 0) {
            logger.warn('[Agents] No valid price found for activity:', {
                activityName: activity.name,
                priceSources: priceSources.map(p => ({ amount: p?.amount, currency: p?.currency }))
            });
        }
        const normalizedPrice = {
            amount: Number(bestPrice.amount),
            currency: bestPrice.currency || 'USD'
        };
        logger.debug('[Agents] Price extraction result:', {
            activityName: activity.name,
            normalizedPrice,
            priceSource: bestPrice === activity.availability?.pricing ? 'availability' :
                bestPrice === activity.price ? 'direct' :
                    bestPrice === activity.bookingDetails?.price ? 'bookingDetails' : 'default'
        });
        return normalizedPrice;
    }
    extractAvailability(activity, params) {
        // Use existing availability if it exists and is valid
        if (activity.availability?.isAvailable !== undefined) {
            return activity.availability;
        }
        // Create default availability
        return {
            isAvailable: true, // Default to available
            operatingHours: activity.availability?.operatingHours || '09:00-18:00',
            availableTimeSlots: activity.availability?.availableTimeSlots || [params.timeOfDay || 'morning'],
            bestTimeToVisit: activity.availability?.bestTimeToVisit || null,
            nextAvailableDate: activity.availability?.nextAvailableDate || null,
            realTimeVerification: {
                verified: false,
                exactStartTimes: [],
                lastChecked: new Date().toISOString()
            }
        };
    }
    normalizeDuration(duration) {
        if (typeof duration === 'number') {
            return duration;
        }
        if (typeof duration === 'string') {
            // Extract numbers from string (e.g., "2 hours" -> 120)
            const hours = parseFloat(duration.match(/\d+(\.\d+)?/)?.[0] || '0');
            return duration.toLowerCase().includes('hour') ? hours * 60 : hours;
        }
        if (duration && typeof duration === 'object') {
            if ('min' in duration && 'max' in duration) {
                return Math.floor((duration.min + duration.max) / 2);
            }
        }
        return 120; // Default 2 hours in minutes
    }
    determineTimeSlot(index) {
        const slots = ['morning', 'afternoon', 'evening'];
        return slots[index % 3];
    }
    getDefaultActivities(params) {
        const defaultActivities = [];
        const categories = ['Cultural & Historical', 'Food & Entertainment', 'Nature & Adventure'];
        for (let day = 1; day <= params.days; day++) {
            ['morning', 'afternoon', 'evening'].forEach((timeSlot, index) => {
                defaultActivities.push({
                    id: `${day}-${timeSlot}-default`,
                    name: `${categories[index % 3]} Activity`,
                    description: `Explore ${params.destination} with a ${timeSlot} activity`,
                    duration: 120,
                    price: {
                        amount: 0,
                        currency: params.currency
                    },
                    category: categories[index % 3],
                    location: params.destination,
                    timeSlot,
                    dayNumber: day,
                    selected: true,
                    bookingDetails: {
                        provider: 'Viator',
                        productCode: '',
                        referenceUrl: ''
                    }
                });
            });
        }
        return defaultActivities;
    }
    normalizeCategory(category) {
        const categories = {
            'Cultural & Historical': ['museum', 'history', 'art', 'palace', 'church'],
            'Food & Entertainment': ['food', 'restaurant', 'dining', 'show', 'entertainment'],
            'Nature & Adventure': ['park', 'garden', 'outdoor', 'adventure', 'tour'],
            'Lifestyle & Local': ['shopping', 'market', 'local', 'workshop']
        };
        if (!category)
            return 'Lifestyle & Local';
        const lowerCategory = category.toLowerCase();
        for (const [mainCategory, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => lowerCategory.includes(keyword))) {
                return mainCategory;
            }
        }
        return 'Lifestyle & Local';
    }
    generateDailyPlan(dayNumber, activities, destination) {
        const selectedActivities = activities.filter(a => a.selected);
        // Calculate map data
        const locations = activities.map((activity, index) => ({
            name: activity.name,
            coordinates: {
                latitude: 0, // Would need to be fetched from a geocoding service
                longitude: 0,
            },
            address: activity.address || activity.location,
            type: 'activity',
            category: activity.category,
            description: activity.description,
            duration: activity.duration * 60, // Convert hours to minutes
            timeSlot: activity.timeSlot,
            order: index + 1
        }));
        // Add break locations
        const breaks = {
            morning: {
                startTime: '10:30',
                endTime: '11:00',
                duration: 30,
                suggestion: 'Coffee break',
                location: 'Nearby café'
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
                suggestion: 'Rest break',
                location: 'Local park or café'
            },
            dinner: {
                startTime: '18:30',
                endTime: '20:00',
                duration: 90,
                suggestion: 'Dinner',
                location: 'Restaurant district'
            }
        };
        // Generate theme based on activities
        const activityCategories = new Set(activities.map(a => a.category));
        const theme = Array.from(activityCategories).join(' & ') || 'City Exploration';
        // Determine main area based on activities
        const mainArea = activities.length > 0
            ? activities[0].location.split(',')[0]
            : destination;
        // Generate commentary
        const commentary = `Day ${dayNumber} features ${selectedActivities.length} carefully selected activities in ${mainArea}, including ${selectedActivities.map(a => a.name).join(', ')}. The day is balanced with appropriate breaks and follows a ${activities[0]?.timeSlot || 'moderate'} pace.`;
        // Calculate routes between locations
        const routes = [];
        for (let i = 0; i < locations.length - 1; i++) {
            routes.push({
                from: locations[i].name,
                to: locations[i + 1].name,
                mode: 'transit',
                duration: 30, // Default duration in minutes
                distance: '2 km' // Would need to be calculated based on actual coordinates
            });
        }
        return {
            dayNumber,
            theme,
            mainArea,
            commentary,
            highlights: selectedActivities.map(a => a.name),
            mapData: {
                center: {
                    latitude: 0,
                    longitude: 0,
                },
                bounds: {
                    north: 0,
                    south: 0,
                    east: 0,
                    west: 0,
                },
                locations,
                routes
            },
            breaks,
            logistics: {
                transportSuggestions: [
                    'Use public transportation between major attractions',
                    'Walking is recommended for nearby locations',
                    'Taxis available for evening activities'
                ],
                walkingDistances: [
                    'Average walking distance between activities: 15-20 minutes',
                    'Most attractions are within walking distance',
                    'Public transport recommended for distances over 2km'
                ],
                timeEstimates: [
                    'Allow 30 minutes for transportation between activities',
                    'Plan for security checks at major attractions',
                    'Consider rush hour when planning morning activities'
                ]
            }
        };
    }
    async optimizeSchedule(activities, days, destination) {
        try {
            logger.info('[Agents] Starting schedule optimization', {
                totalActivities: activities.length,
                days,
                destination
            });
            // Sort activities by day number and time slot
            const sortedActivities = [...activities].sort((a, b) => {
                if (a.dayNumber !== b.dayNumber) {
                    return a.dayNumber - b.dayNumber;
                }
                const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
                return timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
            });
            // Group activities by day
            const groupedByDay = sortedActivities.reduce((acc, activity) => {
                if (!acc[activity.dayNumber]) {
                    acc[activity.dayNumber] = [];
                }
                acc[activity.dayNumber].push(activity);
                return acc;
            }, {});
            // Validate and adjust time slots within each day
            const optimizedActivities = [];
            for (let day = 1; day <= days; day++) {
                const dayActivities = groupedByDay[day] || [];
                // Ensure we have activities for each time slot
                const timeSlots = ['morning', 'afternoon', 'evening'];
                const existingTimeSlots = new Set(dayActivities.map(a => a.timeSlot));
                timeSlots.forEach(slot => {
                    const activitiesInSlot = dayActivities.filter(a => a.timeSlot === slot);
                    if (activitiesInSlot.length === 0) {
                        // Add placeholder activity if needed
                        const placeholderActivity = {
                            name: `Free Time - ${slot}`,
                            description: `Explore ${destination} at your own pace`,
                            category: 'Free Time',
                            timeSlot: slot,
                            dayNumber: day,
                            duration: 120,
                            price: { amount: 0, currency: 'USD' },
                            selected: true
                        };
                        dayActivities.push(placeholderActivity);
                    }
                });
                // Sort activities within the day by time slot
                const sortedDayActivities = dayActivities.sort((a, b) => {
                    const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
                    return timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
                });
                optimizedActivities.push(...sortedDayActivities);
            }
            logger.info('[Agents] Schedule optimization completed', {
                originalCount: activities.length,
                optimizedCount: optimizedActivities.length,
                daysScheduled: new Set(optimizedActivities.map(a => a.dayNumber)).size
            });
            return optimizedActivities;
        }
        catch (error) {
            logger.error('[Agents] Error optimizing schedule:', error);
            return activities; // Return original activities if optimization fails
        }
    }
    getDayTheme(activities) {
        try {
            // Get the most common category as the theme
            const categoryCount = activities.reduce((acc, activity) => {
                acc[activity.category] = (acc[activity.category] || 0) + 1;
                return acc;
            }, {});
            const sortedCategories = Object.entries(categoryCount)
                .sort(([, a], [, b]) => b - a);
            if (sortedCategories.length === 0) {
                return 'Exploration Day';
            }
            const [mainCategory] = sortedCategories[0];
            const themeMap = {
                'Cultural & Historical': 'Cultural Discovery',
                'Food & Entertainment': 'Culinary & Entertainment',
                'Nature & Adventure': 'Nature & Adventure',
                'Shopping & Leisure': 'Shopping & Leisure',
                'Free Time': 'Flexible Exploration'
            };
            return themeMap[mainCategory] || `${mainCategory} Day`;
        }
        catch (error) {
            logger.error('[Agents] Error determining day theme:', error);
            return 'Exploration Day';
        }
    }
    getMainArea(activities) {
        try {
            // Get the most common location/area mentioned in activities
            const locationCount = activities.reduce((acc, activity) => {
                if (activity.location) {
                    const location = activity.location.split(',')[0].trim(); // Take first part of location
                    acc[location] = (acc[location] || 0) + 1;
                }
                return acc;
            }, {});
            const sortedLocations = Object.entries(locationCount)
                .sort(([, a], [, b]) => b - a);
            if (sortedLocations.length === 0) {
                return 'Various Locations';
            }
            return sortedLocations[0][0];
        }
        catch (error) {
            logger.error('[Agents] Error determining main area:', error);
            return 'Various Locations';
        }
    }
    async enrichActivity(activity) {
        // ... existing code ...
        return {
            ...activity,
            itineraryHighlight: `${activity.name} - ${activity.description || 'Experience this amazing activity'} (${activity.duration} mins)`,
            commentary: `Enjoy ${activity.name} in ${activity.location}. ${activity.description || ''} Perfect for ${activity.category} enthusiasts.`,
            bookableTimeSlots: [{
                    startTime: activity.startTime,
                    endTime: this.calculateEndTime(activity.startTime, activity.duration),
                    availability: activity.availability
                }]
        };
    }
    calculateEndTime(startTime, durationMinutes) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + durationMinutes;
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMinutes = totalMinutes % 60;
        return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
    }
}
