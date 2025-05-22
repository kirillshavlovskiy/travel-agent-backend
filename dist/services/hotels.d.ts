export interface HotelSearchParams {
    cityCode: string;
    checkInDate: string;
    checkOutDate: string;
    adults?: number;
    roomQuantity?: number;
    radius?: number;
    ratings?: string;
    currency?: string;
    amenities?: string[];
}
interface AmadeusHotel {
    chainCode: string;
    iataCode: string;
    dupeId: number;
    name: string;
    hotelId: string;
    geoCode: {
        latitude: number;
        longitude: number;
    };
    address: {
        countryCode: string;
    };
    distance: {
        value: number;
        unit: string;
    };
    amenities: string[];
    lastUpdate: string;
}
interface AmadeusHotelOffer {
    type?: string;
    available?: boolean;
    hotel: AmadeusHotel & {
        [key: string]: any;
    };
    offers: Array<{
        id: string;
        checkInDate: string;
        checkOutDate: string;
        rateCode: string;
        rateFamilyEstimated: {
            code: string;
            type: string;
        };
        room: {
            type: string;
            typeEstimated: {
                category: string;
                beds: number;
                bedType: string;
            };
        };
        guests: {
            adults: number;
        };
        price: {
            currency: string;
            total: string;
            variations: {
                average: {
                    total: string;
                };
            };
        };
        policies: {
            cancellation: {
                description: {
                    text: string;
                };
            };
        };
    }>;
    self: string;
}
export interface MultiDestinationHotelSearchParams {
    destinations: {
        cityCode: string;
        arrivalDate: string;
        departureDate: string;
    }[];
    adults?: number;
    roomQuantity?: number;
    radius?: number;
    ratings?: string;
    currency?: string;
    amenities?: string[];
}
export interface HotelSearchResult {
    cityCode: string;
    checkInDate: string;
    checkOutDate: string;
    hotels: AmadeusHotelOffer[];
}
export declare class HotelService {
    private amadeus;
    private readonly MIN_ADVANCE_DAYS;
    private readonly MAX_ADVANCE_DAYS;
    constructor();
    private validateDates;
    searchHotels(params: HotelSearchParams): Promise<AmadeusHotelOffer[]>;
    searchHotelsMultiDestination(params: MultiDestinationHotelSearchParams): Promise<HotelSearchResult[]>;
    confirmHotelOffer(hotelId: string, offerId: string, params: {
        checkInDate: string;
        checkOutDate: string;
        adults: number;
        roomQuantity: number;
    }): Promise<{
        success: boolean;
        data: any;
    }>;
    bookHotel(offerId: string, guestInfo: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        payment: {
            cardNumber: string;
            expiryDate: string;
            vendorCode: string;
        };
    }): Promise<{
        success: boolean;
        data: any;
    }>;
    private adjustCheckoutDate;
    createSearchPlan(destinations: Array<{
        cityCode: string;
        arrivalDate: string;
        arrivalTime?: string;
        departureDate: string;
        departureTime?: string;
    }>): Array<{
        cityCode: string;
        checkInDate: string;
        checkOutDate: string;
    }>;
}
export {};
