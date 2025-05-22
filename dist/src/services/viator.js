import axios from 'axios';
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import { determineCategoryFromDescription } from '../constants/categories.js';
// Add Viator category mapping
const VIATOR_CATEGORY_MAP = {
    'Tours & Sightseeing': 'Cultural & Historical',
    'Cultural & Theme Tours': 'Cultural & Historical',
    'Historical & Heritage Tours': 'Cultural & Historical',
    'Walking & Biking Tours': 'Nature & Adventure',
    'Outdoor Activities': 'Nature & Adventure',
    'Water Sports': 'Nature & Adventure',
    'Day Cruises': 'Cruises & Sailing',
    'Night Cruises': 'Cruises & Sailing',
    'Sunset Cruises': 'Cruises & Sailing',
    'Food, Wine & Nightlife': 'Food & Dining',
    'Food Tours': 'Food & Dining',
    'Dining Experiences': 'Food & Dining',
    'Shows, Concerts & Sports': 'Entertainment',
    'Theater, Shows & Musicals': 'Entertainment',
    'Shopping Tours': 'Shopping',
    'Shopping Passes & Offers': 'Shopping',
    'Sightseeing Tickets & Passes': 'Tickets & Passes',
    'Attraction Tickets': 'Tickets & Passes',
    'Museum Tickets & Passes': 'Tickets & Passes'
};
export class ViatorService {
    constructor(apiKey) {
        this.isInitialized = false;
        this.destinationsCache = new Map();
        this.lastCacheUpdate = null;
        // Add product code tracking
        this.usedProductCodes = new Map(); // productCode -> activityName
        this.adultPricingFinder = (detail) => detail.ageBand === 'ADULT';
        this.apiKey = apiKey || process.env.VIATOR_API_KEY || '';
        this.baseUrl = 'https://api.viator.com/partner';
        if (!this.apiKey) {
            logger.error('[Viator] Failed to initialize: No API key provided');
            return;
        }
        logger.info('[Viator] Service initialized with API key', {
            keyLength: this.apiKey.length,
            baseUrl: this.baseUrl
        });
        this.isInitialized = true;
    }
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new Error('ViatorService not properly initialized');
        }
    }
    async getDestinations() {
        this.ensureInitialized();
        try {
            // Check cache first with TTL validation (24 hours)
            const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
            const now = Date.now();
            if (this.destinationsCache.size > 0 && this.lastCacheUpdate && (now - this.lastCacheUpdate) < CACHE_TTL) {
                logger.debug('[Viator] Returning cached destinations', {
                    cacheSize: this.destinationsCache.size,
                    cacheAge: Math.round((now - this.lastCacheUpdate) / 1000 / 60) + ' minutes',
                    timestamp: new Date().toISOString()
                });
                return Array.from(this.destinationsCache.values());
            }
            // Implement retry logic
            const MAX_RETRIES = 3;
            let retryCount = 0;
            let destinations;
            while (retryCount < MAX_RETRIES) {
                try {
                    const response = await fetch(`${this.baseUrl}/destinations`, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json;version=2.0',
                            'Content-Type': 'application/json',
                            'Accept-Language': 'en-US',
                            'exp-api-key': this.apiKey
                        }
                    });
                    if (!response.ok) {
                        const errorText = await response.text();
                        logger.error('[Viator] API error response:', {
                            status: response.status,
                            statusText: response.statusText,
                            attempt: retryCount + 1,
                            headers: Object.fromEntries(response.headers.entries()),
                            body: errorText
                        });
                        if (response.status === 429) { // Rate limit
                            const waitTime = Math.pow(2, retryCount) * 1000;
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            retryCount++;
                            continue;
                        }
                        throw new Error(`Viator API error: ${response.status} - ${errorText}`);
                    }
                    const rawResponse = await response.text();
                    try {
                        destinations = JSON.parse(rawResponse);
                        break; // Success, exit retry loop
                    }
                    catch (parseError) {
                        logger.error('[Viator] Failed to parse JSON response:', {
                            error: parseError instanceof Error ? parseError.message : 'Unknown error',
                            attempt: retryCount + 1,
                            rawResponse: rawResponse.slice(0, 200) + '...'
                        });
                        if (retryCount === MAX_RETRIES - 1) {
                            throw new Error('Failed to parse destinations response after max retries');
                        }
                        retryCount++;
                        continue;
                    }
                }
                catch (fetchError) {
                    logger.error('[Viator] Fetch error:', {
                        error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
                        attempt: retryCount + 1
                    });
                    if (retryCount === MAX_RETRIES - 1) {
                        throw fetchError;
                    }
                    retryCount++;
                    continue;
                }
            }
            // Extract destinations array from response
            const destinationsArray = Array.isArray(destinations) ? destinations :
                Array.isArray(destinations?.data) ? destinations.data :
                    Array.isArray(destinations?.destinations) ? destinations.destinations : null;
            if (!destinationsArray || destinationsArray.length === 0) {
                logger.error('[Viator] No valid destinations array found in response:', {
                    responseStructure: JSON.stringify(destinations).slice(0, 200) + '...'
                });
                throw new Error('No destinations found in response');
            }
            // Clear existing cache before updating
            this.destinationsCache.clear();
            this.lastCacheUpdate = Date.now();
            // Enhanced caching with multiple lookup strategies
            destinationsArray.forEach((destination) => {
                if (destination?.destinationId) {
                    // Cache by ID
                    this.destinationsCache.set(destination.destinationId.toString(), destination);
                    // Cache by normalized name variations
                    const names = [
                        destination.name,
                        destination.parentDestination?.name,
                        `${destination.name}, ${destination.parentDestination?.name}`,
                        destination.iata
                    ].filter(Boolean);
                    names.forEach(name => {
                        if (name) {
                            // Store exact match
                            this.destinationsCache.set(name.toLowerCase(), destination);
                            // Store normalized version
                            const normalizedName = this.normalizeLocationName(name);
                            this.destinationsCache.set(normalizedName, destination);
                            // Store without diacritics
                            const withoutDiacritics = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            this.destinationsCache.set(withoutDiacritics.toLowerCase(), destination);
                            // Store without articles (the, a, an)
                            const withoutArticles = name.replace(/^(the|a|an)\s+/i, '');
                            this.destinationsCache.set(withoutArticles.toLowerCase(), destination);
                        }
                    });
                }
            });
            logger.info('[Viator] Retrieved and cached destinations:', {
                count: destinationsArray.length,
                cacheSize: this.destinationsCache.size,
                uniqueDestinations: new Set(destinationsArray.map(d => d.destinationId)).size,
                timestamp: new Date().toISOString(),
                sampleDestinations: destinationsArray.slice(0, 3).map(d => ({
                    id: d.destinationId,
                    name: d.name,
                    parent: d.parentDestination?.name,
                    iata: d.iata
                }))
            });
            return destinationsArray;
        }
        catch (error) {
            logger.error('[Viator] Error fetching destinations:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            // If cache exists but is expired, use it as fallback
            if (this.destinationsCache.size > 0) {
                logger.warn('[Viator] Using expired cache as fallback');
                return Array.from(this.destinationsCache.values());
            }
            throw error;
        }
    }
    normalizeLocationName(name) {
        if (!name)
            return '';
        // Remove special characters, convert to lowercase, and handle common variations
        return name.toLowerCase()
            .normalize('NFD') // Normalize unicode characters
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    }
    async getDestinationId(cityName) {
        logger.info('[Viator] Starting destination lookup', {
            cityName,
            timestamp: new Date().toISOString(),
            stage: 'start'
        });
        try {
            // First check cache using normalized name
            const normalizedName = this.normalizeLocationName(cityName);
            const cachedDestination = this.destinationsCache.get(normalizedName);
            if (cachedDestination) {
                logger.info('[Viator] Found destination in cache', {
                    cityName,
                    destinationId: cachedDestination.destinationId,
                    stage: 'cache_hit'
                });
                return cachedDestination.destinationId.toString();
            }
            // Extract airport code if present
            const airportCodeMatch = cityName.match(/\((.*?)\)/);
            const cityNameWithoutAirport = cityName.replace(/\s*\([^)]*\)/, '').trim();
            // If we have an airport code, check cache for it
            if (airportCodeMatch) {
                const airportCode = airportCodeMatch[1].toUpperCase();
                const cachedByIata = this.destinationsCache.get(airportCode);
                if (cachedByIata) {
                    logger.info('[Viator] Found destination by IATA code in cache', {
                        cityName,
                        iata: airportCode,
                        destinationId: cachedByIata.destinationId,
                        stage: 'cache_hit_iata'
                    });
                    return cachedByIata.destinationId.toString();
                }
            }
            // Get fresh destinations if not in cache
            const destinations = await this.getDestinations();
            // Try exact match first
            const exactMatch = destinations.find(dest => dest.name.toLowerCase() === cityNameWithoutAirport.toLowerCase() ||
                (dest.parentDestination?.name.toLowerCase() === cityNameWithoutAirport.toLowerCase()) ||
                (airportCodeMatch && dest.iata === airportCodeMatch[1].toUpperCase()));
            if (exactMatch) {
                logger.info('[Viator] Found exact destination match', {
                    cityName,
                    destinationId: exactMatch.destinationId,
                    matchType: 'exact',
                    timestamp: new Date().toISOString()
                });
                return exactMatch.destinationId.toString();
            }
            // If no exact match, try fuzzy matching
            let bestMatch = null;
            let bestScore = 0;
            for (const dest of destinations) {
                // Check main name
                const mainNameScore = this.stringSimilarity(cityNameWithoutAirport.toLowerCase(), dest.name.toLowerCase());
                if (mainNameScore > bestScore) {
                    bestScore = mainNameScore;
                    bestMatch = dest;
                }
                // Check parent destination name
                if (dest.parentDestination?.name) {
                    const parentNameScore = this.stringSimilarity(cityNameWithoutAirport.toLowerCase(), dest.parentDestination.name.toLowerCase());
                    if (parentNameScore > bestScore) {
                        bestScore = parentNameScore;
                        bestMatch = dest;
                    }
                }
            }
            if (bestMatch && bestScore > 0.8) { // 80% similarity threshold
                logger.info('[Viator] Found fuzzy destination match', {
                    cityName,
                    destinationId: bestMatch.destinationId,
                    matchType: 'fuzzy',
                    similarity: bestScore,
                    matchedName: bestMatch.name,
                    timestamp: new Date().toISOString()
                });
                return bestMatch.destinationId.toString();
            }
            logger.warn('[Viator] No destination match found', {
                cityName,
                searchedWithoutAirport: cityNameWithoutAirport,
                airportCode: airportCodeMatch?.[1],
                bestMatchScore: bestScore,
                bestMatchName: bestMatch?.name
            });
            throw new Error(`No matching destination found for: ${cityName}`);
        }
        catch (error) {
            logger.error('[Viator] Error in getDestinationId:', {
                cityName,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    // Helper function for string similarity
    stringSimilarity(str1, str2) {
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(0));
        for (let i = 0; i <= len1; i++)
            matrix[0][i] = i;
        for (let j = 0; j <= len2; j++)
            matrix[j][0] = j;
        for (let j = 1; j <= len2; j++) {
            for (let i = 1; i <= len1; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + cost);
            }
        }
        const maxLen = Math.max(len1, len2);
        return (maxLen - matrix[len2][len1]) / maxLen;
    }
    async searchActivity(query, destinationId, startDate, endDate) {
        this.ensureInitialized();
        try {
            logger.info('[Viator] Searching for activity:', {
                query,
                destinationId,
                startDate,
                endDate
            });
            const searchRequest = {
                text: query,
                filtering: {
                    destination: destinationId
                },
                startDate: startDate || new Date().toISOString().split('T')[0],
                endDate: endDate || new Date(new Date(startDate || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                currency: 'USD',
                pagination: {
                    offset: 0,
                    limit: 20 // Increased from 10 to get more options
                },
                sorting: {
                    sortBy: 'RELEVANCE',
                    sortOrder: 'DESC'
                }
            };
            const response = await fetch(`${this.baseUrl}/products/search`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                },
                body: JSON.stringify(searchRequest)
            });
            if (!response.ok) {
                throw new Error(`Viator API error: ${response.status}`);
            }
            const data = await response.json();
            const products = Array.isArray(data?.products) ? data.products :
                Array.isArray(data?.data?.products?.items) ? data.data.products.items : [];
            // Filter out products with already used product codes
            const unusedProducts = products.filter(product => !this.usedProductCodes.has(product.productCode));
            logger.info('[Viator] Search results:', {
                query,
                totalResults: products.length,
                unusedResults: unusedProducts.length,
                usedProductCodes: Array.from(this.usedProductCodes.keys())
            });
            return unusedProducts;
        }
        catch (error) {
            logger.error('[Viator] Error searching for activity:', {
                query,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    getTimeSlotCategory(time) {
        const hour = parseInt(time.split(':')[0]);
        if (hour >= 6 && hour < 12)
            return 'morning';
        if (hour >= 12 && hour < 17)
            return 'afternoon';
        return 'evening';
    }
    findBestTimeForSlot(availableTimes, desiredSlot) {
        // Define time ranges for each slot
        const timeRanges = {
            morning: { start: 6, end: 12, midpoint: 9 },
            afternoon: { start: 12, end: 17, midpoint: 14.5 },
            evening: { start: 17, end: 24, midpoint: 20 }
        };
        // First try: Find times that exactly match the desired slot
        const slotTimes = availableTimes.filter(time => {
            const hour = parseInt(time.split(':')[0]);
            const range = timeRanges[desiredSlot];
            return hour >= range.start && hour < range.end;
        });
        if (slotTimes.length > 0) {
            // Sort by time and return earliest available in slot
            slotTimes.sort((a, b) => {
                const [hoursA, minutesA] = a.split(':').map(Number);
                const [hoursB, minutesB] = b.split(':').map(Number);
                return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
            });
            logger.info('[Viator] Found exact time slot match', {
                desiredSlot,
                availableTimes: slotTimes,
                selectedTime: slotTimes[0]
            });
            return { time: slotTimes[0], adjustedSlot: desiredSlot };
        }
        // If no times in desired slot, categorize all available times
        const timesBySlot = {
            morning: availableTimes.filter(time => {
                const hour = parseInt(time.split(':')[0]);
                return hour >= timeRanges.morning.start && hour < timeRanges.morning.end;
            }),
            afternoon: availableTimes.filter(time => {
                const hour = parseInt(time.split(':')[0]);
                return hour >= timeRanges.afternoon.start && hour < timeRanges.afternoon.end;
            }),
            evening: availableTimes.filter(time => {
                const hour = parseInt(time.split(':')[0]);
                return hour >= timeRanges.evening.start && hour < timeRanges.evening.end;
            })
        };
        // Define slot reassignment preferences
        const slotReassignment = {
            morning: ['afternoon', 'evening'],
            afternoon: ['evening', 'morning'],
            evening: ['afternoon', 'morning']
        };
        // Try reassignment based on preferences
        for (const alternativeSlot of slotReassignment[desiredSlot]) {
            if (timesBySlot[alternativeSlot].length > 0) {
                // Sort times within the alternative slot
                const sortedTimes = [...timesBySlot[alternativeSlot]].sort((a, b) => {
                    const [hoursA, minutesA] = a.split(':').map(Number);
                    const [hoursB, minutesB] = b.split(':').map(Number);
                    return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
                });
                logger.info('[Viator] Reassigning to different time slot', {
                    originalSlot: desiredSlot,
                    newSlot: alternativeSlot,
                    availableTimes: sortedTimes,
                    selectedTime: sortedTimes[0]
                });
                return {
                    time: sortedTimes[0],
                    adjustedSlot: alternativeSlot
                };
            }
        }
        // Last resort: Use any available time and determine its slot
        if (availableTimes.length > 0) {
            const firstTime = availableTimes[0];
            const hour = parseInt(firstTime.split(':')[0]);
            let finalSlot;
            if (hour >= timeRanges.morning.start && hour < timeRanges.morning.end) {
                finalSlot = 'morning';
            }
            else if (hour >= timeRanges.afternoon.start && hour < timeRanges.afternoon.end) {
                finalSlot = 'afternoon';
            }
            else {
                finalSlot = 'evening';
            }
            logger.info('[Viator] Using fallback time with slot adjustment', {
                originalSlot: desiredSlot,
                finalSlot,
                selectedTime: firstTime
            });
            return { time: firstTime, adjustedSlot: finalSlot };
        }
        // If no times available at all, return null
        return { time: null, adjustedSlot: desiredSlot };
    }
    async getAvailabilitySchedule(productCode) {
        this.ensureInitialized();
        logger.debug('[Viator] Starting availability schedule check', {
            productCode,
            timestamp: new Date().toISOString(),
            stage: 'start'
        });
        try {
            const url = `${this.baseUrl}/availability/schedules/${productCode}`;
            const headers = {
                'Accept': 'application/json;version=2.0',
                'Content-Type': 'application/json',
                'Accept-Language': 'en-US',
                'exp-api-key': this.apiKey
            };
            logger.debug('[Viator] Making API request', {
                url,
                timestamp: new Date().toISOString(),
                stage: 'request',
                headers: {
                    ...headers,
                    'exp-api-key': '***hidden***'
                }
            });
            const response = await axios.get(url, { headers });
            // Log raw response immediately
            logger.debug('[Viator] Raw API response received', {
                productCode,
                status: response.status,
                timestamp: new Date().toISOString(),
                stage: 'response_received',
                headers: response.headers,
                dataSize: JSON.stringify(response.data).length
            });
            // Direct console log for debugging
            console.log('\n==== VIATOR RAW AVAILABILITY SCHEDULE RESPONSE ====');
            console.log('Product Code:', productCode);
            console.log('Status:', response.status);
            console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
            console.log('Raw Response Data:', JSON.stringify(response.data, null, 2));
            // Extract and log pricing information
            const initialAdultPricing = response.data?.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.pricingDetails?.find((detail) => detail.ageBand === 'ADULT');
            logger.info('[Viator] Extracted pricing details:', {
                productCode,
                timestamp: new Date().toISOString(),
                stage: 'pricing_extraction',
                pricing: {
                    recommendedRetailPrice: initialAdultPricing?.price?.original?.recommendedRetailPrice,
                    partnerNetPrice: initialAdultPricing?.price?.original?.partnerNetPrice,
                    currency: response.data?.currency,
                    pricingPackageType: initialAdultPricing?.pricingPackageType,
                    ageBand: initialAdultPricing?.ageBand
                }
            });
            // Log availability details
            const availabilityDetails = response.data?.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.timedEntries?.map((entry) => ({
                startTime: entry.startTime,
                unavailableDates: entry.unavailableDates
            }));
            logger.info('[Viator] Extracted availability details:', {
                productCode,
                timestamp: new Date().toISOString(),
                stage: 'availability_extraction',
                availability: {
                    hasTimedEntries: !!availabilityDetails?.length,
                    entries: availabilityDetails,
                    operatingHours: response.data?.bookableItems?.[0]?.seasons?.[0]?.operatingHours
                }
            });
            if (!response.data || !response.data.bookableItems?.[0]) {
                logger.error('[Viator] Empty or invalid availability response', {
                    productCode,
                    timestamp: new Date().toISOString(),
                    stage: 'validation_failed',
                    response: response.data
                });
                throw new Error('Invalid availability response');
            }
            const bookableItem = response.data.bookableItems[0];
            const season = bookableItem.seasons?.[0];
            if (!season || !season.pricingRecords?.[0]) {
                logger.error('[Viator] No valid season or pricing records', {
                    productCode,
                    timestamp: new Date().toISOString(),
                    stage: 'season_validation_failed',
                    hasSeasons: !!bookableItem.seasons,
                    seasonCount: bookableItem.seasons?.length,
                    hasPricingRecords: !!season?.pricingRecords
                });
                throw new Error('No valid season data found');
            }
            const pricingRecord = season.pricingRecords[0];
            // Get adult pricing
            const adultPricing = pricingRecord.pricingDetails?.find((detail) => detail.ageBand === 'ADULT');
            // Log pricing information
            logger.debug(productCode, {
                stage: 'pricing_details',
                adultPrice: adultPricing?.price?.original?.recommendedRetailPrice,
                currency: response.data.currency,
                partnerNetPrice: adultPricing?.price?.original?.partnerNetPrice,
                bookingFee: adultPricing?.price?.original?.bookingFee
            });
            // Extract operating hours
            const operatingHours = {};
            if (season.operatingHours) {
                season.operatingHours.forEach((day) => {
                    if (day.operatingHours && day.operatingHours.length > 0) {
                        operatingHours[day.dayOfWeek] = day.operatingHours.map((hour) => ({
                            opensAt: hour.opensAt,
                            closesAt: hour.closesAt
                        }));
                    }
                });
            }
            // Log operating hours
            logger.debug(productCode, {
                stage: 'operating_hours',
                operatingHours,
                daysWithHours: Object.keys(operatingHours)
            });
            // Extract time slots and their unavailable dates with more detailed logging
            const timeSlots = pricingRecord.timedEntries?.map((entry) => {
                logger.debug(productCode, {
                    stage: 'time_slot_processing',
                    startTime: entry.startTime,
                    unavailableDatesCount: entry.unavailableDates?.length || 0,
                    category: this.getTimeSlotCategory(entry.startTime),
                    unavailableDates: entry.unavailableDates
                });
                return entry;
            }) || [];
            // Log time slots summary with categorization
            logger.debug(productCode, {
                stage: 'time_slots_summary',
                totalSlots: timeSlots.length,
                slots: timeSlots.map((slot) => ({
                    time: slot.startTime,
                    category: this.getTimeSlotCategory(slot.startTime),
                    unavailableDates: slot.unavailableDates?.length || 0
                })),
                categoryCounts: {
                    morning: timeSlots.filter((slot) => this.getTimeSlotCategory(slot.startTime) === 'morning').length,
                    afternoon: timeSlots.filter((slot) => this.getTimeSlotCategory(slot.startTime) === 'afternoon').length,
                    evening: timeSlots.filter((slot) => this.getTimeSlotCategory(slot.startTime) === 'evening').length
                }
            });
            // Consolidate unavailable dates across all time slots
            const unavailableDatesMap = new Map();
            timeSlots.forEach((slot) => {
                slot.unavailableDates?.forEach((ud) => {
                    unavailableDatesMap.set(ud.date, ud.reason);
                });
            });
            const unavailableDates = Array.from(unavailableDatesMap.entries()).map(([date, reason]) => ({
                date,
                reason
            }));
            // Log unavailable dates
            logger.debug(productCode, {
                stage: 'unavailable_dates',
                unavailableDatesCount: unavailableDates.length,
                unavailableDates
            });
            const processedResponse = {
                ...response.data,
                extractedPricing: {
                    amount: adultPricing?.price?.original?.recommendedRetailPrice || 0,
                    currency: response.data.currency || 'USD',
                    partnerNetPrice: adultPricing?.price?.original?.partnerNetPrice || 0,
                    bookingFee: adultPricing?.price?.original?.bookingFee || 0
                },
                extractedOperatingHours: operatingHours,
                extractedUnavailableDates: unavailableDates,
                extractedDaysOfWeek: pricingRecord.daysOfWeek || [],
                extractedTimeSlots: timeSlots.map((slot) => slot.startTime)
            };
            // Log final processed response
            logger.debug(productCode, {
                stage: 'final_response',
                pricing: processedResponse.extractedPricing,
                operatingHours: Object.keys(processedResponse.extractedOperatingHours || {}),
                operatingDays: processedResponse.extractedDaysOfWeek,
                timeSlots: processedResponse.extractedTimeSlots,
                unavailableDatesCount: processedResponse.extractedUnavailableDates?.length || 0,
                source: 'api',
                bookableItems: response.data.bookableItems?.length || 0
            });
            return processedResponse;
        }
        catch (error) {
            logger.error('[Viator] Error getting availability schedule:', {
                productCode,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                stage: 'error'
            });
            throw error;
        }
    }
    async getProductDetails(productCode) {
        this.ensureInitialized();
        try {
            const response = await fetch(`${this.baseUrl}/products/${productCode}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json;version=2.0',
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            if (!response.ok) {
                throw new Error(`Viator API error: ${response.status}`);
            }
            const data = await response.json();
            return data;
        }
        catch (error) {
            logger.error('[Viator API] Error getting product details:', {
                productCode,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null;
        }
    }
    formatProductResponse(product) {
        if (!product.productCode) {
            logger.warn('[Viator] Product missing product code:', {
                title: product.title
            });
            return {
                name: product.title || 'Unknown Activity',
                description: product.description || '',
                duration: 0,
                price: {
                    amount: 0,
                    currency: 'USD'
                },
                category: 'Unknown',
                location: '',
                timeSlot: 'morning',
                dayNumber: 0,
                enrichmentStatus: 'failed',
                enrichmentError: 'No product code available'
            };
        }
        const ratingStr = product.reviews?.combinedAverageRating
            ? `★ ${product.reviews.combinedAverageRating.toFixed(1)} (${product.reviews.totalReviews} reviews)`
            : '';
        const locationSources = this.extractLocation(product);
        const bookingUrl = this.constructBookingUrl(product);
        const availability = this.extractAvailability(product);
        return {
            name: product.title,
            description: product.description + (ratingStr ? `\n\n${ratingStr}` : ''),
            duration: product.duration?.fixedDurationInMinutes || 0,
            price: {
                amount: product.pricing?.summary?.fromPrice || 0,
                currency: product.pricing?.currency || 'USD'
            },
            rating: product.reviews?.combinedAverageRating,
            numberOfReviews: product.reviews?.totalReviews,
            highlights: product.highlights || [],
            location: locationSources[0] || '',
            timeSlot: 'morning',
            dayNumber: 0,
            category: this.determineCategory({
                name: product.title,
                description: product.description,
                productCode: product.productCode,
                price: {
                    amount: product.pricing?.summary?.fromPrice || 0,
                    currency: product.pricing?.currency || 'USD'
                }
            }),
            bookingDetails: {
                provider: 'Viator',
                productCode: product.productCode,
                referenceUrl: bookingUrl,
                cancellationPolicy: product.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                instantConfirmation: product.confirmationType === 'INSTANT',
                mobileTicket: product.bookingInfo?.mobileTicketing || true,
                languages: product.bookingInfo?.languages || ['English'],
                minParticipants: product.bookingInfo?.minParticipants || 1,
                maxParticipants: product.bookingInfo?.maxParticipants
            },
            availability,
            enrichmentStatus: 'success',
            enrichmentDuration: 0,
            enrichmentError: undefined
        };
    }
    extractLocation(product) {
        const locationSources = [
            product.location?.address,
            product.location?.meetingPoint,
            product.location?.coordinates?.description,
            product.destinations?.[0]?.name,
            product.location?.description,
            product.title,
            product.description
        ].filter(Boolean).map((loc) => loc.toLowerCase());
        const descriptionLocations = product.description?.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)*)/g) || [];
        return [...new Set([
                ...locationSources,
                ...descriptionLocations.map((loc) => loc.replace(/^(?:in|at|near|around)\s+/, ''))
            ])];
    }
    constructBookingUrl(product) {
        // Use the direct product URL if available
        if (product.productUrl) {
            return product.productUrl;
        }
        // Construct URL from destination and product info if available
        if (product.destinations?.[0]?.ref) {
            const destinationName = product.destinations[0].name.split(',')[0];
            const titleSlug = product.title.replace(/[^a-zA-Z0-9]+/g, '-');
            return `https://www.viator.com/tours/${destinationName}/${titleSlug}/d${product.destinations[0].ref}-${product.productCode}`;
        }
        // Fallback to basic product URL
        return `https://www.viator.com/tours/${product.productCode}`;
    }
    extractAvailability(product) {
        return {
            available: product.available || true,
            startDate: product.bookingInfo?.startDate,
            endDate: product.bookingInfo?.endDate,
            operatingDays: product.bookingInfo?.operatingDays || [],
            operatingHours: product.bookingInfo?.operatingHours,
            seasonality: product.bookingInfo?.seasonality,
            availabilityType: product.confirmationType || 'INSTANT'
        };
    }
    extractImages(product) {
        return (product.images || [])
            .filter((img) => !!img)
            .map(img => {
            const variants = img.variants || [];
            const preferredVariant = variants.find(v => v.width === 480 && v.height === 320);
            return preferredVariant?.url || variants[0]?.url || '';
        })
            .filter(url => !!url);
    }
    formatLocation(locationData) {
        if (typeof locationData === 'string') {
            return {
                formattedAddress: locationData,
                details: { address: locationData }
            };
        }
        if (typeof locationData === 'object') {
            const formattedAddress = locationData.address ||
                (locationData.meetingPoints?.[0]?.address) ||
                (locationData.startingLocations?.[0]?.address) ||
                'Location details available upon booking';
            return {
                formattedAddress,
                details: {
                    address: formattedAddress,
                    meetingPoints: locationData.meetingPoints || [],
                    startingLocations: locationData.startingLocations || [],
                    coordinates: locationData.coordinates
                }
            };
        }
        return {
            formattedAddress: 'Location details available upon booking',
            details: {}
        };
    }
    async validateAndAdjustTimeSlot(activity, availabilitySchedule, preferredTimeSlot) {
        try {
            const date = activity.date || new Date().toISOString().split('T')[0];
            const daySchedule = availabilitySchedule.find((schedule) => schedule.date === date);
            if (!daySchedule) {
                return {
                    isAvailable: false,
                    recommendedTimeSlot: preferredTimeSlot,
                    availableTimeSlots: []
                };
            }
            // Group available times by time slot category
            const availableSlots = {
                morning: [],
                afternoon: [],
                evening: []
            };
            daySchedule.timeSlots.forEach((slot) => {
                if (slot.isAvailable) {
                    const category = this.getTimeSlotCategory(slot.start);
                    availableSlots[category].push(slot.start);
                }
            });
            // Check if preferred time slot has availability
            if (availableSlots[preferredTimeSlot].length > 0) {
                return {
                    isAvailable: true,
                    recommendedTimeSlot: preferredTimeSlot,
                    availableTimeSlots: Object.keys(availableSlots).filter(slot => availableSlots[slot].length > 0),
                    exactTime: availableSlots[preferredTimeSlot][0]
                };
            }
            // Find alternative time slot
            const alternativeSlot = Object.keys(availableSlots)
                .find(slot => availableSlots[slot].length > 0);
            if (alternativeSlot) {
                return {
                    isAvailable: true,
                    recommendedTimeSlot: alternativeSlot,
                    availableTimeSlots: Object.keys(availableSlots).filter(slot => availableSlots[slot].length > 0),
                    exactTime: availableSlots[alternativeSlot][0]
                };
            }
            return {
                isAvailable: false,
                recommendedTimeSlot: preferredTimeSlot,
                availableTimeSlots: []
            };
        }
        catch (error) {
            logger.error('[Viator] Error validating time slot:', {
                activityName: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return {
                isAvailable: true, // Default to true to not block the process
                recommendedTimeSlot: preferredTimeSlot,
                availableTimeSlots: ['morning', 'afternoon', 'evening']
            };
        }
    }
    async calculateTransportation(activity, previousActivity, nextActivity) {
        const details = {};
        if (previousActivity?.locationDetails?.coordinates && activity.locationDetails?.coordinates) {
            details.fromPrevious = {
                distance: this.calculateDistance(previousActivity.locationDetails.coordinates, activity.locationDetails.coordinates),
                duration: this.estimateTravelTime(previousActivity.locationDetails.coordinates, activity.locationDetails.coordinates),
                options: this.getTransportationOptions(previousActivity.locationDetails.coordinates, activity.locationDetails.coordinates)
            };
        }
        if (nextActivity?.locationDetails?.coordinates && activity.locationDetails?.coordinates) {
            details.toNext = {
                distance: this.calculateDistance(activity.locationDetails.coordinates, nextActivity.locationDetails.coordinates),
                duration: this.estimateTravelTime(activity.locationDetails.coordinates, nextActivity.locationDetails.coordinates),
                options: this.getTransportationOptions(activity.locationDetails.coordinates, nextActivity.locationDetails.coordinates)
            };
        }
        return details;
    }
    calculateDistance(from, to) {
        // Simple haversine distance calculation
        const R = 6371; // Earth's radius in km
        const dLat = (to.lat - from.lat) * Math.PI / 180;
        const dLon = (to.lng - from.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        return `${distance.toFixed(1)} km`;
    }
    estimateTravelTime(from, to) {
        const distance = this.calculateDistance(from, to);
        const km = parseFloat(distance);
        // Rough estimation: 
        // - Walking: 5 km/h
        // - Public transport: 20 km/h
        // - Car: 30 km/h (urban average)
        const walkingMinutes = Math.round((km / 5) * 60);
        const transitMinutes = Math.round((km / 20) * 60);
        const drivingMinutes = Math.round((km / 30) * 60);
        return `Walking: ${walkingMinutes} min, Transit: ${transitMinutes} min, Driving: ${drivingMinutes} min`;
    }
    getTransportationOptions(from, to) {
        const distance = parseFloat(this.calculateDistance(from, to));
        const options = [];
        if (distance <= 1) {
            options.push('Walking');
        }
        if (distance <= 5) {
            options.push('Bicycle');
        }
        options.push('Public Transport', 'Taxi/Ride-share');
        return options;
    }
    extractProductCodeFromUrl(url) {
        if (!url)
            return null;
        const match = url.match(/[A-Z0-9]+$/);
        return match ? match[0] : null;
    }
    async checkRealTimeAvailability(productCode, date) {
        try {
            logger.info('[Viator] Starting real-time availability check', {
                productCode,
                date,
                stage: 'start'
            });
            const response = await axios.post(`${this.baseUrl}/availability/check`, {
                productCode,
                travelDate: date,
                paxMix: [{
                        ageBand: 'ADULT',
                        numberOfTravelers: 1
                    }]
            }, {
                headers: {
                    'Accept': 'application/json;version=2.0', // Changed from 'Accept': 'application/json', 'Accept-Version': '2.0'
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en-US',
                    'exp-api-key': this.apiKey
                }
            });
            logger.info('[Viator] Real-time availability response', {
                productCode,
                date,
                status: response.status,
                isAvailable: response.data?.status === 'AVAILABLE',
                stage: 'response'
            });
            return {
                available: response.data?.status === 'AVAILABLE',
                pricing: {
                    fromPrice: response.data?.bookableItems?.[0]?.price?.amount || 0,
                    currency: response.data?.bookableItems?.[0]?.price?.currency || 'USD'
                },
                schedule: {
                    openingHours: response.data?.bookableItems?.[0]?.schedule?.operatingHours || [],
                    availableTimeSlots: response.data?.bookableItems?.[0]?.schedule?.availableTimeSlots || []
                }
            };
        }
        catch (error) {
            logger.error('[Viator] Error checking real-time availability', {
                productCode,
                date,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                stage: 'error'
            });
            return null;
        }
    }
    async enrichActivityDetails(activity) {
        try {
            const startTime = Date.now();
            logger.info('[Viator] Starting activity enrichment', {
                name: activity.name,
                location: activity.location,
                stage: 'start'
            });
            // Extract destination from location
            const cityName = activity.location.split(',')[0].trim();
            if (!cityName) {
                logger.error('[Viator] No city name available for enrichment', {
                    activity: activity.name,
                    location: activity.location
                });
                return {
                    ...activity,
                    enrichmentStatus: 'failed',
                    enrichmentError: 'No city name available'
                };
            }
            // Get destination ID
            let destinationId;
            try {
                destinationId = await this.getDestinationId(cityName);
                logger.info('[Viator] Found destination ID', {
                    cityName,
                    destinationId,
                    stage: 'destination_found'
                });
            }
            catch (error) {
                logger.error('[Viator] Failed to get destination ID', {
                    cityName,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                return {
                    ...activity,
                    enrichmentStatus: 'failed',
                    enrichmentError: `Failed to get destination ID: ${error instanceof Error ? error.message : 'Unknown error'}`
                };
            }
            // Search for the activity
            let searchResults;
            try {
                const activityDate = activity.date || new Date().toISOString().split('T')[0];
                const endDate = new Date(new Date(activityDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                searchResults = await this.searchActivity(activity.name, destinationId, activityDate, endDate);
                logger.info('[Viator] Search results received', {
                    activity: activity.name,
                    resultsCount: searchResults?.length || 0,
                    destinationId,
                    stage: 'search_complete'
                });
            }
            catch (error) {
                logger.error('[Viator] Failed to search for activity', {
                    activity: activity.name,
                    destinationId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                return {
                    ...activity,
                    enrichmentStatus: 'failed',
                    enrichmentError: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                };
            }
            if (!searchResults || searchResults.length === 0) {
                logger.warn('[Viator] No matching activities found', {
                    activity: activity.name,
                    destinationId
                });
                return {
                    ...activity,
                    enrichmentStatus: 'failed',
                    enrichmentError: 'No matching activities found'
                };
            }
            // Find best unused match
            let bestMatch = null;
            let bestScore = 0;
            for (const result of searchResults) {
                // Skip if product code already used
                if (this.usedProductCodes.has(result.productCode)) {
                    logger.debug('[Viator] Skipping used product code:', {
                        productCode: result.productCode,
                        usedFor: this.usedProductCodes.get(result.productCode)
                    });
                    continue;
                }
                const score = this.stringSimilarity(activity.name.toLowerCase(), result.title.toLowerCase());
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = result;
                }
            }
            if (!bestMatch) {
                logger.warn('[Viator] No unused product codes available', {
                    activity: activity.name,
                    usedCodes: Array.from(this.usedProductCodes.entries())
                });
                return {
                    ...activity,
                    enrichmentStatus: 'failed',
                    enrichmentError: 'No unused product codes available'
                };
            }
            // Track the used product code
            this.usedProductCodes.set(bestMatch.productCode, activity.name);
            logger.info('[Viator] Reserved product code:', {
                productCode: bestMatch.productCode,
                activity: activity.name,
                similarityScore: bestScore
            });
            // Get availability schedule
            let availabilitySchedule;
            try {
                availabilitySchedule = await this.getAvailabilitySchedule(bestMatch.productCode);
                logger.info('[Viator] Availability schedule retrieved', {
                    activity: activity.name,
                    productCode: bestMatch.productCode,
                    hasSchedule: !!availabilitySchedule,
                    timeSlots: availabilitySchedule?.extractedTimeSlots?.length || 0,
                    extractedTimeSlots: availabilitySchedule?.extractedTimeSlots,
                    stage: 'schedule_retrieved'
                });
            }
            catch (error) {
                logger.warn('[Viator] Failed to get availability schedule', {
                    activity: activity.name,
                    productCode: bestMatch.productCode,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
            // Get product details
            let productDetails;
            try {
                productDetails = await this.getProductDetails(bestMatch.productCode);
                logger.info('[Viator] Product details retrieved', {
                    activity: activity.name,
                    productCode: bestMatch.productCode,
                    hasDetails: !!productDetails,
                    stage: 'details_retrieved'
                });
            }
            catch (error) {
                logger.warn('[Viator] Failed to get product details', {
                    activity: activity.name,
                    productCode: bestMatch.productCode,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
            // Construct enriched activity with schedule information
            const enrichedActivity = {
                ...activity,
                name: bestMatch.title || activity.name,
                description: bestMatch.description?.trim() || activity.description,
                duration: bestMatch.duration?.fixedDurationInMinutes || activity.duration,
                price: {
                    amount: availabilitySchedule?.extractedPricing?.amount ||
                        bestMatch.pricing?.summary?.fromPrice ||
                        activity.price?.amount || 0,
                    currency: availabilitySchedule?.currency ||
                        bestMatch.pricing?.currency ||
                        activity.price?.currency || 'USD'
                },
                rating: bestMatch.reviews?.combinedAverageRating,
                numberOfReviews: bestMatch.reviews?.totalReviews,
                highlights: bestMatch.highlights || [],
                // Use available times from the schedule
                startTime: availabilitySchedule?.extractedTimeSlots?.[0] || activity.startTime,
                timeSlot: this.getTimeSlotCategory(availabilitySchedule?.extractedTimeSlots?.[0] || activity.startTime || '09:00'),
                availability: {
                    isAvailable: true,
                    availableTimeSlots: [],
                    exactStartTimes: availabilitySchedule?.extractedTimeSlots || [],
                    timesByCategory: {
                        morning: availabilitySchedule?.extractedTimeSlots?.filter(time => {
                            const hour = parseInt(time.split(':')[0]);
                            return hour >= 6 && hour < 12;
                        }) || [],
                        afternoon: availabilitySchedule?.extractedTimeSlots?.filter(time => {
                            const hour = parseInt(time.split(':')[0]);
                            return hour >= 12 && hour < 17;
                        }) || [],
                        evening: availabilitySchedule?.extractedTimeSlots?.filter(time => {
                            const hour = parseInt(time.split(':')[0]);
                            return hour >= 17 && hour < 23;
                        }) || []
                    },
                    realTimeVerification: {
                        verified: true,
                        exactStartTimes: availabilitySchedule?.extractedTimeSlots || [],
                        lastChecked: new Date().toISOString(),
                        pricing: {
                            fromPrice: availabilitySchedule?.extractedPricing?.amount || 0,
                            currency: availabilitySchedule?.currency || 'USD'
                        }
                    },
                    operatingHours: availabilitySchedule?.extractedOperatingHours ?
                        Object.entries(availabilitySchedule.extractedOperatingHours)
                            .map(([day, hours]) => `${day}: ${hours.map(h => `${h.opensAt}-${h.closesAt}`).join(', ')}`)
                            .join('; ') : undefined
                },
                bookingDetails: {
                    provider: 'Viator',
                    productCode: bestMatch.productCode,
                    referenceUrl: this.constructBookingUrl(bestMatch),
                    cancellationPolicy: productDetails?.bookingInfo?.cancellationPolicy || bestMatch.bookingInfo?.cancellationPolicy || 'Standard cancellation policy',
                    instantConfirmation: bestMatch.confirmationType === 'INSTANT',
                    mobileTicket: bestMatch.bookingInfo?.mobileTicketing || true,
                    languages: bestMatch.bookingInfo?.languages || ['English'],
                    minParticipants: bestMatch.bookingInfo?.minParticipants || 1,
                    maxParticipants: bestMatch.bookingInfo?.maxParticipants || undefined
                },
                enrichmentStatus: 'success',
                enrichmentDuration: Date.now() - startTime,
                availability: {
                    isAvailable: true,
                    availableTimeSlots: [],
                    exactStartTimes: availabilitySchedule?.extractedTimeSlots || [],
                    timesByCategory: {
                        morning: availabilitySchedule?.extractedTimeSlots?.filter(time => {
                            const hour = parseInt(time.split(':')[0]);
                            return hour >= 6 && hour < 12;
                        }) || [],
                        afternoon: availabilitySchedule?.extractedTimeSlots?.filter(time => {
                            const hour = parseInt(time.split(':')[0]);
                            return hour >= 12 && hour < 17;
                        }) || [],
                        evening: availabilitySchedule?.extractedTimeSlots?.filter(time => {
                            const hour = parseInt(time.split(':')[0]);
                            return hour >= 17 && hour < 23;
                        }) || []
                    },
                    realTimeVerification: {
                        verified: true,
                        exactStartTimes: availabilitySchedule?.extractedTimeSlots || [],
                        lastChecked: new Date().toISOString(),
                        pricing: {
                            fromPrice: availabilitySchedule?.extractedPricing?.amount || 0,
                            currency: availabilitySchedule?.currency || 'USD'
                        }
                    },
                    operatingHours: availabilitySchedule?.extractedOperatingHours ?
                        Object.entries(availabilitySchedule.extractedOperatingHours)
                            .map(([day, hours]) => `${day}: ${hours.map(h => `${h.opensAt}-${h.closesAt}`).join(', ')}`)
                            .join('; ') : undefined
                }
            };
            logger.info('[Viator] Successfully enriched activity:', {
                name: enrichedActivity.name,
                productCode: bestMatch.productCode,
                price: enrichedActivity.price,
                availability: {
                    isAvailable: enrichedActivity.availability?.isAvailable,
                    timeSlots: enrichedActivity.availability?.availableTimeSlots
                },
                stage: 'enrichment_complete'
            });
            // Enhance activity with accessibility information
            if (activity.bookingDetails) {
                activity.bookingDetails.accessibility = this.determineAccessibility(productDetails);
                activity.bookingDetails.restrictions = this.extractRestrictions(productDetails);
            }
            return enrichedActivity;
        }
        catch (error) {
            logger.error('[Viator] Error enriching activity', {
                name: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return {
                ...activity,
                enrichmentStatus: 'failed',
                enrichmentError: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    determineTier(price) {
        if (price <= 50)
            return 'budget';
        if (price <= 150)
            return 'medium';
        return 'premium';
    }
    async getAvailability(productCode, date) {
        try {
            logger.info('[Viator] Checking availability:', {
                productCode,
                date,
                stage: 'start'
            });
            const response = await axios.get(`${this.baseUrl}/availability/schedules/${productCode}`, {
                headers: {
                    'Accept': 'application/json',
                    'Accept-Version': '2.0',
                    'Content-Type': 'application/json',
                    'exp-api-key': this.apiKey
                }
            });
            // Log the raw API response
            logger.info('[Viator] Raw availability response:', {
                productCode,
                date,
                status: response.status,
                rawData: JSON.stringify(response.data),
                responseHeaders: response.headers,
                extractedPricing: response.data?.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.pricingDetails?.find((detail) => detail.ageBand === 'ADULT')?.price?.original?.recommendedRetailPrice || 0,
                currency: response.data?.currency || 'USD',
                stage: 'raw_response'
            });
            // Process operating hours
            const operatingHours = response.data.bookableItems?.[0]?.seasons?.[0]?.operatingHours?.[0] || null;
            // Log operating hours
            logger.info('[Viator] Operating hours:', {
                productCode,
                date,
                operatingHours,
                stage: 'operating_hours'
            });
            // Process time slots
            const timeSlots = response.data.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.timedEntries?.map((entry) => entry.startTime) || [];
            // Log time slots
            logger.info('[Viator] Available time slots:', {
                productCode,
                date,
                timeSlots,
                stage: 'time_slots'
            });
            // Check if the date is unavailable
            const unavailableDates = response.data.bookableItems?.[0]?.seasons?.[0]?.pricingRecords?.[0]?.unavailableDates || [];
            const isDateUnavailable = unavailableDates.some((ud) => ud.date === date);
            // Log availability status
            logger.info('[Viator] Availability status:', {
                productCode,
                date,
                isDateUnavailable,
                unavailableDates,
                stage: 'availability_status'
            });
            return {
                isAvailable: !isDateUnavailable && timeSlots.length > 0,
                operatingHours,
                validTimeSlots: timeSlots
            };
        }
        catch (error) {
            logger.error('[Viator] Error checking availability:', {
                productCode,
                date,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                stage: 'error'
            });
            throw error;
        }
    }
    async validateTimeSlot(activity, date) {
        this.ensureInitialized();
        try {
            logger.info('[Viator] Validating time slot', {
                activity: activity.name,
                productCode: activity.bookingDetails?.productCode,
                timeSlot: activity.timeSlot,
                date
            });
            // Get real-time availability
            const realTimeCheck = await this.checkRealTimeAvailability(activity.bookingDetails?.productCode || '', date);
            if (!realTimeCheck?.available) {
                logger.warn('[Viator] Activity not available for requested date', {
                    activity: activity.name,
                    date,
                    reason: 'Real-time check failed'
                });
                return {
                    isAvailable: false,
                    availableTimeSlots: [],
                    exactStartTimes: [],
                    realTimeVerification: {
                        verified: false,
                        exactStartTimes: [],
                        lastChecked: new Date().toISOString(),
                        reason: 'Activity not available for requested date'
                    }
                };
            }
            // Get all available times for the requested date
            const availableTimes = realTimeCheck.schedule.availableTimeSlots || [];
            // Categorize times into slots
            const timesByCategory = {
                morning: availableTimes.filter(time => time >= '06:00' && time < '12:00'),
                afternoon: availableTimes.filter(time => time >= '12:00' && time < '17:00'),
                evening: availableTimes.filter(time => time >= '17:00' && time <= '23:59')
            };
            // Get available categories that have times
            const availableCategories = Object.entries(timesByCategory)
                .filter(([_, times]) => times.length > 0)
                .map(([category]) => category);
            // Find best matching time slot
            const preferredTimeSlot = activity.timeSlot;
            const firstAvailableCategory = availableCategories[0];
            const exactTimes = timesByCategory[preferredTimeSlot] || [];
            logger.info('[Viator] Available times by slot:', {
                preferredTimeSlot,
                availableCategories,
                selectedCategory: firstAvailableCategory,
                availableTimes: availableTimes.map(time => ({
                    time,
                    slot: this.getTimeSlotCategory(time)
                }))
            });
            return {
                isAvailable: exactTimes.length > 0,
                verifiedTimeSlot: preferredTimeSlot,
                availableTimeSlots: availableCategories,
                exactStartTime: exactTimes[0],
                exactStartTimes: exactTimes,
                timesByCategory,
                realTimeVerification: {
                    verified: true,
                    exactStartTimes: availableTimes,
                    lastChecked: new Date().toISOString(),
                    pricing: realTimeCheck.pricing,
                    reason: exactTimes.length > 0 ? 'Time slot verified with exact times' : 'No exact times available for requested slot'
                },
                operatingHours: realTimeCheck.schedule.openingHours?.join(', ')
            };
        }
        catch (error) {
            logger.error('[Viator] Error validating time slot', {
                activity: activity.name,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return {
                isAvailable: false,
                availableTimeSlots: [],
                exactStartTimes: [],
                realTimeVerification: {
                    verified: false,
                    exactStartTimes: [],
                    lastChecked: new Date().toISOString(),
                    reason: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }
    determineCategory(item) {
        const category = determineCategoryFromDescription(item.description);
        return category || 'Cultural & Historical';
    }
    // Add method to reset product codes (call at the start of each new trip planning)
    resetProductCodes() {
        this.usedProductCodes.clear();
        logger.info('[Viator] Reset product code tracking');
    }
    /**
     * Determines accessibility features for an activity
     */
    determineAccessibility(productDetails) {
        // Default to unknown if no product details
        if (!productDetails || !productDetails.additionalInfo) {
            return 'Information not available';
        }
        try {
            const { additionalInfo } = productDetails;
            // Check if accessibility information is directly provided
            if (additionalInfo.accessibility && additionalInfo.accessibility.length > 0) {
                return additionalInfo.accessibility.join(', ');
            }
            // Check overview text for accessibility mentions
            const accessibilityKeywords = [
                'wheelchair', 'accessible', 'mobility', 'disabled',
                'elevator', 'lift', 'ramp', 'limited mobility'
            ];
            const overview = productDetails.overview || '';
            const matchedKeywords = accessibilityKeywords.filter(keyword => overview.toLowerCase().includes(keyword.toLowerCase()));
            if (matchedKeywords.length > 0) {
                return `Possible accessibility features: ${matchedKeywords.join(', ')}`;
            }
            return 'Information not available';
        }
        catch (error) {
            logger.error('[Viator] Error determining accessibility:', error);
            return 'Information not available';
        }
    }
    /**
     * Extracts restrictions and requirements from product details
     */
    extractRestrictions(productDetails) {
        if (!productDetails || !productDetails.additionalInfo) {
            return [];
        }
        try {
            const { additionalInfo } = productDetails;
            if (additionalInfo.restrictions && additionalInfo.restrictions.length > 0) {
                return additionalInfo.restrictions;
            }
            return [];
        }
        catch (error) {
            logger.error('[Viator] Error extracting restrictions:', error);
            return [];
        }
    }
    /**
     * Filters activities based on accessibility and dietary requirements
     */
    filterActivitiesByRequirements(activities, requirements) {
        // If no requirements, return all activities
        if (!requirements ||
            (!requirements.accessibility?.length && !requirements.dietaryRestrictions?.length)) {
            return activities;
        }
        return activities.filter(activity => {
            // Check accessibility requirements
            if (requirements.accessibility?.length && activity.bookingDetails?.accessibility) {
                const activityAccessibility = activity.bookingDetails.accessibility.toLowerCase();
                // Check if activity specifically mentions being NOT accessible
                const notAccessible = [
                    'not wheelchair accessible',
                    'not suitable for mobility impaired',
                    'not recommended for travelers with mobility concerns'
                ].some(phrase => activityAccessibility.includes(phrase.toLowerCase()));
                if (notAccessible) {
                    return false;
                }
                // For specific accessibility requirements
                if (requirements.accessibility.includes('wheelchair_accessible') &&
                    !activityAccessibility.includes('wheelchair')) {
                    // If wheelchair accessibility is required but not mentioned, filter out
                    // unless it's a standard accessible venue like museum or theater
                    if (!this.isLikelyAccessible(activity)) {
                        return false;
                    }
                }
            }
            // Check dietary restrictions for food activities
            if (requirements.dietaryRestrictions?.length &&
                (activity.category === 'Food & Dining' ||
                    activity.category === 'Food & Wine' ||
                    activity.name.toLowerCase().includes('food') ||
                    activity.name.toLowerCase().includes('dinner') ||
                    activity.name.toLowerCase().includes('lunch') ||
                    activity.name.toLowerCase().includes('cuisine') ||
                    activity.name.toLowerCase().includes('tasting'))) {
                // Look for mentions of dietary accommodations in description
                const description = activity.description?.toLowerCase() || '';
                // Default to allowing the activity unless it specifically mentions NOT accommodating
                let canAccommodate = true;
                for (const restriction of requirements.dietaryRestrictions) {
                    const restrictionLower = restriction.toLowerCase();
                    // Check for phrases indicating the restriction cannot be accommodated
                    if (description.includes(`no ${restrictionLower} options`) ||
                        description.includes(`not suitable for ${restrictionLower}`) ||
                        description.includes(`cannot accommodate ${restrictionLower}`)) {
                        canAccommodate = false;
                        break;
                    }
                    // Check for phrases indicating the restriction can be accommodated
                    if (description.includes(`${restrictionLower} options`) ||
                        description.includes(`${restrictionLower} menu`) ||
                        description.includes(`${restrictionLower} friendly`) ||
                        description.includes(`accommodates ${restrictionLower}`)) {
                        // Found positive indication, keep this as true
                        canAccommodate = true;
                    }
                }
                return canAccommodate;
            }
            return true;
        });
    }
    /**
     * Determines if an activity is likely to be accessible based on type/venue
     */
    isLikelyAccessible(activity) {
        const name = activity.name.toLowerCase();
        const category = activity.category.toLowerCase();
        const description = activity.description?.toLowerCase() || '';
        // Major museums and attractions are typically accessible
        const accessibleVenues = [
            'museum', 'gallery', 'louvre', 'palace', 'cathedral',
            'theatre', 'theater', 'opera', 'cruise', 'boat'
        ];
        // Activities unlikely to be accessible
        const inaccessibleActivities = [
            'hiking', 'climbing', 'steps', 'stairs', 'walk up',
            'steep', 'narrow', 'medieval'
        ];
        // Check if any accessible venue keywords are present
        const isAccessibleVenue = accessibleVenues.some(venue => name.includes(venue) || category.includes(venue) || description.includes(venue));
        // Check if any inaccessible activity keywords are present
        const isInaccessibleActivity = inaccessibleActivities.some(activity => name.includes(activity) || description.includes(activity));
        return isAccessibleVenue && !isInaccessibleActivity;
    }
}
// Singleton instance
export const viatorClient = new ViatorService(process.env.VIATOR_API_KEY);
// Initialize on import
logger.info('[Viator] Initializing service');
