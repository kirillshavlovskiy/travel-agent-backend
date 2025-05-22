// Using require since Amadeus seems to be a CommonJS module
const Amadeus = require('amadeus');
import { logger } from '../utils/logger';
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
export class AmadeusService {
    constructor() {
        this.lastFlightSearchDictionaries = null;
        this.rateLimits = {
            requestsPerSecond: 10,
            requestsPer5Minutes: 100,
            requestsPerHour: 1000
        };
        this.requestQueue = [];
        this.requestCounts = {
            lastSecond: 0,
            last5Minutes: 0,
            lastHour: 0,
            lastRequestTime: Date.now()
        };
        // Add location cache
        this.locationCache = new Map();
        this.CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        const clientId = process.env.AMADEUS_CLIENT_ID;
        const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new Error('Amadeus credentials are not configured');
        }
        try {
            console.log('Initializing Amadeus client with environment:', process.env.NODE_ENV);
            this.client = new Amadeus({
                clientId,
                clientSecret,
                logLevel: 'debug'
            });
            console.log('Amadeus client initialized successfully');
        }
        catch (error) {
            console.error('Error initializing Amadeus client:', error);
            throw error;
        }
    }
    async searchHotels(params) {
        try {
            logger.info('Searching for hotels in city', { params });
            // Get hotels with offers
            const hotelsResponse = await this.client.shopping.hotelOffers.get({
                cityCode: params.cityCode,
                checkInDate: params.checkInDate,
                checkOutDate: params.checkOutDate,
                adults: params.adults,
                roomQuantity: params.roomQuantity,
                radius: params.radius || 5,
                radiusUnit: 'KM',
                ratings: params.ratings || '3,4,5',
                amenities: 'SWIMMING_POOL,SPA,FITNESS_CENTER',
                currency: params.currency || 'USD',
                view: 'FULL'
            });
            const hotels = JSON.parse(hotelsResponse.body);
            logger.info('Found hotels', { count: hotels.data?.length || 0 });
            if (!hotels.data || hotels.data.length === 0) {
                return [];
            }
            // Transform the response
            return hotels.data;
        }
        catch (error) {
            logger.error('Error searching hotels:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                response: error?.response?.data
            });
            throw error;
        }
    }
    determineHotelType(rating) {
        if (rating >= 4)
            return 'luxury';
        if (rating >= 3)
            return 'comfort';
        return 'budget';
    }
    transformHotelOffer(offer) {
        const offers = offer.offers || [];
        const price = offers[0]?.price?.total ? parseFloat(offers[0].price.total) : 0;
        const rating = offer.rating ? parseInt(offer.rating) : 0;
        return {
            name: offer.name || '',
            location: offer.cityName || '',
            price: {
                amount: price,
                currency: 'USD',
                total: price,
                perNight: price / (offers[0]?.roomQuantity || 1)
            },
            tier: this.determineHotelType(rating),
            type: 'hotel',
            amenities: offer.description || '',
            rating,
            reviewScore: rating ? rating / 2 : 0,
            reviewCount: 0,
            images: offer.media || [],
            referenceUrl: '#',
            coordinates: {
                latitude: offer.geoCode?.latitude || 0,
                longitude: offer.geoCode?.longitude || 0
            },
            features: offer.description ? [offer.description] : [],
            policies: {
                checkIn: '',
                checkOut: '',
                cancellation: offers[0]?.policies?.cancellation?.description || ''
            }
        };
    }
    getCityCode(destination) {
        // Remove country part if present
        const city = destination.split(',')[0].trim().toUpperCase();
        // Try to find the city code in the last flight search dictionaries
        if (this.lastFlightSearchDictionaries?.locations) {
            const locationEntry = Object.entries(this.lastFlightSearchDictionaries.locations)
                .find(([_, info]) => info.cityCode === city);
            if (locationEntry) {
                return locationEntry[0]; // Return the IATA code
            }
        }
        // If not found, return the city name as is (will be validated by Amadeus)
        return city;
    }
    getAircraftName(code) {
        return this.lastFlightSearchDictionaries?.aircraft?.[code] || code;
    }
    getCarrierName(code) {
        return this.lastFlightSearchDictionaries?.carriers?.[code] || code;
    }
    getCurrencyName(code) {
        return this.lastFlightSearchDictionaries?.currencies?.[code] || code;
    }
    async getAirlineInfo(airlineCodes) {
        const codes = Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes];
        const results = [];
        try {
            for (const code of codes) {
                const carrierName = this.getCarrierName(code);
                results.push({
                    iataCode: code,
                    commonName: carrierName,
                    businessName: carrierName
                });
            }
        }
        catch (error) {
            logger.error('Error in getAirlineInfo:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                codes
            });
            // Fallback to using codes as names
            results.push(...codes.map(code => ({
                iataCode: code,
                commonName: code,
                businessName: code
            })));
        }
        return results;
    }
    async executeWithRateLimit(request) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ resolve, reject, request });
            this.processQueue();
        });
    }
    async processQueue() {
        if (this.requestQueue.length === 0)
            return;
        const now = Date.now();
        const secondAgo = now - 1000;
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        const hourAgo = now - 60 * 60 * 1000;
        // Reset counters if enough time has passed
        if (now - this.requestCounts.lastRequestTime > 1000) {
            this.requestCounts.lastSecond = 0;
        }
        if (now - this.requestCounts.lastRequestTime > 5 * 60 * 1000) {
            this.requestCounts.last5Minutes = 0;
        }
        if (now - this.requestCounts.lastRequestTime > 60 * 60 * 1000) {
            this.requestCounts.lastHour = 0;
        }
        // Check if we can make a request
        if (this.requestCounts.lastSecond < this.rateLimits.requestsPerSecond &&
            this.requestCounts.last5Minutes < this.rateLimits.requestsPer5Minutes &&
            this.requestCounts.lastHour < this.rateLimits.requestsPerHour) {
            const { resolve, reject, request } = this.requestQueue.shift();
            // Update counters
            this.requestCounts.lastSecond++;
            this.requestCounts.last5Minutes++;
            this.requestCounts.lastHour++;
            this.requestCounts.lastRequestTime = now;
            try {
                const result = await this.retryWithBackoff(request);
                resolve(result);
            }
            catch (error) {
                reject(error);
            }
            // Schedule next request processing
            setTimeout(() => this.processQueue(), 100);
        }
        else {
            // If we can't make a request now, wait and try again
            const waitTime = Math.max(this.requestCounts.lastSecond >= this.rateLimits.requestsPerSecond ? 1000 : 0, this.requestCounts.last5Minutes >= this.rateLimits.requestsPer5Minutes ? 5 * 60 * 1000 : 0, this.requestCounts.lastHour >= this.rateLimits.requestsPerHour ? 60 * 60 * 1000 : 0);
            setTimeout(() => this.processQueue(), waitTime);
        }
    }
    async retryWithBackoff(request, attempt = 1) {
        const maxRetries = 3;
        const baseDelay = 1000;
        const maxDelay = 10000;
        try {
            return await request();
        }
        catch (error) {
            if (attempt <= maxRetries &&
                (error?.response?.status === 429 || // Too Many Requests
                    error?.response?.status >= 500) // Server errors
            ) {
                const delay = Math.min(Math.pow(2, attempt - 1) * baseDelay + Math.random() * 1000, maxDelay);
                logger.info('Rate limit exceeded, retrying request', {
                    attempt,
                    delay,
                    error: error?.response?.status
                });
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.retryWithBackoff(request, attempt + 1);
            }
            throw error;
        }
    }
    async searchFlights(params) {
        return this.executeWithRateLimit(async () => {
            try {
                // First, determine if we're using legacy or segments format
                let segments = params.segments || [];
                // If no segments provided but legacy parameters are available, create segments
                if (segments.length === 0 && params.originLocationCode && params.destinationLocationCode && params.departureDate) {
                    // Create outbound segment
                    segments.push({
                        originLocationCode: params.originLocationCode,
                        destinationLocationCode: params.destinationLocationCode,
                        departureDate: params.departureDate
                    });
                    // Add return segment if return date is provided
                    if (params.returnDate) {
                        segments.push({
                            originLocationCode: params.destinationLocationCode,
                            destinationLocationCode: params.originLocationCode,
                            departureDate: params.returnDate
                        });
                    }
                }
                // Now validate the segments
                if (!segments || segments.length === 0) {
                    logger.error('Flight search error: No segments defined', {
                        originalParams: params,
                        segments
                    });
                    throw new Error('At least one flight segment is required');
                }
                logger.info('Searching flights with segments:', {
                    segments,
                    travelClass: params.travelClass,
                    adults: params.adults
                });
                // Format the search parameters according to Amadeus API requirements
                const searchParams = {
                    originDestinations: segments.map((segment, index) => ({
                        id: String(index + 1),
                        originLocationCode: segment.originLocationCode,
                        destinationLocationCode: segment.destinationLocationCode,
                        departureDateTimeRange: {
                            date: segment.departureDate
                        }
                    })),
                    travelers: Array.from({ length: params.adults || 1 }, (_, i) => ({
                        id: String(i + 1),
                        travelerType: 'ADULT'
                    })),
                    sources: ['GDS'],
                    searchCriteria: {
                        maxFlightOffers: params.max || 100,
                        flightFilters: {
                            cabinRestrictions: [{
                                    cabin: params.travelClass || 'ECONOMY',
                                    coverage: 'MOST_SEGMENTS',
                                    originDestinationIds: segments.map((_, i) => String(i + 1))
                                }]
                        }
                    }
                };
                logger.info('Making Amadeus API call with formatted params:', {
                    originDestinations: searchParams.originDestinations,
                    travelers: searchParams.travelers.length,
                    cabin: params.travelClass || 'ECONOMY'
                });
                const response = await this.client.shopping.flightOffersSearch.post(JSON.stringify(searchParams));
                if (!response || !response.body) {
                    logger.warn('Empty response from Amadeus API');
                    return [];
                }
                const results = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
                logger.info('Flight search successful', {
                    count: results.data?.length || 0,
                    dictionaries: results.dictionaries,
                    firstResult: results.data?.[0],
                    priceRange: results.data?.length > 0 ? {
                        min: Math.min(...results.data.map((f) => parseFloat(f.price.total))),
                        max: Math.max(...results.data.map((f) => parseFloat(f.price.total))),
                        currency: results.data[0].price.currency
                    } : null
                });
                // Store dictionaries for later use
                this.lastFlightSearchDictionaries = results.dictionaries || null;
                return results.data || [];
            }
            catch (error) {
                logger.error('Failed to search flights', {
                    error: error instanceof Error ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        code: error.code,
                        response: {
                            status: error?.response?.statusCode,
                            statusText: error?.response?.statusText,
                            errors: error?.response?.result?.errors,
                            data: error?.response?.data,
                            request: {
                                method: error?.response?.request?.method,
                                path: error?.response?.request?.path
                            }
                        }
                    } : 'Unknown error',
                    params,
                    amadeusInitialized: !!this.client,
                    hasShoppingAPI: !!this.client?.shopping?.flightOffersSearch?.post
                });
                throw error; // Re-throw to handle upstream
            }
        });
    }
    async confirmFlightPrice(flightOffer) {
        try {
            logger.info('Confirming flight price', {
                offerId: flightOffer.id,
                price: flightOffer.price
            });
            const response = await this.client.shopping.flightOffersSearch.pricing.post(JSON.stringify({
                data: {
                    type: 'flight-offers-pricing',
                    flightOffers: [flightOffer]
                }
            }));
            const priceConfirmation = JSON.parse(response.body);
            logger.info('Price confirmation successful', {
                confirmedPrice: priceConfirmation.data.flightOffers[0].price
            });
            return priceConfirmation.data;
        }
        catch (error) {
            logger.error('Failed to confirm flight price', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                offerId: flightOffer.id
            });
            throw error;
        }
    }
    /**
     * Creates a flight booking using the Amadeus Flight Orders API
     * @param flightOffer The flight offer to book
     * @param travelers The travelers information
     * @param contacts Contact information
     * @param remarks Optional remarks
     * @returns The booking information including PNR
     */
    async createFlightBooking(params) {
        logger.info('Creating flight booking', {
            originDestination: `${params.flightOffer.itineraries[0]?.segments[0]?.departure?.iataCode} - ${params.flightOffer.itineraries[0]?.segments[params.flightOffer.itineraries[0]?.segments.length - 1]?.arrival?.iataCode}`,
            travelers: params.travelers.length,
            flightOfferId: params.flightOffer.id
        });
        return this.executeWithRateLimit(async () => {
            try {
                // Prepare the request payload
                const payload = {
                    data: {
                        type: 'flight-order',
                        flightOffers: [params.flightOffer],
                        travelers: params.travelers,
                        remarks: params.remarks || {
                            general: [
                                {
                                    subType: 'GENERAL_MISCELLANEOUS',
                                    text: 'ONLINE BOOKING FROM CHIPTRIP'
                                }
                            ]
                        },
                        ticketingAgreement: params.ticketingAgreement || {
                            option: 'DELAY_TO_CANCEL',
                            delay: '6D'
                        },
                        contacts: params.contacts
                    }
                };
                // Make the Amadeus API call
                const response = await this.client.booking.flightOrders.post(JSON.stringify(payload));
                // Parse the response
                const result = JSON.parse(response.body);
                logger.info('Flight booking created successfully', {
                    pnr: result.data?.id,
                    flightOfferId: params.flightOffer.id,
                    associatedRecords: result.data?.associatedRecords
                });
                return {
                    id: result.data?.id,
                    associatedRecords: result.data?.associatedRecords,
                    success: true
                };
            }
            catch (error) {
                logger.error('Error creating flight booking', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                    flightOfferId: params.flightOffer.id
                });
                // Check if we have detailed API error information
                let errors = [];
                if (error.response && error.response.data && error.response.data.errors) {
                    errors = error.response.data.errors.map((e) => e.detail || e.title || JSON.stringify(e));
                }
                return {
                    id: '',
                    success: false,
                    errors: errors.length ? errors : [(error instanceof Error) ? error.message : 'Unknown booking error']
                };
            }
        });
    }
    calculateTotalDuration(segments) {
        let totalMinutes = 0;
        segments.forEach(segment => {
            const duration = segment.duration;
            if (duration) {
                // Parse duration in format "PT2H30M"
                const hours = duration.match(/(\d+)H/)?.[1] || '0';
                const minutes = duration.match(/(\d+)M/)?.[1] || '0';
                totalMinutes += parseInt(hours) * 60 + parseInt(minutes);
            }
        });
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `PT${hours}H${minutes}M`;
    }
    determineTier(flightOffer) {
        try {
            // Get cabin class from first traveler's first segment
            const cabinClass = flightOffer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || 'ECONOMY';
            const price = parseFloat(flightOffer.price.total);
            // Normalize cabin class for comparison
            const normalizedCabin = cabinClass.toUpperCase();
            // First class is always premium
            if (normalizedCabin === 'FIRST' || normalizedCabin === 'LA PREMIERE') {
                return 'premium';
            }
            // Business class can be medium or premium based on price
            if (normalizedCabin === 'BUSINESS' || normalizedCabin === 'PREMIUM_BUSINESS') {
                return price <= 1500 ? 'medium' : 'premium';
            }
            // Premium economy is typically medium, but can be premium if very expensive
            if (normalizedCabin === 'PREMIUM_ECONOMY' || normalizedCabin === 'PREMIUM') {
                return price <= 1200 ? 'medium' : 'premium';
            }
            // For economy class, use more granular price tiers
            if (price <= 800) {
                return 'budget';
            }
            else if (price <= 1200) {
                return 'medium';
            }
            else {
                return 'premium';
            }
        }
        catch (error) {
            logger.error('[AmadeusService] Error determining tier:', error);
            return 'budget'; // Default to budget if there's an error
        }
    }
    generateBookingUrl(flightOffer) {
        try {
            const { validatingAirlineCodes, itineraries } = flightOffer;
            if (!validatingAirlineCodes || validatingAirlineCodes.length === 0 || !itineraries || itineraries.length === 0) {
                throw new Error('Missing required flight offer data');
            }
            const mainAirline = validatingAirlineCodes[0];
            const firstSegment = itineraries[0].segments[0];
            const lastSegment = itineraries[0].segments[itineraries[0].segments.length - 1];
            // Get origin and destination
            const origin = firstSegment.departure.iataCode;
            const destination = lastSegment.arrival.iataCode;
            // Format date (YYYY-MM-DD to DDMMYY)
            const departureDate = firstSegment.departure.at.split('T')[0]
                .replace(/-/g, '')
                .slice(2); // Convert to DDMMYY
            // Generate URL based on airline
            switch (mainAirline) {
                case 'LH': // Lufthansa
                    return `https://www.lufthansa.com/us/en/flight-search?searchType=ONEWAY&adults=1&children=0&infants=0&origin=${origin}&destination=${destination}&departureDate=${departureDate}`;
                case 'AF': // Air France
                    return `https://wwws.airfrance.us/search/offer?origin=${origin}&destination=${destination}&outboundDate=${departureDate}&cabinClass=ECONOMY&adults=1&children=0&infants=0`;
                case 'BA': // British Airways
                    return `https://www.britishairways.com/travel/book/public/en_us?origin=${origin}&destination=${destination}&outboundDate=${departureDate}&cabinclass=M&adultcount=1&childcount=0&infantcount=0`;
                case 'UA': // United Airlines
                    return `https://www.united.com/ual/en/us/flight-search/book-a-flight/results/rev?f=${origin}&t=${destination}&d=${departureDate}&tt=1&sc=7&px=1&taxng=1&idx=1`;
                case 'AA': // American Airlines
                    return `https://www.aa.com/booking/find-flights?origin=${origin}&destination=${destination}&departureDate=${departureDate}&passengers=1`;
                case 'DL': // Delta Airlines
                    return `https://www.delta.com/flight-search/book-a-flight?origin=${origin}&destination=${destination}&departureDate=${departureDate}&passengers=1`;
                default:
                    // Generic booking URL format for other airlines
                    return `https://www.google.com/travel/flights?q=flights%20${origin}%20to%20${destination}%20${departureDate}`;
            }
        }
        catch (error) {
            logger.error('Error generating booking URL:', { error });
            // Return a fallback URL
            return 'https://www.google.com/travel/flights';
        }
    }
    isCacheValid(timestamp) {
        return Date.now() - timestamp < this.CACHE_TTL;
    }
    async searchLocations(keyword) {
        // Check cache first
        const cacheKey = keyword.toLowerCase();
        const cached = this.locationCache.get(cacheKey);
        if (cached && this.isCacheValid(cached.timestamp)) {
            logger.info('Returning cached location data', {
                keyword,
                cacheAge: Math.round((Date.now() - cached.timestamp) / 1000 / 60) + ' minutes'
            });
            return cached.data;
        }
        return this.executeWithRateLimit(async () => {
            try {
                logger.info('Searching locations with keyword', { keyword });
                const response = await this.client.referenceData.locations.get({
                    keyword,
                    subType: 'CITY,AIRPORT',
                    view: 'LIGHT'
                });
                const locations = JSON.parse(response.body);
                logger.info('Location search successful', {
                    count: locations.data?.length || 0
                });
                // Cache the results
                this.locationCache.set(cacheKey, {
                    data: locations.data || [],
                    timestamp: Date.now()
                });
                return locations.data || [];
            }
            catch (error) {
                logger.error('Failed to search locations', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                    keyword
                });
                throw error;
            }
        });
    }
    // Add a method to get city name for an airport code
    async getAirportCityName(airportCode) {
        if (!airportCode || airportCode.length < 3) {
            logger.warn('Invalid airport code provided', { airportCode });
            return null;
        }
        // Check if we have it in cache first
        const cacheKey = `airport-${airportCode.toUpperCase()}`;
        const cached = this.locationCache.get(cacheKey);
        if (cached && this.isCacheValid(cached.timestamp)) {
            logger.info('Returning cached airport city name', {
                airportCode,
                cacheAge: Math.round((Date.now() - cached.timestamp) / 1000 / 60) + ' minutes'
            });
            return cached.data[0]?.address?.cityName || null;
        }
        return this.executeWithRateLimit(async () => {
            try {
                logger.info('Looking up city name for airport code', { airportCode });
                const response = await this.client.referenceData.locations.get({
                    keyword: airportCode,
                    subType: 'AIRPORT', // Specifically looking for airports
                    page: {
                        limit: 1, // We only need one result
                        offset: 0
                    },
                    view: 'FULL'
                });
                const result = JSON.parse(response.body);
                const locations = result.data || [];
                if (locations.length === 0) {
                    logger.warn('No location found for airport code', { airportCode });
                    return null;
                }
                const cityName = locations[0]?.address?.cityName || null;
                logger.info('Successfully retrieved city name for airport code', {
                    airportCode,
                    cityName,
                    locationData: locations[0]
                });
                // Cache the results
                this.locationCache.set(cacheKey, {
                    data: locations,
                    timestamp: Date.now()
                });
                return cityName;
            }
            catch (error) {
                logger.error('Failed to get city name for airport code', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                    airportCode
                });
                return null; // Return null instead of throwing on error
            }
        });
    }
    // New method to get city names for multiple airport codes at once
    async getAirportCityNames(airportCodes) {
        if (!airportCodes || airportCodes.length === 0) {
            return {};
        }
        logger.info('Getting city names for multiple airport codes', {
            count: airportCodes.length,
            codes: airportCodes.slice(0, 5).join(', ') + (airportCodes.length > 5 ? '...' : '')
        });
        const result = {};
        // Process in batches to avoid rate limiting
        const batchSize = 5;
        const uniqueCodes = [...new Set(airportCodes.filter(code => code && code.length >= 3))];
        for (let i = 0; i < uniqueCodes.length; i += batchSize) {
            const batch = uniqueCodes.slice(i, i + batchSize);
            const promises = batch.map(code => this.getAirportCityName(code));
            try {
                const cityNames = await Promise.all(promises);
                batch.forEach((code, index) => {
                    if (cityNames[index]) {
                        result[code] = cityNames[index];
                    }
                });
                // Small delay to prevent hitting rate limits
                if (i + batchSize < uniqueCodes.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            catch (error) {
                logger.error('Error processing batch of airport codes', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    batchStart: i,
                    batchSize,
                    affectedCodes: batch
                });
                // Continue with next batch despite errors
            }
        }
        logger.info('Completed city name lookup for airport codes', {
            requestedCount: airportCodes.length,
            uniqueCount: uniqueCodes.length,
            resultCount: Object.keys(result).length
        });
        return result;
    }
    /**
     * Calls the Amadeus SeatMap API with a flight offer object (POST)
     * @param flightOffer The flight offer object (as per Amadeus API)
     * @returns The seat map data
     */
    async getSeatMap(flightOffer) {
        try {
            console.log('Requesting seat map with flight offer:', JSON.stringify(flightOffer, null, 2));
            const response = await this.client.shopping.seatmaps.post({
                data: [flightOffer]
            });
            if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                throw new Error('Invalid seat map response format');
            }
            console.log('Received seat map response:', JSON.stringify(response.data, null, 2));
            return response;
        }
        catch (error) {
            const errorDetails = error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
                raw: error
            } : error;
            console.error('Error in getSeatMap:', {
                error: errorDetails,
                flightOffer
            });
            if (error instanceof Error && 'description' in error) {
                const amadeusError = error;
                throw new Error(`Amadeus API error: ${amadeusError.description || amadeusError.message}`);
            }
            throw error;
        }
    }
}
