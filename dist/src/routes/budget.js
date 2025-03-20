import { Router } from 'express';
import { VacationBudgetAgent } from '../services/agents.js';
import { PrismaClient } from '@prisma/client';
import { cities } from '../data/cities.js';
import { airports } from '../data/airports.js';
import { AmadeusService } from '../services/amadeus.js';
import { normalizeCategory } from '../constants/categories.js';
import { logger } from '../utils/logger.js';
import { optimizeSchedule } from './activities.js';
const router = Router();
const amadeusService = new AmadeusService();
const agent = new VacationBudgetAgent(amadeusService);
const prisma = new PrismaClient();
// Import AIRCRAFT_CODES from amadeus service
const AIRCRAFT_CODES = {
    '319': 'Airbus A319',
    '320': 'Airbus A320',
    '321': 'Airbus A321',
    '32A': 'Airbus A320',
    '32B': 'Airbus A321',
    '32Q': 'Airbus A321neo',
    '32S': 'Airbus A321',
    '32N': 'Airbus A321neo',
    '333': 'Airbus A330-300',
    '359': 'Airbus A350-900',
    '388': 'Airbus A380-800',
    '738': 'Boeing 737-800',
    '73H': 'Boeing 737-800',
    '744': 'Boeing 747-400',
    '767': 'Boeing 767',
    '777': 'Boeing 777',
    '772': 'Boeing 777-200',
    '77W': 'Boeing 777-300ER',
    '787': 'Boeing 787 Dreamliner',
    '788': 'Boeing 787-8 Dreamliner',
    '789': 'Boeing 787-9 Dreamliner',
    'E90': 'Embraer E190',
    'E95': 'Embraer E195',
    'CR9': 'Bombardier CRJ-900',
    'CRJ': 'Bombardier CRJ',
    'DH4': 'Bombardier Q400',
    'AT7': 'ATR 72',
    'AT5': 'ATR 42',
    'E75': 'Embraer E175',
    'E70': 'Embraer E170',
    'A20N': 'Airbus A320neo',
    'A21N': 'Airbus A321neo',
    'B38M': 'Boeing 737 MAX 8',
    'B39M': 'Boeing 737 MAX 9',
    'A339': 'Airbus A330-900neo',
    'A359': 'Airbus A350-900',
    'A35K': 'Airbus A350-1000',
    'B78X': 'Boeing 787-10 Dreamliner',
    '7M9': 'Boeing 737 MAX 9'
};
// Get available cities and airports
router.get('/locations', (req, res) => {
    try {
        console.log('[Budget Route] Fetching available locations');
        res.json({
            success: true,
            data: {
                cities: cities.map(city => ({
                    value: city.value,
                    label: city.label
                })),
                airports: airports.map(airport => ({
                    value: airport.value,
                    label: airport.label
                }))
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('[Budget Route] Error fetching locations:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'An unexpected error occurred',
            timestamp: new Date().toISOString()
        });
    }
});
// Helper function to get primary airport code for a city
function getPrimaryAirportForCity(cityCode) {
    try {
        const cityAirports = airports.filter(airport => airport.cityCode === cityCode);
        if (cityAirports.length > 0) {
            // Return the first airport as primary (they are ordered by importance in the data)
            return cityAirports[0].value;
        }
        // If no mapping found, some airports use the same code as the city
        const directAirport = airports.find(airport => airport.value === cityCode);
        if (directAirport) {
            return directAirport.value;
        }
        console.warn(`[Budget Route] No airport found for city: ${cityCode}`);
        return cityCode; // Fallback to city code
    }
    catch (error) {
        console.error('[Budget Route] Error getting airport code:', error);
        return cityCode; // Return the city code as fallback
    }
}
// Add a helper function for safely calling the helper functions with better error handling
const safelyCallHelper = (fn, args, fnName, defaultValue) => {
    try {
        return fn(...args);
    }
    catch (error) {
        logger.error(`[Budget] Helper function ${fnName} failed:`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : 'No stack trace'
        });
        return defaultValue;
    }
};
// Add validation for enriched activities
function validateEnrichedActivity(activity) {
    const hasValidBookingDetails = activity.bookingDetails &&
        activity.bookingDetails.productCode &&
        activity.bookingDetails.provider === 'Viator';
    const hasValidAvailability = activity.availability &&
        Array.isArray(activity.availability.availableTimeSlots) &&
        activity.availability.realTimeVerification?.verified;
    const hasValidPrice = activity.price &&
        typeof activity.price.amount === 'number' &&
        activity.price.amount > 0 &&
        activity.price.currency;
    return hasValidBookingDetails && hasValidAvailability && hasValidPrice;
}
// Add logging for activity validation
function logActivityValidation(activity) {
    logger.debug('[Budget] Activity validation:', {
        name: activity.name,
        bookingDetails: {
            hasDetails: !!activity.bookingDetails,
            provider: activity.bookingDetails?.provider,
            productCode: activity.bookingDetails?.productCode
        },
        availability: {
            hasAvailability: !!activity.availability,
            isAvailable: activity.availability?.isAvailable,
            hasTimeSlots: !!activity.availability?.availableTimeSlots?.length,
            timeSlots: activity.availability?.availableTimeSlots,
            verified: activity.availability?.realTimeVerification?.verified
        },
        price: {
            hasPrice: !!activity.price,
            amount: activity.price?.amount,
            currency: activity.price?.currency
        },
        timeSlot: activity.timeSlot,
        dayNumber: activity.dayNumber
    });
}
// Calculate budget endpoint
router.post('/calculate', async (req, res) => {
    // Increase timeout for the entire request
    const TIMEOUT = 600000; // 10 minutes to account for multiple flight searches
    const SEARCH_TIMEOUT = 120000; // 2 minutes per search
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), TIMEOUT);
    });
    try {
        console.log('[Budget Route] ====== START BUDGET CALCULATION ======');
        console.log('[Budget Route] Received request:', {
            body: JSON.stringify(req.body, null, 2),
            headers: {
                'content-type': req.headers['content-type'],
                'user-agent': req.headers['user-agent'],
                origin: req.headers.origin,
                host: req.headers.host,
                referer: req.headers.referer
            },
            url: req.url,
            method: req.method
        });
        // Validate required fields
        const missingFields = [];
        if (!req.body.departureLocation?.code)
            missingFields.push('departure location code');
        if (!req.body.departureLocation?.label)
            missingFields.push('departure location label');
        if (!Array.isArray(req.body.destinations) || req.body.destinations.length === 0)
            missingFields.push('destinations');
        if (!req.body.startDate)
            missingFields.push('start date');
        if (!req.body.endDate)
            missingFields.push('end date');
        if (!req.body.travelers)
            missingFields.push('travelers');
        if (missingFields.length > 0) {
            const errorMessage = `Missing required fields: ${missingFields.join(', ')}`;
            logger.error('[Budget Route] Validation error:', {
                error: errorMessage,
                receivedFields: Object.keys(req.body),
                missingFields
            });
            return res.status(400).json({
                success: false,
                error: errorMessage,
                errorDetails: {
                    type: 'VALIDATION_ERROR',
                    missingFields,
                    receivedFields: Object.keys(req.body),
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            });
        }
        // Additional validation for date format and range
        try {
            const startDate = new Date(req.body.startDate);
            const endDate = new Date(req.body.endDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Reset time to start of day for fair comparison
            // Check if dates are valid
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                const errorMessage = 'Invalid date format. Please use YYYY-MM-DD format.';
                logger.error('[Budget Route] Date validation error:', {
                    error: errorMessage,
                    startDate: req.body.startDate,
                    endDate: req.body.endDate
                });
                return res.status(400).json({
                    success: false,
                    error: errorMessage,
                    errorDetails: {
                        type: 'DATE_FORMAT_ERROR',
                        startDate: req.body.startDate,
                        endDate: req.body.endDate,
                        expectedFormat: 'YYYY-MM-DD',
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });
            }
            // Check if start date is in the past
            const startDateOnly = new Date(startDate);
            startDateOnly.setHours(0, 0, 0, 0); // Reset time to start of day for fair comparison
            if (startDateOnly < today) {
                const errorMessage = 'Start date cannot be in the past.';
                logger.error('[Budget Route] Date validation error:', {
                    error: errorMessage,
                    startDate: req.body.startDate,
                    today: today.toISOString().split('T')[0]
                });
                return res.status(400).json({
                    success: false,
                    error: errorMessage,
                    errorDetails: {
                        type: 'PAST_DATE_ERROR',
                        startDate: req.body.startDate,
                        currentDate: today.toISOString().split('T')[0],
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });
            }
            // Check if end date is before start date
            if (endDate < startDate) {
                const errorMessage = 'End date cannot be before start date.';
                logger.error('[Budget Route] Date validation error:', {
                    error: errorMessage,
                    startDate: req.body.startDate,
                    endDate: req.body.endDate
                });
                return res.status(400).json({
                    success: false,
                    error: errorMessage,
                    errorDetails: {
                        type: 'DATE_RANGE_ERROR',
                        startDate: req.body.startDate,
                        endDate: req.body.endDate,
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });
            }
            // Check if trip is too long (more than 30 days)
            const tripDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            if (tripDays > 30) {
                const errorMessage = 'Trip duration cannot exceed 30 days.';
                logger.error('[Budget Route] Trip duration validation error:', {
                    error: errorMessage,
                    startDate: req.body.startDate,
                    endDate: req.body.endDate,
                    duration: tripDays
                });
                return res.status(400).json({
                    success: false,
                    error: errorMessage,
                    errorDetails: {
                        type: 'TRIP_DURATION_ERROR',
                        startDate: req.body.startDate,
                        endDate: req.body.endDate,
                        duration: tripDays,
                        maxDuration: 30,
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });
            }
        }
        catch (validationError) {
            const errorMessage = 'Error validating dates.';
            logger.error('[Budget Route] Date validation error:', {
                error: validationError instanceof Error ? validationError.message : 'Unknown validation error',
                startDate: req.body.startDate,
                endDate: req.body.endDate
            });
            return res.status(400).json({
                success: false,
                error: errorMessage,
                errorDetails: {
                    type: 'DATE_VALIDATION_ERROR',
                    message: validationError instanceof Error ? validationError.message : 'Unknown validation error',
                    startDate: req.body.startDate,
                    endDate: req.body.endDate,
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            });
        }
        // Transform the request to match our internal format
        const transformedRequest = {
            type: req.body.type || 'full',
            departureLocation: {
                code: String(req.body.departureLocation.code),
                label: String(req.body.departureLocation.label),
                airport: req.body.departureLocation.airport || req.body.departureLocation.code,
                outboundDate: String(req.body.startDate),
                inboundDate: String(req.body.endDate),
                isRoundTrip: true
            },
            destinations: req.body.destinations.map((dest) => {
                const city = cities.find(c => c.value === dest.code);
                if (!city) {
                    console.warn('[Budget Route] City not found in database:', dest);
                }
                return {
                    code: city?.value || dest.code,
                    label: city?.label || dest.label,
                    airport: city?.value || dest.code
                };
            }),
            country: req.body.destinations[0].code,
            travelers: parseInt(String(req.body.travelers)),
            currency: String(req.body.currency || 'USD'),
            budget: req.body.budgetLimit ? parseFloat(String(req.body.budgetLimit)) : undefined,
            startDate: String(req.body.startDate),
            endDate: String(req.body.endDate),
            days: Math.ceil((new Date(req.body.endDate).getTime() - new Date(req.body.startDate).getTime()) / (1000 * 60 * 60 * 24))
        };
        // Race between the actual work and the timeout
        const result = await Promise.race([
            (async () => {
                let agentResult;
                // Skip flight search for activities-only requests
                if (req.body.type === 'activities_only') {
                    logger.info('[Budget Route] Activities-only request, skipping flight search');
                    transformedRequest.flightData = [];
                }
                else {
                    // First search for real-time flights with Amadeus
                    logger.info('[Budget Route] Searching for real-time flights with Amadeus...');
                    const formattedDepartureDate = transformedRequest.startDate.split('T')[0];
                    const formattedReturnDate = transformedRequest.endDate.split('T')[0];
                    // Search for flights in all cabin classes with individual timeouts
                    const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
                    const searchPromises = cabinClasses.map(async (cabinClass) => {
                        try {
                            const searchPromise = amadeusService.searchFlights({
                                segments: [{
                                        originLocationCode: transformedRequest.departureLocation.airport,
                                        destinationLocationCode: transformedRequest.destinations[0].airport,
                                        departureDate: formattedDepartureDate
                                    }, {
                                        originLocationCode: transformedRequest.destinations[0].airport,
                                        destinationLocationCode: transformedRequest.departureLocation.airport,
                                        departureDate: formattedReturnDate
                                    }],
                                adults: transformedRequest.travelers,
                                travelClass: cabinClass
                            });
                            // Add timeout to individual search
                            const result = await Promise.race([
                                searchPromise,
                                new Promise((_, reject) => setTimeout(() => reject(new Error(`Search timeout for ${cabinClass}`)), SEARCH_TIMEOUT))
                            ]);
                            return result;
                        }
                        catch (error) {
                            console.warn(`[Budget Route] Search failed for ${cabinClass}:`, error);
                            return [];
                        }
                    });
                    // Wait for all searches to complete
                    const allFlights = (await Promise.all(searchPromises)).flat();
                    if (allFlights.length === 0) {
                        console.warn('[Budget Route] No flights found for any cabin class');
                    }
                    else {
                        console.log('[Budget Route] Flight search results:', {
                            totalFlights: allFlights.length,
                            byClass: {
                                economy: allFlights.filter((f) => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'ECONOMY').length,
                                premiumEconomy: allFlights.filter((f) => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'PREMIUM_ECONOMY').length,
                                business: allFlights.filter((f) => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'BUSINESS').length,
                                first: allFlights.filter((f) => f.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin === 'FIRST').length
                            }
                        });
                        // Add flight data to the transformed request
                        transformedRequest.flightData = allFlights;
                    }
                }
                // Call VacationBudgetAgent with flight data
                logger.info('[Budget Route] Calling VacationBudgetAgent with request:', {
                    type: transformedRequest.type,
                    hasFlightData: !!transformedRequest.flightData?.length,
                    destination: transformedRequest.destinations[0].label,
                    days: transformedRequest.days
                });
                agentResult = await agent.handleTravelRequest({
                    ...transformedRequest,
                    preferences: req.body.preferences,
                    budgetLimit: req.body.budgetLimit
                });
                // Check if agent result is valid before proceeding
                if (!agentResult || (!agentResult.activities && !agentResult.enrichedActivities)) {
                    logger.error('[Budget Route] VacationBudgetAgent failed to return valid result');
                    return {
                        success: false,
                        error: 'Failed to calculate budget and generate initial activities',
                        timestamp: new Date().toISOString()
                    };
                }
                // Use enriched activities if available, otherwise fall back to regular activities
                const activitiesArray = agentResult.enrichedActivities ||
                    (Array.isArray(agentResult.activities) ? agentResult.activities : Object.values(agentResult.activities));
                if (!activitiesArray.length) {
                    logger.error('[Budget Route] No activities found in agent result');
                    return {
                        success: false,
                        error: 'No activities generated',
                        timestamp: new Date().toISOString()
                    };
                }
                // Format existing activities properly before passing them
                const formattedActivities = activitiesArray.map(activity => {
                    // Keep all existing properties
                    const base = { ...activity };
                    // Only fill in missing fields with defaults
                    return {
                        ...base,
                        name: base.name || 'Explore Local Attractions',
                        duration: base.duration || (typeof base.duration === 'string' ?
                            parseInt(base.duration.replace(/[^0-9]/g, '')) * 60 : 120),
                        category: base.category || 'Sightseeing',
                        timeSlot: base.timeSlot || 'morning',
                        startTime: base.startTime || '09:00',
                        selected: typeof base.selected === 'boolean' ? base.selected : false,
                        description: base.description || 'Discover the local culture and attractions in this vibrant city.',
                        location: base.location || 'City Center',
                        price: base.price || {
                            amount: 0,
                            currency: 'USD'
                        },
                        rating: base.rating || 4.5,
                        numberOfReviews: base.numberOfReviews || 100,
                        bookingDetails: base.bookingDetails || {
                            provider: 'Local',
                            instantConfirmation: true,
                            cancellationPolicy: 'Flexible'
                        }
                    };
                });
                logger.info('[Budget] Activities formatting completed', {
                    originalCount: activitiesArray.length,
                    formattedCount: formattedActivities.length,
                    firstActivity: formattedActivities[0] ? {
                        name: formattedActivities[0].name,
                        duration: formattedActivities[0].duration,
                        timeSlot: formattedActivities[0].timeSlot,
                        category: formattedActivities[0].category,
                        price: formattedActivities[0].price,
                        bookingDetails: formattedActivities[0].bookingDetails ? {
                            provider: formattedActivities[0].bookingDetails.provider,
                            productCode: formattedActivities[0].bookingDetails.productCode
                        } : undefined
                    } : null,
                    hasEnrichedActivities: !!agentResult.enrichedActivities,
                    enrichedActivitiesCount: agentResult.enrichedActivities?.length
                });
                // If we have valid activities from the budget agent, use them directly
                if (formattedActivities.length > 0) {
                    logger.info('[Budget] Using activities from budget agent, skipping activities generation');
                    // Create themed activities based on preferences
                    const themedActivities = formattedActivities.map((activity, index) => {
                        const timeSlot = index % 3 === 0 ? 'morning' :
                            index % 3 === 1 ? 'afternoon' : 'evening';
                        const category = req.body.preferences?.interests?.[index % req.body.preferences.interests.length] || 'Culture';
                        return {
                            ...activity,
                            name: activity.name || `${category} Experience in ${transformedRequest.destinations[0].label}`,
                            timeSlot,
                            category,
                            description: activity.description || `Enjoy a ${req.body.preferences?.travelStyle || 'luxury'} ${category.toLowerCase()} experience in ${transformedRequest.destinations[0].label}.`,
                            commentary: `This activity is perfect for travelers interested in ${category.toLowerCase()} with a ${req.body.preferences?.pacePreference || 'moderate'} pace.`,
                            itineraryHighlight: `A ${timeSlot} activity focusing on ${category.toLowerCase()} aspects of the city.`
                        };
                    });
                    // Create optimized schedule using the optimizeSchedule function
                    const optimizedSchedule = await optimizeSchedule(themedActivities, transformedRequest.days, transformedRequest.destinations[0].label, req.body.preferences);
                    return {
                        success: true,
                        data: {
                            ...(agentResult || {}),
                            activities: themedActivities,
                            schedule: optimizedSchedule.schedule,
                            dailyPlans: optimizedSchedule.schedule,
                            dailyHighlights: optimizedSchedule.dailyHighlights,
                            totalBudget: transformedRequest.budget,
                            metadata: {
                                perplexityCalls: 0,
                                scheduleGeneration: {
                                    source: 'budget_agent',
                                    timestamp: new Date().toISOString(),
                                    preferences: req.body.preferences
                                }
                            }
                        }
                    };
                }
                logger.info('[Budget] No activities from budget agent, calling activities generation endpoint', {
                    days: transformedRequest.days,
                    destination: transformedRequest.destinations[0].label,
                    formattedActivitiesCount: formattedActivities?.length
                });
                const activitiesResult = await (async () => {
                    try {
                        logger.info('[Budget] Starting activities generation');
                        // Get activities from the budget agent
                        const formattedActivities = await agent.handleTravelRequest({
                            departureLocation: transformedRequest.departureLocation,
                            destinations: transformedRequest.destinations,
                            startDate: transformedRequest.startDate,
                            endDate: transformedRequest.endDate,
                            travelers: transformedRequest.travelers,
                            budgetLimit: transformedRequest.budget || 0,
                            flightData: transformedRequest.flightData,
                            preferences: {
                                travelStyle: 'balanced',
                                pacePreference: 'moderate',
                                interests: [],
                                accessibility: [],
                                dietaryRestrictions: []
                            }
                        });
                        // Log the full activities data for debugging
                        logger.debug('[Budget] Received activities from budget agent:', {
                            hasEnrichedActivities: !!formattedActivities?.enrichedActivities,
                            enrichedActivitiesCount: formattedActivities?.enrichedActivities?.length,
                            firstActivity: formattedActivities?.enrichedActivities?.[0],
                            hasDailyPlans: !!formattedActivities?.dailyPlans,
                            dailyPlansCount: formattedActivities?.dailyPlans?.length
                        });
                        // Validate that we have properly enriched activities
                        if (!formattedActivities?.enrichedActivities?.length) {
                            throw new Error('No enriched activities received from budget agent');
                        }
                        logger.info('[Budget] Using enriched activities from budget agent');
                        // Return the enriched activities with all their details
                        return {
                            success: true,
                            data: {
                                activities: formattedActivities.enrichedActivities,
                                dailyPlans: formattedActivities.dailyPlans || [],
                                tripOverview: formattedActivities.tripSummary?.overview || '',
                                activityFitNotes: formattedActivities.organizationLogic?.overview || '',
                                schedule: formattedActivities.dailyPlans || [],
                                dailyHighlights: formattedActivities.dayHighlights || [],
                                metadata: {
                                    source: 'budget_agent_enriched',
                                    totalActivities: formattedActivities.enrichedActivities.length,
                                    enrichedCount: formattedActivities.enrichedActivities.filter(a => a.bookingDetails?.provider === 'Viator').length,
                                    scheduleDays: formattedActivities.dailyPlans?.length || 0
                                }
                            }
                        };
                    }
                    catch (error) {
                        logger.error('[Budget] Error generating activities:', {
                            error: error instanceof Error ? error.message : 'Unknown error',
                            stack: error instanceof Error ? error.stack : undefined
                        });
                        throw new Error('Failed to generate activities: ' + (error instanceof Error ? error.message : 'Unknown error'));
                    }
                })();
                // Use the activities result
                if (!activitiesResult?.success || !activitiesResult?.data?.activities?.length) {
                    throw new Error('Failed to generate valid activities');
                }
                result = {
                    ...result,
                    ...activitiesResult.data,
                    metadata: {
                        ...result.metadata,
                        activities: activitiesResult.metadata
                    }
                };
                return result;
            })(),
            timeoutPromise
        ]);
        console.log('[Budget Route] ====== END BUDGET CALCULATION ======');
        // Validate and log enriched activities
        if (result.enrichedActivities) {
            logger.info('[Budget] Processing enriched activities:', {
                totalActivities: result.enrichedActivities.length,
                validationSummary: {
                    total: result.enrichedActivities.length,
                    valid: result.enrichedActivities.filter(validateEnrichedActivity).length,
                    withProductCodes: result.enrichedActivities.filter(a => a.bookingDetails?.productCode).length,
                    withAvailability: result.enrichedActivities.filter(a => a.availability?.isAvailable).length,
                    withVerification: result.enrichedActivities.filter(a => a.availability?.realTimeVerification?.verified).length
                }
            });
            // Log detailed validation for each activity
            result.enrichedActivities.forEach(logActivityValidation);
            // Log daily plans if available
            if (result.dailyPlans) {
                logger.info('[Budget] Daily plans generated:', {
                    totalDays: result.dailyPlans.length,
                    plans: result.dailyPlans.map(plan => ({
                        dayNumber: plan.dayNumber,
                        theme: plan.theme,
                        mainArea: plan.mainArea,
                        activityCount: plan.activities.length,
                        activities: plan.activities.map(activity => ({
                            name: activity.name,
                            timeSlot: activity.timeSlot,
                            productCode: activity.bookingDetails?.productCode,
                            isAvailable: activity.availability?.isAvailable,
                            exactStartTimes: activity.availability?.realTimeVerification?.exactStartTimes
                        }))
                    }))
                });
            }
            // Log trip highlights if available
            if (result.dayHighlights) {
                logger.info('[Budget] Trip highlights generated:', {
                    totalHighlights: result.dayHighlights.length,
                    highlights: result.dayHighlights.map(highlight => ({
                        dayNumber: highlight.dayNumber,
                        theme: highlight.theme,
                        mainAttractions: highlight.mainAttractions
                    }))
                });
            }
        }
        return res.json(result);
    }
    catch (error) {
        console.error('[Budget Route] Error processing budget calculation:', {
            error: error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name
            } : error,
            timestamp: new Date().toISOString()
        });
        // Handle timeout specifically
        if (error instanceof Error && error.message === 'Request timeout') {
            return res.status(504).json({
                success: false,
                error: 'Request timed out. Please try again with a shorter date range or fewer destinations.',
                errorDetails: {
                    type: 'TIMEOUT_ERROR',
                    message: 'The request exceeded the maximum allowed processing time',
                    timeoutDuration: `${TIMEOUT / 1000} seconds`,
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            });
        }
        // Handle different error types with specific messages
        let statusCode = 500;
        let errorMessage = 'An unexpected error occurred';
        let errorType = 'UNKNOWN_ERROR';
        if (error instanceof Error) {
            // Categorize errors based on their message or type
            if (error.message.includes('No flights available')) {
                statusCode = 404;
                errorMessage = 'No flights available for the specified dates and route. Please try different dates or destinations.';
                errorType = 'NO_FLIGHTS_ERROR';
            }
            else if (error.message.includes('Invalid') || error.message.includes('Missing')) {
                statusCode = 400;
                errorMessage = `Invalid request parameters: ${error.message}`;
                errorType = 'VALIDATION_ERROR';
            }
            else if (error.message.includes('Amadeus')) {
                statusCode = 502;
                errorMessage = 'Flight search service temporarily unavailable. Please try again later.';
                errorType = 'FLIGHT_SERVICE_ERROR';
            }
            else if (error.message.includes('activities')) {
                statusCode = 502;
                errorMessage = 'Activities generation service temporarily unavailable. Please try again later.';
                errorType = 'ACTIVITIES_SERVICE_ERROR';
            }
            else if (error.message.includes('rate limit') || error.message.includes('429')) {
                statusCode = 429;
                errorMessage = 'Rate limit exceeded. Please try again in a few minutes.';
                errorType = 'RATE_LIMIT_ERROR';
            }
        }
        return res.status(statusCode).json({
            success: false,
            error: errorMessage,
            errorDetails: {
                type: errorType,
                message: error instanceof Error ? error.message : 'Unknown error occurred',
                name: error instanceof Error ? error.name : 'UnknownError',
                stack: error instanceof Error && process.env.NODE_ENV !== 'production' ? error.stack : undefined,
                timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        });
    }
});
router.post('/generate-activity', async (req, res) => {
    try {
        const { destination, dayNumber, timeSlot, tier, category, duration, userPreferences, existingActivities = [], flightTimes = {}, currency = 'USD' } = req.body;
        console.log('[Budget API] Received activity generation request:', {
            destination,
            dayNumber,
            timeSlot,
            tier,
            category,
            duration,
            userPreferences,
            hasExistingActivities: !!existingActivities?.length,
            flightTimes
        });
        if (!destination || !dayNumber || !timeSlot || !tier) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        const mappedCategory = normalizeCategory(category || '');
        console.log('[Budget API] Calling VacationBudgetAgent to generate activity with mapped category:', {
            originalCategory: category,
            mappedCategory
        });
        const activity = await agent.generateSingleActivity({
            destination,
            dayNumber,
            timeOfDay: timeSlot,
            budget: tier,
            category: mappedCategory,
            userPreferences,
            existingActivities,
            flightTimes,
            currency
        });
        console.log('[Budget API] Successfully generated activity:', {
            activityId: activity.id,
            name: activity.name,
            timeSlot: activity.timeSlot,
            dayNumber: activity.dayNumber,
            tier: activity.tier,
            category: activity.category,
            duration: activity.duration
        });
        res.json({
            success: true,
            activity: activity
        });
    }
    catch (error) {
        console.error('[Budget API] Error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to generate activity',
            timestamp: new Date().toISOString()
        });
    }
});
export default router;
