import { logger } from '../utils/logger.js';
import Amadeus from 'amadeus';
export class AmadeusService {
    client;
    initialized = false;
    constructor() {
        this.initializeClient();
    }
    initializeClient() {
        if (this.initialized)
            return;
        try {
            if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
                throw new Error('Amadeus credentials are not configured');
            }
            this.client = new Amadeus({
                clientId: process.env.AMADEUS_CLIENT_ID,
                clientSecret: process.env.AMADEUS_CLIENT_SECRET,
                logLevel: 'debug'
            });
            this.initialized = true;
            logger.info('[AmadeusService] Initialized with credentials', {
                clientIdLength: process.env.AMADEUS_CLIENT_ID?.length,
                environment: process.env.NODE_ENV
            });
        }
        catch (error) {
            logger.error('[AmadeusService] Failed to initialize', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async getSeatMap(flightOffer) {
        if (!this.initialized) {
            this.initializeClient();
        }
        try {
            logger.info('[AmadeusService] Requesting seat map', {
                flightId: flightOffer.id,
                segments: flightOffer.itineraries?.[0]?.segments?.length
            });
            // Transform the flight offer into Amadeus format
            const transformedOffer = {
                data: [{
                        type: "flight-offer",
                        id: flightOffer.id,
                        source: "GDS",
                        instantTicketingRequired: false,
                        nonHomogeneous: false,
                        oneWay: false,
                        lastTicketingDate: new Date().toISOString().split('T')[0],
                        numberOfBookableSeats: 1,
                        itineraries: [
                            {
                                segments: flightOffer.details.outbound.segments.map((segment, index) => ({
                                    id: `${index + 1}`,
                                    departure: {
                                        iataCode: segment.departure.airport,
                                        terminal: segment.departure.terminal,
                                        at: segment.departure.time
                                    },
                                    arrival: {
                                        iataCode: segment.arrival.airport,
                                        terminal: segment.arrival.terminal,
                                        at: segment.arrival.time
                                    },
                                    carrierCode: segment.airline.code,
                                    number: segment.flightNumber,
                                    aircraft: {
                                        code: segment.aircraft.code
                                    },
                                    operating: {
                                        carrierCode: segment.airline.code
                                    },
                                    duration: segment.duration
                                }))
                            }
                        ],
                        price: {
                            currency: flightOffer.details.price.currency,
                            total: String(flightOffer.details.price.amount),
                            base: String(flightOffer.details.price.amount)
                        },
                        pricingOptions: {
                            fareType: ["PUBLISHED"],
                            includedCheckedBagsOnly: false
                        },
                        validatingAirlineCodes: [flightOffer.details.validatingAirline],
                        travelerPricings: [
                            {
                                travelerId: "1",
                                fareOption: "STANDARD",
                                travelerType: "ADULT",
                                price: {
                                    currency: flightOffer.details.price.currency,
                                    total: String(flightOffer.details.price.amount),
                                    base: String(flightOffer.details.price.amount)
                                },
                                fareDetailsBySegment: flightOffer.details.outbound.segments.map((segment, index) => ({
                                    segmentId: `${index + 1}`,
                                    cabin: segment.cabin || "ECONOMY",
                                    class: segment.bookingClass || "M" // Use M class for standard economy
                                }))
                            }
                        ]
                    }]
            };
            logger.debug('[AmadeusService] Transformed flight offer for seat map request', {
                originalId: flightOffer.id,
                transformedData: transformedOffer
            });
            const response = await this.client.shopping.seatmaps.post(JSON.stringify(transformedOffer));
            if (!response?.data?.[0]?.decks?.[0]?.seats?.length) {
                throw new Error('No seat map available for this flight');
            }
            const seatMap = response.data[0];
            const deck = seatMap.decks[0];
            // Debug log the raw response to see what amenities we're getting
            logger.debug('[AmadeusService] Raw seat map response', {
                flightId: flightOffer.id,
                hasAmenities: !!seatMap.aircraftCabinAmenities,
                rawAmenities: seatMap.aircraftCabinAmenities,
                availableKeys: Object.keys(seatMap)
            });
            // Try both possible paths for amenities
            const amenities = seatMap.aircraftCabinAmenities || seatMap.amenities;
            // Process available seats
            const availableSeats = deck.seats.filter((seat) => {
                const status = seat.travelerPricing?.[0]?.seatAvailabilityStatus;
                return status !== 'BLOCKED' && status !== 'OCCUPIED';
            });
            // Process seat characteristics and include any seat-specific amenities
            const processedSeats = deck.seats.map((seat) => ({
                number: seat.number,
                cabin: seat.cabin,
                characteristics: seat.characteristicsCodes,
                availability: seat.travelerPricing?.[0]?.seatAvailabilityStatus,
                coordinates: seat.coordinates,
                price: seat.travelerPricing?.[0]?.price,
                amenities: seat.amenities || {} // Include seat-specific amenities if available
            }));
            // Process cabin amenities with more detailed logging
            const processedAmenities = amenities ? {
                seat: amenities.seat && {
                    legSpace: amenities.seat.legSpace,
                    spaceUnit: amenities.seat.spaceUnit,
                    tilt: amenities.seat.tilt,
                    images: amenities.seat.medias?.filter((media) => media.mediaType === 'image')
                        .map((media) => ({
                        title: media.title,
                        url: media.href,
                        description: media.description?.text
                    }))
                },
                power: amenities.power && {
                    isChargeable: amenities.power.isChargeable,
                    powerType: amenities.power.powerType,
                    usbType: amenities.power.usbType
                },
                wifi: amenities.wifi && {
                    isChargeable: amenities.wifi.isChargeable,
                    coverage: amenities.wifi.wifiCoverage
                },
                food: amenities.food && {
                    isChargeable: amenities.food.isChargeable,
                    type: amenities.food.foodType
                },
                beverage: amenities.beverage && {
                    isChargeable: amenities.beverage.isChargeable,
                    type: amenities.beverage.beverageType
                },
                entertainment: amenities.entertainment && {
                    type: amenities.entertainment.entertainmentType
                }
            } : null;
            // Log processed amenities for debugging
            logger.debug('[AmadeusService] Processed amenities', {
                flightId: flightOffer.id,
                processedAmenities,
                rawAmenitiesKeys: amenities ? Object.keys(amenities) : []
            });
            logger.info('[AmadeusService] Processed seat map response', {
                flightId: flightOffer.id,
                totalSeats: deck.seats.length,
                availableSeats: availableSeats.length,
                hasAmenities: !!amenities,
                amenityTypes: processedAmenities ? Object.keys(processedAmenities) : []
            });
            // Return both deck and amenities information
            return {
                flightId: flightOffer.id,
                aircraft: {
                    code: seatMap.aircraft?.code,
                    type: seatMap.aircraft?.type
                },
                deck: {
                    seats: processedSeats,
                    totalSeats: deck.seats.length,
                    availableSeats: availableSeats.length,
                    layout: deck.layout
                },
                amenities: processedAmenities,
                cabinAmenities: seatMap.aircraftCabinAmenities, // Include raw amenities as well for debugging
                departure: seatMap.departure,
                arrival: seatMap.arrival
            };
        }
        catch (error) {
            const amadeusError = error;
            logger.error('[AmadeusService] Error getting seat map', {
                error: {
                    message: amadeusError.message,
                    code: amadeusError.code,
                    statusCode: amadeusError.response?.statusCode,
                    details: amadeusError.response?.result?.errors?.[0]
                },
                flightOffer: {
                    id: flightOffer.id,
                    segments: flightOffer.itineraries?.[0]?.segments?.length
                }
            });
            if (amadeusError.response?.statusCode === 400) {
                const apiError = amadeusError.response?.result?.errors?.[0];
                throw new Error(apiError?.detail || apiError?.title || 'Invalid request format');
            }
            if (amadeusError.response?.statusCode === 401) {
                throw new Error('Authentication failed - please check your Amadeus API credentials');
            }
            if (amadeusError.response?.statusCode === 404) {
                throw new Error('Seat map not available for this flight');
            }
            throw new Error(amadeusError.description || amadeusError.message || 'Failed to retrieve seat map');
        }
    }
    async searchFlights(params) {
        if (!this.initialized) {
            this.initializeClient();
        }
        try {
            logger.info('[AmadeusService] Searching flights', params);
            const searchParams = {
                originLocationCode: params.origin,
                destinationLocationCode: params.destination,
                departureDate: params.departureDate,
                returnDate: params.returnDate,
                adults: params.adults || 1,
                travelClass: params.travelClass || 'ECONOMY',
                currencyCode: 'USD',
                max: 50
            };
            const response = await this.client.shopping.flightOffersSearch.get(searchParams);
            if (!response?.data) {
                throw new Error('No flights found');
            }
            logger.info('[AmadeusService] Found flights', {
                count: response.data.length,
                origin: params.origin,
                destination: params.destination
            });
            return response.data;
        }
        catch (error) {
            const amadeusError = error;
            logger.error('[AmadeusService] Error searching flights', {
                error: {
                    message: amadeusError.message,
                    code: amadeusError.code,
                    statusCode: amadeusError.response?.statusCode,
                    details: amadeusError.response?.result?.errors?.[0]
                },
                params
            });
            if (amadeusError.response?.statusCode === 400) {
                const apiError = amadeusError.response?.result?.errors?.[0];
                throw new Error(apiError?.detail || apiError?.title || 'Invalid search parameters');
            }
            if (amadeusError.response?.statusCode === 401) {
                throw new Error('Authentication failed - please check your Amadeus API credentials');
            }
            throw new Error(amadeusError.description || amadeusError.message || 'Failed to search flights');
        }
    }
}
