import { AmadeusFlightOffer, AmadeusHotelOffer, TransformedHotelOffer } from '../types/amadeus.js';
declare module 'amadeus' {
    class Amadeus {
        constructor(options: {
            clientId: string;
            clientSecret: string;
            hostname?: string;
        });
        shopping: {
            flightOffersSearch: {
                get(params: any): Promise<any>;
                post(body: string): Promise<any>;
                pricing: {
                    post(params: any): Promise<any>;
                };
            };
            hotelOffers: {
                get(params: any): Promise<any>;
            };
        };
        booking: {
            flightOrders: {
                post(body: string): Promise<any>;
            };
        };
        referenceData: {
            locations: {
                get(params: {
                    keyword: string;
                    subType: string;
                    view?: string;
                }): Promise<any>;
            };
        };
    }
}
interface AmadeusHotelSearchParams {
    cityCode: string;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    roomQuantity: number;
    currency?: string;
    radius?: number;
    ratings?: string;
}
interface AmadeusLocation {
    type: string;
    subType: string;
    name: string;
    iataCode: string;
    address: {
        cityName: string;
        countryName: string;
    };
}
interface SeatMapResponse {
    data: any[];
    meta?: any;
}
export declare class AmadeusService {
    private client;
    private lastFlightSearchDictionaries;
    private readonly rateLimits;
    private requestQueue;
    private requestCounts;
    private locationCache;
    private readonly CACHE_TTL;
    constructor();
    searchHotels(params: AmadeusHotelSearchParams): Promise<AmadeusHotelOffer[]>;
    determineHotelType(rating: number): string;
    transformHotelOffer(offer: AmadeusHotelOffer): TransformedHotelOffer;
    getCityCode(destination: string): string;
    getAircraftName(code: string): string;
    getCarrierName(code: string): string;
    getCurrencyName(code: string): string;
    getAirlineInfo(airlineCodes: string | string[]): Promise<any[]>;
    private executeWithRateLimit;
    private processQueue;
    private retryWithBackoff;
    searchFlights(params: {
        segments?: Array<{
            originLocationCode: string;
            destinationLocationCode: string;
            departureDate: string;
        }>;
        originLocationCode?: string;
        destinationLocationCode?: string;
        departureDate?: string;
        returnDate?: string;
        travelClass?: string;
        adults?: number;
        currencyCode?: string;
        max?: number;
        nonStop?: boolean;
    }): Promise<any>;
    confirmFlightPrice(flightOffer: AmadeusFlightOffer): Promise<any>;
    /**
     * Creates a flight booking using the Amadeus Flight Orders API
     * @param flightOffer The flight offer to book
     * @param travelers The travelers information
     * @param contacts Contact information
     * @param remarks Optional remarks
     * @returns The booking information including PNR
     */
    createFlightBooking(params: {
        flightOffer: AmadeusFlightOffer;
        travelers: Array<{
            id: string;
            dateOfBirth: string;
            name: {
                firstName: string;
                lastName: string;
            };
            gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
            contact?: {
                emailAddress?: string;
                phones?: Array<{
                    deviceType: 'MOBILE' | 'LANDLINE';
                    countryCallingCode: string;
                    number: string;
                }>;
            };
            documents?: Array<{
                documentType: 'PASSPORT' | 'IDENTITY_CARD' | 'VISA';
                birthPlace?: string;
                issuanceLocation?: string;
                issuanceDate?: string;
                number: string;
                expiryDate?: string;
                issuanceCountry?: string;
                validityCountry?: string;
                nationality?: string;
                holder?: boolean;
            }>;
        }>;
        contacts?: Array<{
            addresseeName?: {
                firstName: string;
                lastName: string;
            };
            companyName?: string;
            purpose?: string;
            phones?: Array<{
                deviceType: 'MOBILE' | 'LANDLINE';
                countryCallingCode: string;
                number: string;
            }>;
            emailAddress?: string;
            address?: {
                lines?: string[];
                postalCode?: string;
                cityName?: string;
                countryCode?: string;
            };
        }>;
        remarks?: {
            general?: Array<{
                subType: string;
                text: string;
            }>;
        };
        ticketingAgreement?: {
            option: 'DELAY_TO_CANCEL' | 'IMMEDIATE';
            delay?: string;
        };
    }): Promise<{
        id: string;
        associatedRecords?: Array<{
            reference: string;
            creationDate: string;
            originSystemCode: string;
            flightOfferId: string;
        }>;
        success: boolean;
        warnings?: string[];
        errors?: string[];
    }>;
    calculateTotalDuration(segments: any[]): string;
    determineTier(flightOffer: AmadeusFlightOffer): 'budget' | 'medium' | 'premium';
    generateBookingUrl(flightOffer: AmadeusFlightOffer): string;
    private isCacheValid;
    searchLocations(keyword: string): Promise<AmadeusLocation[]>;
    getAirportCityName(airportCode: string): Promise<string | null>;
    getAirportCityNames(airportCodes: string[]): Promise<Record<string, string>>;
    /**
     * Calls the Amadeus SeatMap API with a flight offer object (POST)
     * @param flightOffer The flight offer object (as per Amadeus API)
     * @returns The seat map data
     */
    getSeatMap(flightOffer: any): Promise<SeatMapResponse>;
}
export {};
