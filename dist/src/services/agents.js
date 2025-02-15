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
            airline: firstSegment.carrierCode,
            route,
            price: parseFloat(flight.price.total),
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
            })
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
        this.startTime = Date.now();
        logger.info('Starting budget calculation');
        // Initialize arrays to store flight data
        let flightData = [];
        let errors = [];
        // If we have flight data in the request, use it
        if (request.flightData && request.flightData.length > 0) {
            flightData = request.flightData;
        }
        else {
            // Try to get flight data with retries
            const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
            // Sequential search with delay between requests
            for (const travelClass of cabinClasses) {
                try {
                    const result = await this.flightService.searchFlights({
                        segments: [{
                                originLocationCode: request.departureLocation.code,
                                destinationLocationCode: request.destinations[0].code,
                                departureDate: request.startDate || ''
                            }],
                        adults: request.travelers,
                        travelClass
                    });
                    if (result && result.length > 0) {
                        flightData.push(...result);
                    }
                    // Add delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                catch (error) {
                    logger.warn(`Failed to fetch flights for ${travelClass}`, { error });
                    errors.push(error);
                    // Add longer delay after error
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        // Only throw error if we have no flight data at all
        if (flightData.length === 0) {
            logger.error('No flight data available after all attempts', { errors });
            throw new Error('No flight data available');
        }
        // Process the flight data we have
        const groupedFlights = this.groupFlightsByTier(flightData);
        const response = {
            requestDetails: {
                departureLocation: request.departureLocation,
                destinations: request.destinations,
                travelers: request.travelers,
                startDate: request.startDate || '',
                endDate: request.endDate || '',
                currency: request.currency
            },
            flights: {
                budget: groupedFlights.budget || this.getDefaultCategoryData('flights').flights.budget,
                medium: groupedFlights.medium || this.getDefaultCategoryData('flights').flights.medium,
                premium: groupedFlights.premium || this.getDefaultCategoryData('flights').flights.premium
            }
        };
        // Process other categories with Perplexity (excluding flights)
        const categories = ['localTransportation', 'food', 'activities'];
        console.log(`[TIMING] Processing ${categories.length} categories with Perplexity`);
        const results = await Promise.all(categories.map(async (category) => {
            const categoryStart = Date.now();
            console.log(`[TIMING][${category}] Starting category processing`);
            const prompt = this.constructPrompt({ category, request });
            console.log(`[TIMING][${category}] Prompt constructed in ${Date.now() - categoryStart}ms`);
            const data = await this.queryPerplexity(prompt, category);
            console.log(`[TIMING][${category}] Perplexity query completed in ${Date.now() - categoryStart}ms`);
            return { category, data };
        }));
        // Add Perplexity category data to the response
        results.forEach(({ category, data }) => {
            response[category] = data[category];
        });
        const totalTime = Date.now() - this.startTime;
        console.log(`[TIMING] Total budget calculation completed in ${totalTime}ms`);
        if (totalTime > 25000) {
            console.warn(`[TIMING] Warning: Budget calculation took longer than 25 seconds`);
        }
        return response;
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
        const { destination, category, userPreferences } = params;
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
    constructHotelPrompt(request) {
        const destination = request.destinations[0].label;
        const checkIn = request.startDate;
        const checkOut = request.endDate;
        const travelers = request.travelers;
        const budget = request.budget;
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
        if (price <= 30) {
            return 'budget';
        }
        else if (price <= 100) {
            return 'medium';
        }
        else {
            return 'premium';
        }
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
    async transformActivities(validActivities, days) {
        logger.debug('Starting activity transformation', {
            totalActivities: validActivities.length,
            days
        });
        // First, filter out activities without essential fields and deduplicate
        const uniqueActivities = validActivities.reduce((acc, activity) => {
            // Check only essential fields
            if (!activity.name || !activity.price) {
                logger.warn('Skipping activity missing essential fields', {
                    name: activity.name,
                    hasPrice: !!activity.price
                });
                return acc;
            }
            // Check for duplicates (same name and price)
            const isDuplicate = acc.some(existing => existing.name.toLowerCase() === activity.name.toLowerCase() &&
                Math.abs(existing.price - activity.price) < 0.01);
            if (!isDuplicate) {
                acc.push(activity);
            }
            else {
                logger.debug('Filtered out duplicate activity', {
                    name: activity.name,
                    price: activity.price
                });
            }
            return acc;
        }, []);
        logger.debug('After deduplication', {
            originalCount: validActivities.length,
            uniqueCount: uniqueActivities.length
        });
        // Group activities by day and time slot
        const activityGroups = uniqueActivities.reduce((acc, activity) => {
            const day = activity.day || activity.dayNumber || activity.day_number || 1;
            const timeSlot = activity.preferred_time_of_day || activity.timeSlot || 'morning';
            const tier = this.determineActivityTier(activity.price);
            if (!acc[day]) {
                acc[day] = {
                    morning: { budget: [], medium: [], premium: [] },
                    afternoon: { budget: [], medium: [], premium: [] },
                    evening: { budget: [], medium: [], premium: [] }
                };
            }
            if (acc[day][timeSlot] && acc[day][timeSlot][tier]) {
                acc[day][timeSlot][tier].push({
                    ...activity,
                    // Add default booking details - these will be enriched later by Viator API
                    bookingDetails: {
                        provider: 'Viator',
                        referenceUrl: `https://www.viator.com/tours/${activity.name.replace(/[^a-zA-Z0-9]+/g, '-')}`,
                        cancellationPolicy: 'Free cancellation up to 24 hours before the activity starts',
                        instantConfirmation: true,
                        mobileTicket: true,
                        languages: ['English'],
                        minParticipants: 1,
                        maxParticipants: 50,
                        pickupIncluded: tier === 'premium',
                        pickupLocation: tier === 'premium' ? 'Your hotel' : '',
                        accessibility: 'Standard',
                        restrictions: []
                    }
                });
            }
            return acc;
        }, {});
        // Transform activities
        const transformedActivities = [];
        for (let day = 1; day <= days; day++) {
            const dayActivities = activityGroups[day] || {
                morning: { budget: [], medium: [], premium: [] },
                afternoon: { budget: [], medium: [], premium: [] },
                evening: { budget: [], medium: [], premium: [] }
            };
            ['morning', 'afternoon', 'evening'].forEach((timeSlot) => {
                ['budget', 'medium', 'premium'].forEach((tier) => {
                    const activities = dayActivities[timeSlot][tier];
                    if (activities.length === 0) {
                        const placeholder = this.createPlaceholderActivity({
                            dayNumber: day,
                            timeSlot,
                            tier
                        });
                        activities.push(placeholder);
                    }
                    activities.forEach((activity) => {
                        transformedActivities.push({
                            ...activity,
                            dayNumber: day,
                            timeSlot,
                            tier
                        });
                    });
                });
            });
        }
        logger.debug('Activity transformation complete', {
            transformedCount: transformedActivities.length,
            daysProcessed: days
        });
        return transformedActivities;
    }
    hasValidBookingDetails(activity) {
        // Less strict URL validation - just check if it's a valid URL for the provider
        const isViatorUrl = (url) => url.includes('viator.com');
        const isGetYourGuideUrl = (url) => url.includes('getyourguide.com');
        const isValid = activity.bookingDetails &&
            (activity.bookingDetails.provider === 'Viator' || activity.bookingDetails.provider === 'GetYourGuide') &&
            activity.bookingDetails.referenceUrl &&
            activity.bookingDetails.referenceUrl.length > 0 &&
            ((activity.bookingDetails.provider === 'Viator' && isViatorUrl(activity.bookingDetails.referenceUrl)) ||
                (activity.bookingDetails.provider === 'GetYourGuide' && isGetYourGuideUrl(activity.bookingDetails.referenceUrl)));
        // Log validation details
        logger.debug('[Activity Validation]', {
            name: activity.name,
            provider: activity.bookingDetails?.provider,
            url: activity.bookingDetails?.referenceUrl,
            isValid,
            price: activity.price,
            tier: this.determineActivityTier(activity.price),
            isViatorUrl: activity.bookingDetails?.referenceUrl ? isViatorUrl(activity.bookingDetails.referenceUrl) : false,
            isGetYourGuideUrl: activity.bookingDetails?.referenceUrl ? isGetYourGuideUrl(activity.bookingDetails.referenceUrl) : false
        });
        if (!isValid) {
            logger.warn('[Activity Validation] Invalid booking details', {
                name: activity.name,
                provider: activity.bookingDetails?.provider,
                url: activity.bookingDetails?.referenceUrl,
                price: activity.price,
                missingProvider: !activity.bookingDetails?.provider,
                missingUrl: !activity.bookingDetails?.referenceUrl,
                invalidProvider: activity.bookingDetails?.provider !== 'Viator' && activity.bookingDetails?.provider !== 'GetYourGuide',
                invalidUrlFormat: activity.bookingDetails?.referenceUrl ?
                    !isViatorUrl(activity.bookingDetails.referenceUrl) && !isGetYourGuideUrl(activity.bookingDetails.referenceUrl) :
                    true
            });
        }
        return isValid;
    }
    ensureValidBookingDetails(bookingDetails, tier) {
        const provider = tier === 'premium' ? 'Viator' : 'GetYourGuide';
        const baseUrl = provider === 'Viator' ? 'https://www.viator.com' : 'https://www.getyourguide.com';
        return {
            provider,
            referenceUrl: bookingDetails?.referenceUrl || `${baseUrl}/error-invalid-url`,
            cancellationPolicy: bookingDetails?.cancellationPolicy || 'Free cancellation up to 24 hours before the activity starts',
            instantConfirmation: bookingDetails?.instantConfirmation ?? true,
            mobileTicket: bookingDetails?.mobileTicket ?? true,
            languages: bookingDetails?.languages || ['English'],
            minParticipants: bookingDetails?.minParticipants || 1,
            maxParticipants: bookingDetails?.maxParticipants || (tier === 'premium' ? 8 : 50),
            pickupIncluded: bookingDetails?.pickupIncluded ?? (tier === 'premium'),
            pickupLocation: bookingDetails?.pickupLocation || (tier === 'premium' ? 'Your hotel' : ''),
            accessibility: bookingDetails?.accessibility || 'Standard',
            restrictions: bookingDetails?.restrictions || []
        };
    }
    createPlaceholderActivity(params) {
        return {
            name: "Activity Unavailable",
            provider: "Viator",
            price: 0,
            price_category: params?.tier || "budget",
            duration: 2,
            typical_time: params?.timeSlot || "morning",
            description: "No matching activity found. Please try different search criteria.",
            highlights: ["No highlights available"],
            rating: 0,
            review_count: 0,
            booking_url: "",
            languages: ["English"],
            cancellation_policy: "N/A",
            location: {
                meeting_point: "To be determined",
                address: ""
            },
            booking_info: {
                instant_confirmation: false,
                mobile_ticket: false,
                min_participants: 1,
                max_participants: 1
            }
        };
    }
    determineTimeSlot(startTime) {
        const hour = parseInt(startTime.split(':')[0]);
        if (hour >= 5 && hour < 12)
            return 'morning';
        if (hour >= 12 && hour < 17)
            return 'afternoon';
        return 'evening';
    }
    determinePriceCategory(price) {
        if (price < 30)
            return 'budget';
        if (price <= 100)
            return 'medium';
        return 'premium';
    }
}
