import Amadeus from 'amadeus';
import { logger } from '../utils/logger.js';
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
        const clientId = process.env.AMADEUS_CLIENT_ID;
        const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
        logger.info('Initializing Amadeus service', {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret
        });
        if (!clientId || !clientSecret) {
            logger.error('Missing Amadeus API credentials', {
                clientIdPresent: !!clientId,
                clientSecretPresent: !!clientSecret
            });
            throw new Error('Missing Amadeus API credentials');
        }
        try {
            this.amadeus = new Amadeus({
                clientId,
                clientSecret,
            });
            logger.info('Amadeus client initialized successfully');
        }
        catch (error) {
            logger.error('Failed to initialize Amadeus client', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    async searchHotels(params) {
        try {
            logger.info('Searching for hotels in city', { params });
            // Get hotels with offers
            const hotelsResponse = await this.amadeus.shopping.hotelOffers.get({
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
                logger.info('Searching flights with params:', {
                    segments: params.segments,
                    travelClass: params.travelClass,
                    adults: params.adults
                });
                if (!params.segments || !Array.isArray(params.segments) || params.segments.length === 0) {
                    throw new Error('At least one flight segment is required');
                }
                // Validate all segments
                params.segments.forEach((segment, index) => {
                    if (!segment.originLocationCode || !segment.destinationLocationCode || !segment.departureDate) {
                        throw new Error(`Invalid segment data at index ${index}: origin, destination, and departure date are required`);
                    }
                });
                // Format the search parameters according to Amadeus API requirements
                const searchParams = {
                    originDestinations: params.segments.map((segment, index) => ({
                        id: String(index + 1),
                        originLocationCode: segment.originLocationCode,
                        destinationLocationCode: segment.destinationLocationCode,
                        departureDateTimeRange: {
                            date: segment.departureDate
                        }
                    })),
                    travelers: Array.from({ length: params.adults }, (_, i) => ({
                        id: String(i + 1),
                        travelerType: 'ADULT'
                    })),
                    sources: ['GDS'],
                    searchCriteria: {
                        maxFlightOffers: params.max || 100,
                        flightFilters: {
                            cabinRestrictions: [{
                                    cabin: params.travelClass,
                                    coverage: 'MOST_SEGMENTS',
                                    originDestinationIds: params.segments.map((_, i) => String(i + 1))
                                }]
                        }
                    }
                };
                logger.info('Making Amadeus API call with formatted params:', searchParams);
                const response = await this.amadeus.shopping.flightOffersSearch.post(JSON.stringify(searchParams));
                if (!response || !response.body) {
                    logger.warn('Empty response from Amadeus API');
                    return [];
                }
                const results = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
                logger.info('Flight search successful', {
                    count: results.data?.length || 0,
                    dictionaries: results.dictionaries,
                    firstResult: results.data?.[0]
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
                    amadeusInitialized: !!this.amadeus,
                    hasShoppingAPI: !!this.amadeus?.shopping?.flightOffersSearch?.post
                });
                return []; // Return empty array instead of throwing
            }
        });
    }
    async confirmFlightPrice(flightOffer) {
        try {
            logger.info('Confirming flight price', {
                offerId: flightOffer.id,
                price: flightOffer.price
            });
            const response = await this.amadeus.shopping.flightOffersSearch.pricing.post(JSON.stringify({
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
    async searchLocations(keyword) {
        try {
            logger.info('Searching locations with keyword', { keyword });
            const response = await this.amadeus.referenceData.locations.get({
                keyword,
                subType: 'CITY,AIRPORT',
                view: 'LIGHT'
            });
            const locations = JSON.parse(response.body);
            logger.info('Location search successful', {
                count: locations.data?.length || 0
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
    }
}
