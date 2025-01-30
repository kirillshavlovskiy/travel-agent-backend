import Amadeus from 'amadeus';
import { logger, logHotelProcessing } from '../utils/logger';
export class HotelService {
    constructor() {
        this.MIN_ADVANCE_DAYS = 1;
        this.MAX_ADVANCE_DAYS = 365;
        const clientId = process.env.AMADEUS_CLIENT_ID;
        const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
        logger.info('Initializing Amadeus client for hotel service', {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret
        });
        if (!clientId || !clientSecret) {
            const error = new Error('Missing Amadeus API credentials');
            logger.error('Failed to initialize Amadeus client for hotel service', { error });
            throw error;
        }
        try {
            this.amadeus = new Amadeus({
                clientId,
                clientSecret,
                logLevel: 'debug'
            });
            logger.info('Amadeus client initialized successfully for hotel service');
        }
        catch (error) {
            logger.error('Failed to initialize Amadeus client for hotel service', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    validateDates(checkInDate, checkOutDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkIn = new Date(checkInDate);
        checkIn.setHours(0, 0, 0, 0);
        const checkOut = new Date(checkOutDate);
        checkOut.setHours(0, 0, 0, 0);
        // Log validation details
        logger.info('Validating dates', {
            checkIn: checkIn.toISOString(),
            checkOut: checkOut.toISOString(),
            today: today.toISOString()
        });
        // Compare dates without time
        const checkInTime = checkIn.getTime();
        const todayTime = today.getTime();
        const checkOutTime = checkOut.getTime();
        if (checkInTime < todayTime) {
            logger.warn('Check-in date is in the past', {
                checkIn: checkIn.toISOString(),
                today: today.toISOString()
            });
            return false;
        }
        if (checkOutTime <= checkInTime) {
            logger.warn('Check-out date must be after check-in date', {
                checkIn: checkIn.toISOString(),
                checkOut: checkOut.toISOString()
            });
            return false;
        }
        return true;
    }
    async searchHotels(params) {
        try {
            logger.info('Starting hotel search', { params });
            // First, get hotels in the city
            const hotelsResponse = await this.amadeus.client.get('/v1/reference-data/locations/hotels/by-city', {
                cityCode: params.cityCode,
                radius: params.radius || 50,
                radiusUnit: 'KM',
                hotelSource: 'ALL'
            });
            const hotels = JSON.parse(hotelsResponse.body);
            logHotelProcessing.searchSummary({
                totalHotelsFound: hotels.data?.length || 0,
                availableHotels: 0, // Will be updated after getting offers
                destinations: [params.cityCode],
                dateRange: `${params.checkInDate} to ${params.checkOutDate}`
            });
            if (!hotels.data || hotels.data.length === 0) {
                logger.info('No hotels found in city', { cityCode: params.cityCode });
                return [];
            }
            const hotelOffers = [];
            const batchSize = 25;
            const maxHotels = 100;
            const totalBatches = Math.ceil(Math.min(hotels.data.length, maxHotels) / batchSize);
            logger.info('Starting hotel offers search', {
                totalHotels: Math.min(hotels.data.length, maxHotels),
                batchSize,
                totalBatches
            });
            for (let i = 0; i < Math.min(hotels.data.length, maxHotels); i += batchSize) {
                const batch = hotels.data.slice(i, i + batchSize);
                const hotelIds = batch.map((hotel) => hotel.hotelId);
                const batchNumber = Math.floor(i / batchSize) + 1;
                logHotelProcessing.batchStart(batchNumber, hotelIds);
                try {
                    const offerResponse = await this.amadeus.client.get('/v3/shopping/hotel-offers', {
                        hotelIds: hotelIds.join(','),
                        adults: params.adults?.toString() || '1',
                        checkInDate: params.checkInDate,
                        checkOutDate: params.checkOutDate,
                        roomQuantity: params.roomQuantity?.toString() || '1',
                        currency: params.currency || 'USD',
                        view: 'FULL',
                        bestRateOnly: false,
                        includeClosed: true,
                        paymentPolicy: 'NONE'
                    });
                    const offers = JSON.parse(offerResponse.body);
                    if (offers.warnings) {
                        offers.warnings.forEach((warning) => {
                            logger.warn('Hotel offer warning:', {
                                ...warning,
                                batch: batchNumber,
                                affectedHotels: warning.source?.parameter
                            });
                        });
                    }
                    if (offers.data) {
                        offers.data.forEach((offer) => {
                            if (offer.available && offer.offers?.length > 0) {
                                logHotelProcessing.hotelFound({
                                    id: offer.hotel.hotelId,
                                    name: offer.hotel.name,
                                    offers: offer.offers
                                });
                                const hotelData = hotels.data.find((h) => h.hotelId === offer.hotel.hotelId);
                                if (hotelData) {
                                    hotelOffers.push({
                                        ...offer,
                                        hotel: {
                                            ...offer.hotel,
                                            ...hotelData
                                        }
                                    });
                                }
                                else {
                                    hotelOffers.push(offer);
                                }
                            }
                        });
                    }
                }
                catch (error) {
                    logHotelProcessing.batchError(batchNumber, error);
                    logger.error('Error getting hotel offers for batch:', {
                        error: error instanceof Error ? error.message : 'Unknown error',
                        stack: error instanceof Error ? error.stack : undefined,
                        batch: batchNumber,
                        hotelIds: hotelIds.join(','),
                        response: error?.response?.body
                    });
                    continue;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            // Update search summary with available hotels count
            logHotelProcessing.searchSummary({
                totalHotelsFound: hotels.data.length,
                availableHotels: hotelOffers.length,
                destinations: [params.cityCode],
                dateRange: `${params.checkInDate} to ${params.checkOutDate}`
            });
            return hotelOffers;
        }
        catch (error) {
            logger.error('Error searching hotels:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                params,
                response: error?.response?.body
            });
            throw error;
        }
    }
    async searchHotelsMultiDestination(params) {
        logger.info('Starting multi-destination hotel search', {
            destinations: params.destinations.map(d => ({
                cityCode: d.cityCode,
                dates: `${d.arrivalDate} to ${d.departureDate}`
            })),
            adults: params.adults,
            roomQuantity: params.roomQuantity
        });
        const results = [];
        for (const d of params.destinations) {
            try {
                // Validate dates for this destination
                const datesValid = this.validateDates(d.arrivalDate, d.departureDate);
                if (!datesValid) {
                    logger.error('Invalid dates for destination', {
                        cityCode: d.cityCode,
                        arrivalDate: d.arrivalDate,
                        departureDate: d.departureDate
                    });
                    continue;
                }
                const hotels = await this.searchHotels({
                    cityCode: d.cityCode,
                    checkInDate: d.arrivalDate,
                    checkOutDate: d.departureDate,
                    adults: params.adults,
                    roomQuantity: params.roomQuantity,
                    radius: params.radius,
                    ratings: params.ratings,
                    currency: params.currency,
                    amenities: params.amenities
                });
                if (hotels.length > 0) {
                    results.push({
                        cityCode: d.cityCode,
                        checkInDate: d.arrivalDate,
                        checkOutDate: d.departureDate,
                        hotels
                    });
                }
            }
            catch (error) {
                logger.error('Error searching hotels for destination:', {
                    cityCode: d.cityCode,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
        }
        logger.info('Multi-destination search completed', {
            totalDestinations: params.destinations.length,
            destinationsWithHotels: results.length,
            totalHotelsFound: results.reduce((sum, result) => sum + result.hotels.length, 0),
            summary: results.map(result => ({
                cityCode: result.cityCode,
                hotelCount: result.hotels.length
            }))
        });
        return results;
    }
    async confirmHotelOffer(hotelId, offerId, params) {
        try {
            logger.info('Confirming hotel offer:', {
                hotelId,
                offerId,
                params
            });
            // First, get fresh availability for the hotel
            const response = await this.amadeus.client.get('/v3/shopping/hotel-offers/by-hotel', {
                hotelId,
                checkInDate: params.checkInDate,
                checkOutDate: params.checkOutDate,
                adults: params.adults.toString(),
                roomQuantity: params.roomQuantity.toString()
            });
            const result = JSON.parse(response.body);
            if (!result.data?.offers) {
                logger.error('No offers available for hotel:', {
                    hotelId,
                    response: result
                });
                throw new Error('No offers available for this hotel');
            }
            // Find the matching offer
            const matchingOffer = result.data.offers.find((offer) => offer.id === offerId);
            if (!matchingOffer) {
                logger.error('Offer not found in fresh availability:', {
                    hotelId,
                    offerId,
                    availableOffers: result.data.offers.map((o) => o.id)
                });
                throw new Error('This offer is no longer available');
            }
            // Now get the specific offer details
            const offerResponse = await this.amadeus.client.get(`/v3/shopping/hotel-offers/${offerId}`);
            const offerResult = JSON.parse(offerResponse.body);
            logger.info('Offer confirmation successful:', {
                hotelId,
                offerId,
                offer: offerResult.data
            });
            return {
                success: true,
                data: offerResult.data
            };
        }
        catch (error) {
            logger.error('Error confirming hotel offer:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                hotelId,
                offerId
            });
            throw error;
        }
    }
    async bookHotel(offerId, guestInfo) {
        try {
            logger.info('Creating hotel booking:', { offerId });
            const response = await this.amadeus.client.post('/v2/booking/hotel-orders', {
                data: {
                    type: 'hotel-order',
                    guests: [
                        {
                            tid: 1,
                            title: 'MR',
                            firstName: guestInfo.firstName,
                            lastName: guestInfo.lastName,
                            phone: guestInfo.phone,
                            email: guestInfo.email
                        }
                    ],
                    travelAgent: {
                        contact: {
                            email: guestInfo.email
                        }
                    },
                    roomAssociations: [
                        {
                            guestReferences: [
                                {
                                    guestReference: '1'
                                }
                            ],
                            hotelOfferId: offerId
                        }
                    ],
                    payment: {
                        method: 'CREDIT_CARD',
                        paymentCard: {
                            paymentCardInfo: {
                                vendorCode: guestInfo.payment.vendorCode,
                                cardNumber: guestInfo.payment.cardNumber,
                                expiryDate: guestInfo.payment.expiryDate
                            }
                        }
                    }
                }
            });
            const result = JSON.parse(response.body);
            logger.info('Hotel booking successful:', {
                offerId,
                bookingId: result.data.id
            });
            return {
                success: true,
                data: result.data
            };
        }
        catch (error) {
            logger.error('Error booking hotel:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                offerId
            });
            throw error;
        }
    }
    adjustCheckoutDate(date, time) {
        if (!time)
            return date;
        const [hours, minutes] = time.split(':').map(Number);
        const departureDate = new Date(date);
        if (hours < 3) {
            departureDate.setDate(departureDate.getDate() - 1);
        }
        return departureDate.toISOString().split('T')[0];
    }
    createSearchPlan(destinations) {
        return destinations.map((destination) => {
            const checkInDate = destination.arrivalDate;
            const checkOutDate = this.adjustCheckoutDate(destination.departureDate, destination.departureTime);
            return {
                cityCode: destination.cityCode,
                checkInDate,
                checkOutDate
            };
        });
    }
}
