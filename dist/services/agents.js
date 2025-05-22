import fetch from 'node-fetch';
import { perplexityClient } from '../services/perplexity.js';
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
    flightService;
    startTime = Date.now();
    dayThemes = null;
    constructor(flightService) {
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
        // Collect all airport codes for city name lookup
        const airportCodes = [];
        // Add outbound segment airport codes
        segments.forEach(segment => {
            if (segment.departure?.iataCode)
                airportCodes.push(segment.departure.iataCode);
            if (segment.arrival?.iataCode)
                airportCodes.push(segment.arrival.iataCode);
        });
        // Add return segment airport codes
        returnSegments.forEach(segment => {
            if (segment.departure?.iataCode)
                airportCodes.push(segment.departure.iataCode);
            if (segment.arrival?.iataCode)
                airportCodes.push(segment.arrival.iataCode);
        });
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
            // Add airportCodes for city name lookup in the frontend
            airportCodes: [...new Set(airportCodes)],
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
            // Add missing variable declarations
            let flightData = [];
            let errors = [];
            const response = {
                success: true,
                type: 'vacation',
                summary: {
                    totalCost: 0,
                    accommodation: 0,
                    transportation: 0,
                    activities: 0,
                    food: 0,
                    other: 0
                },
                breakdown: {
                    accommodation: [],
                    transportation: [],
                    activities: [],
                    food: [],
                    other: []
                },
            };
            // Determine budget distribution based on the country
            const budgetDistribution = this.getBudgetDistribution(request.destinations[0].label);
            // If we have flight data in the request, use it
            if (request.flightData && request.flightData.length > 0) {
                flightData = request.flightData;
                logger.info('[VacationBudgetAgent] Using provided flight data', {
                    count: flightData.length,
                    firstFlight: flightData[0]?.id
                });
            }
            else {
                // Try to get flight data with retries
                const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
                logger.info('[VacationBudgetAgent] Searching for flights', {
                    origin: request.departureLocation.code,
                    destination: request.destinations[0].code,
                    outboundDate: new Date(request.startDate).toISOString().split('T')[0],
                    returnDate: new Date(request.endDate).toISOString().split('T')[0],
                    travelers: Number(request.travelers)
                });
                // Sequential search with delay between requests to avoid rate limiting
                for (const travelClass of cabinClasses) {
                    try {
                        logger.info(`[VacationBudgetAgent] Searching for ${travelClass} flights`);
                        const formattedDepartureDate = new Date(request.startDate).toISOString().split('T')[0];
                        const formattedReturnDate = new Date(request.endDate).toISOString().split('T')[0];
                        const result = await this.flightService.searchFlights({
                            segments: [{
                                    originLocationCode: request.departureLocation.code,
                                    destinationLocationCode: request.destinations[0].code,
                                    departureDate: formattedDepartureDate
                                }, {
                                    originLocationCode: request.destinations[0].code,
                                    destinationLocationCode: request.departureLocation.code,
                                    departureDate: formattedReturnDate
                                }],
                            adults: Number(request.travelers),
                            travelClass
                        });
                        if (result && result.length > 0) {
                            logger.info(`[VacationBudgetAgent] Found ${result.length} ${travelClass} flights`);
                            flightData.push(...result);
                        }
                        else {
                            logger.warn(`[VacationBudgetAgent] No ${travelClass} flights found`);
                        }
                        // Add delay between requests to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    catch (error) {
                        logger.warn(`[VacationBudgetAgent] Failed to fetch ${travelClass} flights`, {
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                        errors.push(error);
                        // Add longer delay after error
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
            // Only throw error if we have no flight data at all
            if (flightData.length === 0) {
                logger.error('[VacationBudgetAgent] No flight data available after all attempts', {
                    errors: errors.map(e => e.message)
                });
                throw new Error('No flights available for the specified dates and route. Please try different dates or destinations.');
            }
            // Log the flight search results with statistics by cabin class
            logger.info('[VacationBudgetAgent] Flight search results:', {
                totalFlights: flightData.length,
                byClass: {
                    economy: flightData.filter(f => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'ECONOMY').length,
                    premiumEconomy: flightData.filter(f => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'PREMIUM_ECONOMY').length,
                    business: flightData.filter(f => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'BUSINESS').length,
                    first: flightData.filter(f => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'FIRST').length
                },
                priceRange: flightData.length > 0 ? {
                    min: Math.min(...flightData.map(f => parseFloat(f.price.total))),
                    max: Math.max(...flightData.map(f => parseFloat(f.price.total))),
                    currency: flightData[0].price.currency
                } : null
            });
            // Calculate number of days
            const days = Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / (1000 * 60 * 60 * 24));
            // Ensure we have a valid API base URL
            const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
            // Log Viator destination lookup attempt
            logger.info('[Viator] Looking up destination codes:', {
                searchDestination: request.destinations[0].label,
                destinationCode: request.destinations[0].code
            });
            try {
                // Check if we have a Viator API key
                if (!process.env.VIATOR_API_KEY) {
                    logger.warn('[Viator] No API key found, skipping destination lookup');
                }
                else {
                    // Call Viator destinations endpoint
                    const viatorResponse = await fetch('https://api.viator.com/partner/destinations', {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'exp-api-key': process.env.VIATOR_API_KEY
                        }
                    });
                    if (viatorResponse.ok) {
                        const viatorData = await viatorResponse.json();
                        const matchingDestinations = viatorData.data?.filter((d) => d.destinationName.toLowerCase().includes(request.destinations[0].label.toLowerCase()) ||
                            d.lookupId.includes(request.destinations[0].code)).map((d) => ({
                            destinationId: d.destinationId,
                            destinationName: d.destinationName,
                            lookupId: d.lookupId,
                            parentId: d.parentId
                        }));
                        logger.info('[Viator] Destinations response:', {
                            status: viatorResponse.status,
                            matchingDestinations,
                            totalDestinations: viatorData.data?.length || 0
                        });
                        if (matchingDestinations.length === 0) {
                            logger.warn('[Viator] No matching destinations found for:', {
                                searchDestination: request.destinations[0].label,
                                destinationCode: request.destinations[0].code
                            });
                        }
                    }
                    else {
                        const errorText = await viatorResponse.text();
                        logger.error('[Viator] Failed to fetch destinations:', {
                            status: viatorResponse.status,
                            statusText: viatorResponse.statusText,
                            error: errorText
                        });
                    }
                }
            }
            catch (error) {
                logger.error('[Viator] Error fetching destinations:', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
            // Generate activities
            const activitiesResponse = await fetch(`${apiBaseUrl}/api/activities/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    destination: request.destinations[0].label,
                    destinations: request.destinations, // Pass the full destinations array
                    days,
                    budget: request.budgetLimit,
                    currency: request.currency || 'USD',
                    startDate: request.startDate,
                    endDate: request.endDate,
                    preferences: {
                        travelStyle: request.preferences?.travelStyle || 'balanced',
                        pacePreference: request.preferences?.pacePreference || 'moderate',
                        interests: request.preferences?.interests || ['General'],
                        accessibility: request.preferences?.accessibility || [],
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
                    // Generate daily plans
                    const dailyPlans = [];
                    for (let i = 0; i < days; i++) {
                        const dayActivities = transformedActivities.filter(activity => !activity.dayNumber || activity.dayNumber === (i + 1));
                        if (dayActivities.length > 0) {
                            dailyPlans.push(this.generateDailyPlan(i + 1, dayActivities, request.destinations[0].label));
                        }
                    }
                    response.dailyPlans = dailyPlans;
                    // Create our own dayHighlights using the optimized themes
                    const customDayHighlights = dailyPlans.map(plan => {
                        // Get the activities for this day
                        const dayActivities = transformedActivities.filter(activity => activity.dayNumber === plan.dayNumber);
                        // Create highlights for the activities
                        const activityHighlights = dayActivities.map(activity => {
                            const duration = Math.round(activity.duration / 60);
                            return `${activity.name} (${duration}h) - ${activity.description.split('.')[0]}.`;
                        });
                        // Filter activities by rating, checking if the rating property exists
                        const topAttractions = dayActivities
                            .filter(a => {
                            // Check if the rating property exists and is >= 4.5
                            return typeof a['rating'] !== 'undefined' && a['rating'] >= 4.5;
                        })
                            .map(a => a.name);
                        return {
                            dayNumber: plan.dayNumber,
                            theme: plan.theme, // Use our optimized theme from the dailyPlan
                            highlights: activityHighlights,
                            mainAttractions: topAttractions.length > 0 ? topAttractions : [dayActivities[0]?.name || 'City exploration']
                        };
                    });
                    // Override the dayHighlights with our custom ones if we have them
                    if (customDayHighlights.length > 0) {
                        logger.info('[VacationBudgetAgent] Using custom day highlights with optimized themes');
                        response.dayHighlights = customDayHighlights;
                    }
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
        try {
            // First, enrich all activities with Viator data
            const enrichedActivities = [];
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
                    // Transform and enrich the activity
                    const transformed = await this.validateAndTransformActivity(activity, destination);
                    logger.debug('[Agents] Activity transformed:', {
                        name: transformed.name,
                        dayNumber: transformed.dayNumber,
                        timeSlot: transformed.timeSlot,
                        price: transformed.price,
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
                    enrichedActivities.push(transformed);
                }
                catch (error) {
                    logger.error('[Agents] Error transforming activity:', {
                        activity: activity.name,
                        error: error instanceof Error ? error.message : 'Unknown error',
                        stack: error instanceof Error ? error.stack : undefined
                    });
                }
            }
            // Only after all activities are enriched, optimize the schedule
            logger.info('[Agents] Starting schedule optimization with enriched activities');
            const optimizedActivities = await this.optimizeSchedule(enrichedActivities, days, destination);
            // Log final schedule details
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
                enrichedCount: enrichedActivities.length,
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
        catch (error) {
            logger.error('[Agents] Error in transformActivities:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    async validateAndTransformActivity(activity, destination) {
        logger.info(`[Activity] Starting activity transformation:`, {
            name: activity.name,
            destination
        });
        try {
            // Extract price and availability information
            const price = activity.price?.amount || 0;
            const availabilityData = activity.availability || {};
            // Get real-time availability data or use defaults
            let exactStartTimes = availabilityData.exactStartTimes || [];
            // If no times available, provide defaults based on timeSlot
            if (exactStartTimes.length === 0) {
                logger.warn(`[Activity] No available times found for activity: ${activity.name}, using defaults`);
                const defaultTime = activity.timeSlot === 'morning' ? '09:00' :
                    activity.timeSlot === 'afternoon' ? '14:00' :
                        activity.timeSlot === 'evening' ? '19:00' : '09:00';
                exactStartTimes = [defaultTime];
            }
            // Categorize times into slots
            const timesByCategory = {
                morning: exactStartTimes.filter(time => {
                    const hour = parseInt(time.split(':')[0]);
                    return hour >= 6 && hour < 12;
                }),
                afternoon: exactStartTimes.filter(time => {
                    const hour = parseInt(time.split(':')[0]);
                    return hour >= 12 && hour < 17;
                }),
                evening: exactStartTimes.filter(time => {
                    const hour = parseInt(time.split(':')[0]);
                    return hour >= 17;
                })
            };
            // Get available time slots (slots that have times)
            const availableTimeSlots = Object.entries(timesByCategory)
                .filter(([_, times]) => times && times.length > 0)
                .map(([slot]) => slot);
            // Determine time slot based on duration and available times
            const timeSlot = activity.timeSlot || determineTimeSlot(exactStartTimes[0], activity.duration);
            // Find the best start time using proper selection logic
            let startTime;
            // Step 1: Try to use existing start time if it's valid (not default) and available
            if (activity.startTime &&
                activity.startTime !== "09:00" &&
                exactStartTimes.includes(activity.startTime)) {
                startTime = activity.startTime;
                logger.info(`[Activity] Using existing valid start time for "${activity.name}":`, {
                    startTime,
                    timeSlot
                });
            }
            // Step 2: Try to find best time from available times in the preferred slot
            else if (timesByCategory[timeSlot]?.length > 0) {
                startTime = timesByCategory[timeSlot][0];
                logger.info(`[Activity] Using time from preferred slot for "${activity.name}":`, {
                    startTime,
                    timeSlot,
                    availableTimes: timesByCategory[timeSlot]
                });
            }
            // Step 3: Use the first available time as fallback
            else {
                startTime = exactStartTimes[0];
                logger.info(`[Activity] Using first available time for "${activity.name}":`, {
                    startTime,
                    timeSlot,
                    allTimes: exactStartTimes
                });
            }
            // Transform the activity with validated data
            const transformedActivity = {
                ...activity,
                timeSlot,
                startTime,
                availability: {
                    isAvailable: true,
                    availableTimeSlots,
                    exactStartTimes,
                    timesByCategory: {
                        morning: timesByCategory.morning,
                        afternoon: timesByCategory.afternoon,
                        evening: timesByCategory.evening
                    },
                    realTimeVerification: {
                        verified: true,
                        exactStartTimes,
                        lastChecked: new Date().toISOString()
                    }
                }
            };
            return transformedActivity;
        }
        catch (error) {
            logger.error(`[Activity] Error transforming activity:`, {
                name: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            // Return activity with default values instead of throwing
            const defaultTime = activity.timeSlot === 'morning' ? '09:00' :
                activity.timeSlot === 'afternoon' ? '14:00' :
                    activity.timeSlot === 'evening' ? '19:00' : '09:00';
            return {
                ...activity,
                timeSlot: activity.timeSlot || 'morning',
                startTime: defaultTime,
                availability: {
                    isAvailable: true,
                    availableTimeSlots: [activity.timeSlot || 'morning'],
                    exactStartTimes: [defaultTime],
                    timesByCategory: {
                        morning: activity.timeSlot === 'morning' ? [defaultTime] : [],
                        afternoon: activity.timeSlot === 'afternoon' ? [defaultTime] : [],
                        evening: activity.timeSlot === 'evening' ? [defaultTime] : []
                    },
                    realTimeVerification: {
                        verified: false,
                        exactStartTimes: [defaultTime],
                        lastChecked: new Date().toISOString()
                    }
                }
            };
        }
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
        // Generate theme based on activities - use optimized theme from Perplexity if available
        let theme;
        if (this.dayThemes && this.dayThemes.has(dayNumber)) {
            // Use the optimized theme from Perplexity
            theme = this.dayThemes.get(dayNumber).theme;
            logger.info('[Agents] Using optimized theme for day', {
                dayNumber,
                theme,
                explanation: this.dayThemes.get(dayNumber).explanation
            });
        }
        else {
            // Fall back to calculating a theme based on activities
            const activityCategories = new Set(activities.map(a => a.category));
            theme = Array.from(activityCategories).join(' & ') || 'City Exploration';
            logger.info('[Agents] Generated fallback theme for day', {
                dayNumber,
                theme,
                method: 'category-based'
            });
        }
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
            // Optimize schedule for each day using Perplexity
            const optimizedActivities = [];
            for (let day = 1; day <= days; day++) {
                const dayActivities = groupedByDay[day] || [];
                // Ensure we have activities for each time slot
                const timeSlots = ['morning', 'afternoon', 'evening'];
                const existingTimeSlots = new Set(dayActivities.map(a => a.timeSlot));
                for (const slot of timeSlots) {
                    const activitiesInSlot = dayActivities.filter(a => a.timeSlot === slot);
                    if (activitiesInSlot.length === 0) {
                        // Add placeholder activity if needed
                        const placeholderActivity = {
                            name: `Free Time - ${slot}`,
                            description: `Explore ${destination} at your own pace`,
                            category: 'Free Time',
                            timeSlot: slot,
                            dayNumber: day,
                            duration: 150,
                            price: { amount: 0, currency: 'USD' },
                            selected: true,
                            location: destination,
                            availability: {
                                isAvailable: true,
                                availableTimeSlots: [],
                                exactStartTimes: [],
                                timesByCategory: {
                                    morning: [],
                                    afternoon: [],
                                    evening: []
                                },
                                realTimeVerification: {
                                    verified: true,
                                    exactStartTimes: [],
                                    lastChecked: new Date().toISOString()
                                }
                            }
                        };
                        dayActivities.push(placeholderActivity);
                    }
                }
                // Sort activities within the day by time slot
                const sortedDayActivities = dayActivities.sort((a, b) => {
                    const timeSlotOrder = { morning: 0, afternoon: 1, evening: 2 };
                    return timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
                });
                // Optimize start times for the day's activities
                const optimizedDayActivities = await this.optimizeDaySchedule(sortedDayActivities, day);
                optimizedActivities.push(...optimizedDayActivities);
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
            return activities;
        }
    }
    async optimizeDaySchedule(activities, dayNumber) {
        try {
            // Create a prompt for Perplexity to optimize the schedule
            const prompt = `Optimize this daily schedule for day ${dayNumber}:

Activities to schedule:
${activities.map(a => `- ${a.name} (Duration: ${a.duration} minutes, Preferred time: ${a.timeSlot})
  Available times: ${a.availability.exactStartTimes.join(', ')}
  Category: ${a.category}`).join('\n')}

Requirements:
1. Assign specific start times to each activity
2. Respect the available times for each activity
3. Maintain proper spacing between activities (15-30 minutes buffer)
4. Consider typical meal times (lunch 12:00-14:00, dinner after 18:00)
5. Account for travel time between locations
6. Ensure activities don't overlap
7. Generate a specific, descriptive day theme based on the activities' focus

For the day theme, DO NOT use generic themes like "Mixed Activities". Instead:
- If activities share common categories, create a theme that captures their essence
- Consider the specific attractions (e.g., "Seine River Exploration" instead of "Water Activities")
- Use specific adjectives that highlight the unique appeal (e.g., "Historic Paris Discovery")
- For varied activities, find a cohesive narrative (e.g., "Paris Highlights: Art & Cuisine")
- Museum-focused days should highlight the specific collections or styles
- Food activities should reference the cuisine type or dining experience
- Outdoor activities should reference the specific landmarks or natural features

Return a JSON schedule with exact start times for each activity and day theme:
{
  "dayTheme": "Specific themed name for this day's activities",
  "themeExplanation": "Brief explanation of why this theme fits",
  "optimizedSchedule": [
    {
      "activityName": "string",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "timeSlot": "morning|afternoon|evening"
    }
  ]
}`;
            // Get optimized schedule from Perplexity
            const result = await perplexityClient.chat(prompt);
            const schedule = JSON.parse(result.choices[0].message.content);
            // Log the theme information
            logger.info(`[Schedule] Day ${dayNumber} theme generated:`, {
                theme: schedule.dayTheme,
                explanation: schedule.themeExplanation
            });
            // Store the theme in a global map for later use
            if (!this.dayThemes) {
                this.dayThemes = new Map();
            }
            this.dayThemes.set(dayNumber, {
                theme: schedule.dayTheme,
                explanation: schedule.themeExplanation
            });
            // Map the optimized times back to activities
            return activities.map(activity => {
                const optimizedActivity = schedule.optimizedSchedule.find((opt) => opt.activityName === activity.name);
                if (optimizedActivity) {
                    return {
                        ...activity,
                        startTime: optimizedActivity.startTime,
                        availability: {
                            ...activity.availability,
                            timesByCategory: {
                                morning: activity.availability.exactStartTimes.filter(time => {
                                    const hour = parseInt(time.split(':')[0]);
                                    return hour >= 6 && hour < 12;
                                }),
                                afternoon: activity.availability.exactStartTimes.filter(time => {
                                    const hour = parseInt(time.split(':')[0]);
                                    return hour >= 12 && hour < 17;
                                }),
                                evening: activity.availability.exactStartTimes.filter(time => {
                                    const hour = parseInt(time.split(':')[0]);
                                    return hour >= 17;
                                })
                            },
                            realTimeVerification: {
                                ...activity.availability.realTimeVerification,
                                verified: true
                            }
                        }
                    };
                }
                return activity;
            });
        }
        catch (error) {
            logger.error('[Agents] Error optimizing day schedule:', {
                dayNumber,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return activities;
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
    determineTimeSlotByIndex(index) {
        switch (index) {
            case 0: return 'morning';
            case 1: return 'afternoon';
            case 2: return 'evening';
            default: return 'morning';
        }
    }
    // Add this method to the VacationBudgetAgent class
    /**
     * Returns the budget distribution percentages based on destination
     * @param destination The destination to get budget distribution for
     * @returns Budget distribution percentages for different categories
     */
    getBudgetDistribution(destination) {
        logger.info('[VacationBudgetAgent] Getting budget distribution for', { destination });
        // Default distribution
        const defaultDistribution = {
            flights: 40,
            accommodation: 30,
            activities: 15,
            food: 10,
            other: 5
        };
        // You can add destination-specific distributions here if needed
        const destinationMap = {
            'Paris': {
                flights: 35,
                accommodation: 35,
                activities: 15,
                food: 12,
                other: 3
            },
            'London': {
                flights: 30,
                accommodation: 40,
                activities: 15,
                food: 10,
                other: 5
            },
            'Tokyo': {
                flights: 45,
                accommodation: 30,
                activities: 10,
                food: 12,
                other: 3
            },
            'New York': {
                flights: 30,
                accommodation: 40,
                activities: 12,
                food: 13,
                other: 5
            }
        };
        // Check if we have a specific distribution for this destination
        for (const [key, distribution] of Object.entries(destinationMap)) {
            if (destination.includes(key)) {
                logger.info('[VacationBudgetAgent] Using custom budget distribution for', {
                    destination,
                    distribution
                });
                return distribution;
            }
        }
        // Fall back to default distribution
        logger.info('[VacationBudgetAgent] Using default budget distribution', {
            distribution: defaultDistribution
        });
        return defaultDistribution;
    }
}
// Helper function to determine time slot based on start time and duration
function determineTimeSlot(time, duration) {
    const [hours, minutes] = time.split(':').map(Number);
    const startHour = hours;
    const endHour = hours + Math.floor((minutes + duration) / 60);
    // If the activity spans multiple slots, use the start slot
    if (startHour >= 6 && startHour < 12) {
        return 'morning';
    }
    else if (startHour >= 12 && startHour < 17) {
        return 'afternoon';
    }
    else {
        return 'evening';
    }
}
// Helper function to find the best start time for a given time slot
function findBestStartTime(availableTimes, timeSlot, duration) {
    const slotBoundaries = {
        morning: { start: 6, end: 12 },
        afternoon: { start: 12, end: 17 },
        evening: { start: 17, end: 24 }
    };
    // Filter times that fall within the desired time slot
    const timesInSlot = availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= slotBoundaries[timeSlot].start && hour < slotBoundaries[timeSlot].end;
    });
    if (timesInSlot.length === 0) {
        // If no times in desired slot, use the first available time
        return availableTimes[0];
    }
    // Return the first time in the slot
    return timesInSlot[0];
}
