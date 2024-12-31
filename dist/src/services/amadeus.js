import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logToFile } from '../utils/logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '../../logs');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
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
    token = '';
    tokenExpiry = 0;
    clientId;
    clientSecret;
    baseURL = 'https://test.api.amadeus.com';
    commonAirlines = {
        'AA': 'American Airlines',
        'UA': 'United Airlines',
        'DL': 'Delta Air Lines',
        'LH': 'Lufthansa',
        'BA': 'British Airways',
        'AF': 'Air France',
        'KL': 'KLM Royal Dutch Airlines',
        'IB': 'Iberia',
        'B6': 'JetBlue Airways',
        'WN': 'Southwest Airlines',
        'AS': 'Alaska Airlines',
        'VS': 'Virgin Atlantic',
        'EK': 'Emirates',
        'QR': 'Qatar Airways',
        'EY': 'Etihad Airways',
        'TK': 'Turkish Airlines',
        'LX': 'SWISS',
        'AC': 'Air Canada',
        'FI': 'Icelandair',
        'SK': 'SAS Scandinavian Airlines',
        'AZ': 'ITA Airways',
        'TP': 'TAP Air Portugal'
    };
    constructor() {
        this.clientId = process.env.AMADEUS_CLIENT_ID || '';
        this.clientSecret = process.env.AMADEUS_CLIENT_SECRET || '';
        if (!this.clientId || !this.clientSecret) {
            const error = 'Amadeus API credentials are not configured';
            logToFile(`ERROR: ${error}`);
            console.error(error);
        }
    }
    async getToken() {
        if (this.token && Date.now() < this.tokenExpiry) {
            return this.token;
        }
        try {
            logToFile('Requesting new Amadeus access token');
            const response = await axios.post(`${this.baseURL}/v1/security/oauth2/token`, new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: this.clientId,
                client_secret: this.clientSecret
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            if (!response.data?.access_token) {
                const error = 'No access token received from Amadeus';
                logToFile(`ERROR: ${error}`);
                throw new Error(error);
            }
            this.token = response.data.access_token;
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
            logToFile('Successfully obtained new access token');
            return this.token;
        }
        catch (error) {
            const errorMsg = 'Failed to get Amadeus access token:';
            logToFile(`ERROR: ${errorMsg} ${error}`);
            console.error(errorMsg, error);
            throw error;
        }
    }
    async searchFlights(params) {
        try {
            logToFile('\n=== Amadeus Flight Search Request ===');
            logToFile(`Raw params: ${JSON.stringify(params, null, 2)}`);
            const token = await this.getToken();
            // Add delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            const requestParams = {
                ...params,
                max: 50,
                currencyCode: 'USD',
                nonStop: false
            };
            logToFile(`Final request params: ${JSON.stringify(requestParams, null, 2)}`);
            logToFile(`Request URL: ${this.baseURL}/v2/shopping/flight-offers`);
            logToFile(`Authorization: Bearer ${token.substring(0, 10)}...`);
            const response = await axios.get(`${this.baseURL}/v2/shopping/flight-offers`, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: requestParams
            });
            logToFile('\n=== Amadeus Flight Search Response ===');
            logToFile(`Status: ${response.status}`);
            logToFile(`Headers: ${JSON.stringify(response.headers, null, 2)}`);
            if (!response.data?.data) {
                const error = {
                    status: response.status,
                    statusText: response.statusText,
                    data: JSON.stringify(response.data, null, 2),
                    headers: response.headers
                };
                logToFile(`ERROR: Invalid response structure: ${JSON.stringify(error, null, 2)}`);
                throw new Error('Invalid response from Amadeus API');
            }
            const results = response.data.data;
            logToFile('\n=== Amadeus Search Results ===');
            logToFile(`Total results: ${results.length}`);
            if (results.length > 0) {
                logToFile(`First result: ${JSON.stringify(results[0], null, 2)}`);
            }
            logToFile(`Meta: ${JSON.stringify(response.data.meta, null, 2)}`);
            logToFile(`Dictionaries: ${JSON.stringify(response.data.dictionaries, null, 2)}`);
            return results;
        }
        catch (error) {
            logToFile('\n=== Amadeus API Error ===');
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 429) {
                    logToFile('Rate limit exceeded, retrying after delay...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return this.searchFlights(params);
                }
                logToFile(`Request config: ${JSON.stringify({
                    url: error.config?.url,
                    method: error.config?.method,
                    params: error.config?.params,
                    headers: error.config?.headers
                }, null, 2)}`);
                logToFile(`Response error details: ${JSON.stringify({
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    errors: error.response?.data?.errors,
                    headers: error.response?.headers
                }, null, 2)}`);
                // Log the specific error message from Amadeus
                if (error.response?.data?.errors) {
                    logToFile('Amadeus Error Messages:');
                    error.response.data.errors.forEach((err) => {
                        logToFile(`- ${err.title}: ${err.detail} (${err.code})`);
                    });
                }
            }
            else {
                logToFile(`Non-Axios error: ${error}`);
            }
            throw error;
        }
    }
    async getAirlineInfo(airlineCodes) {
        const codes = Array.isArray(airlineCodes) ? airlineCodes : [airlineCodes];
        const results = [];
        try {
            const token = await this.getToken();
            // Use the correct endpoint with airlineCodes query parameter
            const response = await axios.get(`${this.baseURL}/v1/reference-data/airlines`, {
                params: {
                    airlineCodes: codes.join(',')
                },
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            if (response.data?.data) {
                results.push(...response.data.data.map((airline) => ({
                    ...airline,
                    commonName: airline.commonName || airline.businessName || airline.iataCode
                })));
            }
        }
        catch (error) {
            logToFile(`Error fetching airline info: ${error}`);
            // Fallback to dictionaries and common airlines map
            results.push(...codes.map(code => ({
                iataCode: code,
                commonName: this.commonAirlines[code] || code,
                businessName: this.commonAirlines[code]
            })));
        }
        return results;
    }
    async getAirportInfo(airportCode) {
        try {
            const token = await this.getToken();
            const response = await axios.get(`${this.baseURL}/reference-data/locations/${airportCode}`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            return response.data.data;
        }
        catch (error) {
            console.error('Error fetching airport info:', error);
            throw error;
        }
    }
    transformFlightOffer(offer, airlineInfoArray) {
        const outboundSegments = offer.itineraries[0].segments;
        const inboundSegments = offer.itineraries[1]?.segments || [];
        const firstSegment = outboundSegments[0];
        const lastOutboundSegment = outboundSegments[outboundSegments.length - 1];
        const firstInboundSegment = inboundSegments[0];
        const lastInboundSegment = inboundSegments[inboundSegments.length - 1];
        logToFile('\n=== Transforming Flight Offer ===');
        logToFile(`Offer ID: ${offer.id}`);
        logToFile(`Raw outbound segments: ${JSON.stringify(outboundSegments, null, 2)}`);
        if (inboundSegments.length > 0) {
            logToFile(`Raw inbound segments: ${JSON.stringify(inboundSegments, null, 2)}`);
        }
        const totalPrice = parseFloat(offer.price.total);
        const numberOfTravelers = offer.travelerPricings.length;
        const pricePerTraveler = totalPrice / numberOfTravelers;
        const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;
        logToFile(`Price details:
      Total price: $${totalPrice}
      Number of travelers: ${numberOfTravelers}
      Price per traveler: $${pricePerTraveler.toFixed(2)}
      Cabin class: ${cabinClass}
    `);
        const tier = this.determineTier(totalPrice, cabinClass, numberOfTravelers);
        const getAirlineInfo = (carrierCode) => {
            // First try Amadeus dictionaries
            if (offer.dictionaries?.carriers?.[carrierCode]) {
                return {
                    code: carrierCode,
                    name: offer.dictionaries.carriers[carrierCode]
                };
            }
            // Then check the airline info array from API
            const info = airlineInfoArray.find(airline => airline.iataCode === carrierCode);
            if (info) {
                return {
                    code: carrierCode,
                    name: info.businessName || info.commonName || carrierCode
                };
            }
            // Fallback to carrier code if no translation found
            return {
                code: carrierCode,
                name: carrierCode
            };
        };
        // Log aircraft information from dictionaries
        logToFile('\n=== Aircraft Information ===');
        logToFile(`Aircraft dictionary: ${JSON.stringify(offer.dictionaries?.aircraft || {}, null, 2)}`);
        const getAircraftInfo = (segment, dictionaries) => {
            try {
                const rawCode = segment?.aircraft?.code;
                if (!rawCode) {
                    logToFile('No aircraft code found in segment');
                    return { code: 'N/A', name: 'Aircraft information not available' };
                }
                // Clean the code by removing non-alphanumeric characters and converting to uppercase
                const code = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                logToFile(`Processing aircraft code: ${rawCode} (cleaned: ${code})`);
                // First, check our own mapping
                if (AIRCRAFT_CODES[code]) {
                    logToFile(`Found exact match in AIRCRAFT_CODES mapping: ${code} -> ${AIRCRAFT_CODES[code]}`);
                    return { code, name: AIRCRAFT_CODES[code] };
                }
                // Log available codes for debugging
                logToFile(`Available aircraft codes in mapping: ${Object.keys(AIRCRAFT_CODES).join(', ')}`);
                // Try to find a similar match
                const similarCodes = Object.keys(AIRCRAFT_CODES).filter(mappedCode => mappedCode.includes(code) || code.includes(mappedCode));
                if (similarCodes.length > 0) {
                    const bestMatch = similarCodes[0];
                    logToFile(`Found similar match: ${code} -> ${bestMatch} (${AIRCRAFT_CODES[bestMatch]})`);
                    return { code, name: AIRCRAFT_CODES[bestMatch] };
                }
                // Check Amadeus dictionary as fallback
                logToFile('Checking Amadeus dictionary for aircraft code ' + code);
                logToFile('Amadeus dictionaries: ' + JSON.stringify(dictionaries));
                if (dictionaries?.aircraft?.[code]) {
                    const name = dictionaries.aircraft[code];
                    logToFile(`Found in Amadeus dictionary: ${code} -> ${name}`);
                    return { code, name };
                }
                // If no match found, return a formatted version of the code
                logToFile(`No aircraft match found for code: ${code}`);
                return { code, name: `Aircraft ${code}` };
            }
            catch (error) {
                logToFile(`Error processing aircraft info: ${error}`);
                return { code: 'ERR', name: 'Error processing aircraft information' };
            }
        };
        const airlineInfo = getAirlineInfo(firstSegment.carrierCode);
        const flightNumber = `${firstSegment.carrierCode}${firstSegment.number}`;
        // Base structure that's common for both simplified and detailed formats
        const transformed = {
            id: offer.id,
            airline: airlineInfo.name,
            airlineCode: airlineInfo.code,
            flightNumber,
            price: {
                amount: totalPrice,
                currency: offer.price.currency,
                perTraveler: pricePerTraveler,
                numberOfTravelers
            },
            route: `${firstSegment.departure.iataCode} - ${lastOutboundSegment.arrival.iataCode}`,
            outbound: firstSegment.departure.at,
            inbound: lastInboundSegment?.arrival.at,
            duration: this.calculateTotalDuration(outboundSegments),
            layovers: outboundSegments.length - 1,
            segments: outboundSegments.map(segment => {
                logToFile(`Processing outbound segment: ${JSON.stringify(segment, null, 2)}`);
                const aircraft = getAircraftInfo(segment, offer.dictionaries);
                const airline = getAirlineInfo(segment.carrierCode);
                const fareDetails = offer.travelerPricings[0].fareDetailsBySegment.find(fare => fare.segmentId === segment.id);
                return {
                    airline: airline.name,
                    flightNumber: `${segment.carrierCode}${segment.number}`,
                    aircraft: {
                        code: aircraft.code,
                        name: aircraft.name
                    },
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
                    cabinClass: fareDetails?.cabin || cabinClass
                };
            }),
            returnSegments: inboundSegments.length > 0 ? inboundSegments.map(segment => {
                logToFile(`Processing inbound segment: ${JSON.stringify(segment, null, 2)}`);
                const aircraft = getAircraftInfo(segment, offer.dictionaries);
                const airline = getAirlineInfo(segment.carrierCode);
                const fareDetails = offer.travelerPricings[0].fareDetailsBySegment.find(fare => fare.segmentId === segment.id);
                return {
                    airline: airline.name,
                    flightNumber: `${segment.carrierCode}${segment.number}`,
                    aircraft: {
                        code: aircraft.code,
                        name: aircraft.name
                    },
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
                    cabinClass: fareDetails?.cabin || cabinClass
                };
            }) : undefined,
            cabinClass,
            bookingClass: offer.travelerPricings[0].fareDetailsBySegment[0].class,
            tier,
            referenceUrl: this.generateBookingUrl(offer),
            dictionaries: offer.dictionaries
        };
        // Log the final transformation for debugging
        logToFile(`\nTransformed flight offer:
      ID: ${transformed.id}
      Airline: ${transformed.airline}
      Flight Number: ${transformed.flightNumber}
      Aircraft info: ${JSON.stringify(transformed.segments.map(s => s.aircraft), null, 2)}
      Dictionaries: ${JSON.stringify(transformed.dictionaries, null, 2)}
    `);
        return transformed;
    }
    calculateTotalDuration(segments) {
        // Convert PT10H30M format to minutes, sum them, and convert back to PT format
        const totalMinutes = segments.reduce((total, segment) => {
            const hours = segment.duration.match(/(\d+)H/)?.[1] || '0';
            const minutes = segment.duration.match(/(\d+)M/)?.[1] || '0';
            return total + parseInt(hours) * 60 + parseInt(minutes);
        }, 0);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `PT${hours}H${minutes}M`;
    }
    determineTier(price, cabinClass, numberOfTravelers = 1) {
        logToFile(`\n=== Determining Price Tier ===`);
        logToFile(`Total Price: $${price}`);
        logToFile(`Number of Travelers: ${numberOfTravelers}`);
        logToFile(`Cabin Class: ${cabinClass}`);
        // Convert total price to per-traveler price for tier determination
        const pricePerTraveler = price / numberOfTravelers;
        logToFile(`Price per traveler: $${pricePerTraveler.toFixed(2)}`);
        // Base categorization (per traveler)
        let tier;
        // Strict price ranges per traveler
        if (pricePerTraveler <= 800) {
            tier = 'budget';
            logToFile(`Price per traveler $${pricePerTraveler.toFixed(2)} <= $800 -> BUDGET`);
        }
        else if (pricePerTraveler <= 2000) {
            tier = 'medium';
            logToFile(`$800 < Price per traveler $${pricePerTraveler.toFixed(2)} <= $2000 -> MEDIUM`);
        }
        else {
            tier = 'premium';
            logToFile(`Price per traveler $${pricePerTraveler.toFixed(2)} > $2000 -> PREMIUM`);
        }
        logToFile(`Initial tier based on price per traveler: ${tier.toUpperCase()}`);
        // Cabin class override
        if (cabinClass) {
            const normalizedCabin = cabinClass.toUpperCase();
            const originalTier = tier;
            // Only override to higher tiers, never downgrade
            if ((normalizedCabin === 'FIRST' || normalizedCabin === 'BUSINESS') && tier !== 'premium') {
                tier = 'premium';
                logToFile(`Cabin class ${normalizedCabin} -> Override to PREMIUM`);
            }
            else if (normalizedCabin === 'PREMIUM_ECONOMY' && tier === 'budget') {
                tier = 'medium';
                logToFile(`Cabin class ${normalizedCabin} and was BUDGET -> Override to MEDIUM`);
            }
            if (originalTier !== tier) {
                logToFile(`Tier adjusted due to cabin class ${normalizedCabin}: ${originalTier} -> ${tier}`);
            }
        }
        logToFile(`Final categorization: ${tier.toUpperCase()}`);
        logToFile(`Price breakdown:
      Total price: $${price}
      Per traveler: $${pricePerTraveler.toFixed(2)}
      Cabin class: ${cabinClass}
      Tier: ${tier.toUpperCase()}
    `);
        return tier;
    }
    generateBookingUrl(offer) {
        const firstSegment = offer.itineraries[0].segments[0];
        const lastSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
        // Extract basic flight info
        const origin = firstSegment.departure.iataCode;
        const destination = lastSegment.arrival.iataCode;
        const departureDate = firstSegment.departure.at.split('T')[0];
        const returnDate = offer.itineraries[1]?.segments[0]?.departure.at.split('T')[0];
        const airline = firstSegment.carrierCode;
        // Generate a generic booking URL based on the airline
        switch (airline.toUpperCase()) {
            case 'AA':
                return `https://www.aa.com/booking/flights?o=${origin}&d=${destination}&d1=${departureDate}${returnDate ? `&d2=${returnDate}` : ''}`;
            case 'BA':
                return `https://www.britishairways.com/travel/booking/public/en_gb?o=${origin}&d=${destination}&d1=${departureDate}${returnDate ? `&d2=${returnDate}` : ''}`;
            case 'LH':
                return `https://www.lufthansa.com/booking/flights?o=${origin}&d=${destination}&d1=${departureDate}${returnDate ? `&d2=${returnDate}` : ''}`;
            case 'AF':
                return `https://www.airfrance.com/booking/flights?o=${origin}&d=${destination}&d1=${departureDate}${returnDate ? `&d2=${returnDate}` : ''}`;
            case 'KL':
                return `https://www.klm.com/booking/flights?o=${origin}&d=${destination}&d1=${departureDate}${returnDate ? `&d2=${returnDate}` : ''}`;
            default:
                // Default to a generic booking site
                return `https://www.google.com/flights?hl=en#flt=${origin}.${destination}.${departureDate}${returnDate ? `*${destination}.${origin}.${returnDate}` : ''}`;
        }
    }
    createFlightIdentifier(flight) {
        if (!flight.airline || !flight.flightNumber || !flight.outbound || !flight.price?.amount) {
            logToFile(`WARNING: Invalid flight data for identifier: ${JSON.stringify(flight, null, 2)}`);
            return '';
        }
        // Standardize the components
        const standardizedAirline = flight.airline.trim().toUpperCase();
        const standardizedFlightNumber = flight.flightNumber.trim().toUpperCase();
        const standardizedRoute = flight.route.replace(' to ', ' - ').toUpperCase().trim();
        const standardizedOutbound = new Date(flight.outbound).toISOString();
        const standardizedPrice = flight.price.amount.toFixed(2);
        // Create a unique identifier that captures all relevant aspects
        const identifier = [
            standardizedAirline,
            standardizedFlightNumber,
            standardizedRoute,
            standardizedOutbound,
            flight.duration,
            flight.layovers,
            standardizedPrice
        ].join('|');
        logToFile(`Created flight identifier: ${identifier}`);
        return identifier;
    }
    deduplicateFlights(flights) {
        logToFile(`\n=== Deduplicating Flights ===`);
        logToFile(`Initial count: ${flights.length}`);
        const uniqueFlights = new Map();
        const duplicates = new Set();
        flights.forEach(flight => {
            // Standardize airline codes
            if (flight.airline.length > 3) {
                const airlineCodeMap = {
                    'Norse Atlantic Airways': 'N0',
                    'LEVEL': 'LV',
                    'British Airways': 'BA',
                    'American Airlines': 'AA',
                    'Delta Air Lines': 'DL',
                    'United Airlines': 'UA',
                    'Air Canada': 'AC',
                    'Air France': 'AF',
                    'KLM': 'KL',
                    'Lufthansa': 'LH',
                    'Iberia': 'IB',
                    'Swiss': 'LX',
                    'Alitalia': 'AZ'
                };
                flight.airline = airlineCodeMap[flight.airline] || flight.airline.substring(0, 2).toUpperCase();
            }
            // Create a standardized identifier
            const identifier = this.createFlightIdentifier(flight);
            if (!identifier) {
                logToFile(`Skipping invalid flight: ${JSON.stringify(flight, null, 2)}`);
                return;
            }
            // Check for duplicates
            if (uniqueFlights.has(identifier)) {
                duplicates.add(identifier);
                logToFile(`Duplicate found: ${identifier}`);
                // Compare prices and keep the lower one
                const existing = uniqueFlights.get(identifier);
                if (flight.price.amount < existing.price.amount) {
                    logToFile(`Replacing flight with lower price: $${flight.price.amount} < $${existing.price.amount}`);
                    uniqueFlights.set(identifier, flight);
                }
                else {
                    logToFile(`Keeping existing flight with lower/equal price: $${existing.price.amount} <= $${flight.price.amount}`);
                }
            }
            else {
                uniqueFlights.set(identifier, flight);
                logToFile(`Added new unique flight: ${identifier}`);
            }
        });
        const deduplicated = Array.from(uniqueFlights.values());
        // Log deduplication results
        logToFile(`\n=== Deduplication Results ===`);
        logToFile(`Original count: ${flights.length}`);
        logToFile(`Deduplicated count: ${deduplicated.length}`);
        logToFile(`Duplicates removed: ${flights.length - deduplicated.length}`);
        if (duplicates.size > 0) {
            logToFile('\nDuplicate identifiers found:');
            duplicates.forEach(id => logToFile(id));
        }
        // Sort by price and then by departure time for consistent ordering
        return deduplicated.sort((a, b) => {
            const priceDiff = a.price.amount - b.price.amount;
            if (priceDiff !== 0)
                return priceDiff;
            return new Date(a.outbound).getTime() - new Date(b.outbound).getTime();
        });
    }
    parseFlightDetails(offer) {
        const firstSegment = offer.itineraries[0].segments[0];
        const lastOutboundSegment = offer.itineraries[0].segments[offer.itineraries[0].segments.length - 1];
        const inboundSegments = offer.itineraries[1]?.segments || [];
        const firstInboundSegment = inboundSegments[0];
        const lastInboundSegment = inboundSegments[inboundSegments.length - 1];
        const cabinClass = offer.travelerPricings[0].fareDetailsBySegment[0].cabin;
        const numberOfTravelers = offer.travelerPricings.length;
        // Get aircraft info from dictionaries
        const aircraftInfo = offer.dictionaries?.aircraft || {};
        // Calculate total duration
        const outboundDuration = this.calculateTotalDuration(offer.itineraries[0].segments);
        const inboundDuration = inboundSegments.length ? this.calculateTotalDuration(inboundSegments) : '0H';
        // Determine services based on cabin class
        const services = [];
        if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
            services.push({
                name: 'Priority Check-in',
                description: 'Dedicated check-in counters',
                isChargeable: false
            }, {
                name: 'Lounge Access',
                description: 'Access to airline lounges',
                isChargeable: false
            }, {
                name: 'Fast Track Security',
                description: 'Priority security screening',
                isChargeable: false
            });
            if (cabinClass === 'FIRST') {
                services.push({
                    name: 'Chauffeur Service',
                    description: 'Complimentary airport transfer (where available)',
                    isChargeable: false
                });
            }
        }
        else if (cabinClass === 'PREMIUM_ECONOMY') {
            services.push({
                name: 'Priority Boarding',
                description: 'Board before economy class',
                isChargeable: false
            }, {
                name: 'Extra Legroom',
                description: 'More space between seats',
                isChargeable: false
            });
        }
        // Determine amenities based on cabin class
        const amenities = [];
        if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
            amenities.push({
                description: 'Premium Meal Service',
                isChargeable: false,
                amenityType: 'MEAL',
                amenityProvider: { name: 'Airline' }
            }, {
                description: 'Premium Amenity Kit',
                isChargeable: false,
                amenityType: 'COMFORT',
                amenityProvider: { name: 'Airline' }
            }, {
                description: 'Lie-flat Seats',
                isChargeable: false,
                amenityType: 'SEAT',
                amenityProvider: { name: 'Airline' }
            });
        }
        else if (cabinClass === 'PREMIUM_ECONOMY') {
            amenities.push({
                description: 'Enhanced Meal Service',
                isChargeable: false,
                amenityType: 'MEAL',
                amenityProvider: { name: 'Airline' }
            }, {
                description: 'Basic Amenity Kit',
                isChargeable: false,
                amenityType: 'COMFORT',
                amenityProvider: { name: 'Airline' }
            });
        }
        else {
            amenities.push({
                description: 'Standard Meal Service',
                isChargeable: true,
                amenityType: 'MEAL',
                amenityProvider: { name: 'Airline' }
            });
        }
        // Add common amenities
        amenities.push({
            description: 'In-flight Entertainment',
            isChargeable: false,
            amenityType: 'ENTERTAINMENT',
            amenityProvider: { name: 'Airline' }
        }, {
            description: 'Wi-Fi',
            isChargeable: true,
            amenityType: 'WIFI',
            amenityProvider: { name: 'Airline' }
        });
        // Determine policies based on cabin class
        const policies = {
            checkedBags: offer.travelerPricings[0].fareDetailsBySegment[0].includedCheckedBags?.quantity || 0,
            carryOn: 1,
            seatSelection: cabinClass === 'FIRST' || cabinClass === 'BUSINESS',
            cancellation: cabinClass === 'FIRST' || cabinClass === 'BUSINESS'
                ? 'Flexible booking with reduced fees'
                : cabinClass === 'PREMIUM_ECONOMY'
                    ? 'Changes allowed with fee'
                    : 'Non-refundable',
            changes: cabinClass === 'FIRST' || cabinClass === 'BUSINESS'
                ? 'Free changes'
                : cabinClass === 'PREMIUM_ECONOMY'
                    ? 'Changes allowed with fee'
                    : 'Changes may be allowed with fee',
            refund: cabinClass === 'FIRST' || cabinClass === 'BUSINESS'
                ? 'Refundable with fees'
                : 'Non-refundable'
        };
        return {
            airline: firstSegment.carrierCode,
            route: `${firstSegment.departure.iataCode} - ${lastOutboundSegment.arrival.iataCode}`,
            duration: outboundDuration,
            layovers: offer.itineraries[0].segments.length - 1,
            outbound: firstSegment.departure.at,
            inbound: lastInboundSegment?.arrival.at || lastOutboundSegment.arrival.at,
            price: {
                amount: parseFloat(offer.price.total),
                currency: offer.price.currency,
                numberOfTravelers
            },
            tier: this.determineTier(parseFloat(offer.price.total), cabinClass, numberOfTravelers),
            flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
            referenceUrl: this.generateBookingUrl(offer),
            cabinClass,
            details: {
                price: {
                    amount: parseFloat(offer.price.total),
                    currency: offer.price.currency,
                    numberOfTravelers
                },
                outbound: {
                    departure: {
                        airport: firstSegment.departure.iataCode,
                        terminal: firstSegment.departure.terminal,
                        time: firstSegment.departure.at
                    },
                    arrival: {
                        airport: lastOutboundSegment.arrival.iataCode,
                        terminal: lastOutboundSegment.arrival.terminal,
                        time: lastOutboundSegment.arrival.at
                    },
                    duration: outboundDuration,
                    segments: offer.itineraries[0].segments.map(segment => ({
                        airline: segment.carrierCode,
                        flightNumber: `${segment.carrierCode}${segment.number}`,
                        aircraft: {
                            code: segment.aircraft.code,
                            name: aircraftInfo[segment.aircraft.code] || segment.aircraft.code
                        },
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
                        cabinClass: offer.travelerPricings[0].fareDetailsBySegment.find(fare => fare.segmentId === segment.id)?.cabin || cabinClass
                    }))
                },
                inbound: inboundSegments.length ? {
                    departure: {
                        airport: firstInboundSegment.departure.iataCode,
                        terminal: firstInboundSegment.departure.terminal,
                        time: firstInboundSegment.departure.at
                    },
                    arrival: {
                        airport: lastInboundSegment.arrival.iataCode,
                        terminal: lastInboundSegment.arrival.terminal,
                        time: lastInboundSegment.arrival.at
                    },
                    duration: inboundDuration,
                    segments: inboundSegments.map(segment => ({
                        airline: segment.carrierCode,
                        flightNumber: `${segment.carrierCode}${segment.number}`,
                        aircraft: {
                            code: segment.aircraft.code,
                            name: aircraftInfo[segment.aircraft.code] || segment.aircraft.code
                        },
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
                        cabinClass: offer.travelerPricings[0].fareDetailsBySegment.find(fare => fare.segmentId === segment.id)?.cabin || cabinClass
                    }))
                } : undefined,
                bookingClass: offer.travelerPricings[0].fareDetailsBySegment[0].class,
                fareBasis: offer.travelerPricings[0].fareDetailsBySegment[0].fareBasis,
                validatingAirline: offer.validatingAirlineCodes[0],
                fareDetailsBySegment: offer.travelerPricings[0].fareDetailsBySegment.map(fare => ({
                    cabin: fare.cabin,
                    class: fare.class,
                    includedCheckedBags: fare.includedCheckedBags,
                    brandedFare: fare.brandedFare,
                    fareBasis: fare.fareBasis
                })),
                services,
                policies,
                amenities
            }
        };
    }
    async searchHotels(params) {
        try {
            logToFile('\n=== Amadeus Hotel Search Request ===');
            logToFile(`Raw params: ${JSON.stringify(params, null, 2)}`);
            const token = await this.getToken();
            // Add delay between requests to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            const requestParams = {
                cityCode: params.cityCode,
                checkInDate: params.checkInDate,
                checkOutDate: params.checkOutDate,
                adults: params.adults,
                roomQuantity: params.roomQuantity || 1,
                priceRange: params.priceRange ? `${params.priceRange.min}-${params.priceRange.max}` : undefined,
                ratings: params.ratings ? params.ratings.join(',') : undefined,
                currency: 'USD',
                bestRateOnly: true,
                view: 'FULL'
            };
            logToFile(`Final request params: ${JSON.stringify(requestParams, null, 2)}`);
            logToFile(`Request URL: ${this.baseURL}/v2/shopping/hotel-offers`);
            const response = await axios.get(`${this.baseURL}/v2/shopping/hotel-offers`, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: requestParams
            });
            logToFile('\n=== Amadeus Hotel Search Response ===');
            logToFile(`Status: ${response.status}`);
            logToFile(`Headers: ${JSON.stringify(response.headers, null, 2)}`);
            if (!response.data?.data) {
                const error = {
                    status: response.status,
                    statusText: response.statusText,
                    data: JSON.stringify(response.data, null, 2),
                    headers: response.headers
                };
                logToFile(`ERROR: Invalid response structure: ${JSON.stringify(error, null, 2)}`);
                throw new Error('Invalid response from Amadeus API');
            }
            const results = response.data.data;
            logToFile('\n=== Amadeus Hotel Search Results ===');
            logToFile(`Total results: ${results.length}`);
            if (results.length > 0) {
                logToFile(`First result: ${JSON.stringify(results[0], null, 2)}`);
            }
            return results;
        }
        catch (error) {
            logToFile('\n=== Amadeus API Error ===');
            if (axios.isAxiosError(error)) {
                logToFile(`Request config: ${JSON.stringify({
                    url: error.config?.url,
                    method: error.config?.method,
                    params: error.config?.params,
                    headers: error.config?.headers
                }, null, 2)}`);
                logToFile(`Response error details: ${JSON.stringify({
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    errors: error.response?.data?.errors,
                    headers: error.response?.headers
                }, null, 2)}`);
                if (error.response?.data?.errors) {
                    logToFile('Amadeus Error Messages:');
                    error.response.data.errors.forEach((err) => {
                        logToFile(`- ${err.title}: ${err.detail} (${err.code})`);
                    });
                }
            }
            else {
                logToFile(`Non-Axios error: ${error}`);
            }
            throw error;
        }
    }
    transformHotelOffer(offer) {
        const hotelOffer = offer.offers[0]; // Get the first/best offer
        const price = parseFloat(hotelOffer.price.total);
        return {
            id: hotelOffer.id,
            name: offer.hotel.name,
            rating: parseFloat(offer.hotel.rating),
            location: {
                cityCode: offer.hotel.cityCode,
                latitude: offer.hotel.latitude,
                longitude: offer.hotel.longitude
            },
            price: {
                amount: price,
                currency: hotelOffer.price.currency,
                perNight: parseFloat(hotelOffer.price.variations.average.base)
            },
            room: {
                type: hotelOffer.room.type,
                category: hotelOffer.room.typeEstimated.category,
                beds: hotelOffer.room.typeEstimated.beds,
                bedType: hotelOffer.room.typeEstimated.bedType,
                description: hotelOffer.room.description.text
            },
            checkIn: hotelOffer.checkInDate,
            checkOut: hotelOffer.checkOutDate,
            cancellationPolicy: {
                deadline: hotelOffer.policies.cancellation?.deadline,
                paymentType: hotelOffer.policies.paymentType
            },
            hotelChain: offer.hotel.chainCode || 'Independent',
            tier: this.determineHotelTier(price, parseFloat(offer.hotel.rating)),
            available: offer.available
        };
    }
    determineHotelTier(price, rating) {
        // Base tier on both price and rating
        if (rating >= 4.5 || price > 500) {
            return 'premium';
        }
        else if (rating >= 3.5 || price > 200) {
            return 'medium';
        }
        return 'budget';
    }
}
export const amadeusService = new AmadeusService();
