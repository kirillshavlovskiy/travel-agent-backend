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
            seatmaps: {
                post(body: string): Promise<any>;
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
export interface AmadeusService {
    amadeus: {
        shopping: {
            flightOffersSearch: {
                get(params: {
                    originLocationCode: string;
                    destinationLocationCode: string;
                    departureDate: string;
                    adults: number;
                    travelClass: string;
                    max?: number;
                    currencyCode?: string;
                    nonStop?: boolean;
                }): Promise<{
                    body: {
                        data: AmadeusFlightOffer[];
                        dictionaries?: {
                            carriers?: {
                                [key: string]: string;
                            };
                            aircraft?: {
                                [key: string]: string;
                            };
                        };
                    };
                }>;
            };
            hotelOffers: {
                get(params: HotelSearchParams): Promise<{
                    body: {
                        data: AmadeusHotelOffer[];
                    };
                }>;
            };
        };
        referenceData: {
            locations: {
                get(params: {
                    keyword: string;
                    subType?: string;
                    countryCode?: string;
                    page?: number;
                }): Promise<{
                    body: {
                        data: Array<{
                            name: string;
                            iataCode: string;
                            address: {
                                cityName: string;
                                countryName: string;
                            };
                        }>;
                    };
                }>;
            };
        };
    };
}
export interface AmadeusAmenity {
    description: string;
    isChargeable: boolean;
    amenityType: string;
    amenityProvider: {
        name: string;
    };
}
export interface AmadeusFareDetail {
    segmentId: string;
    cabin: string;
    fareBasis: string;
    brandedFare: string;
    class: string;
    includedCheckedBags: {
        quantity: number;
    };
    includedCabinBags?: {
        quantity: number;
    };
    amenities?: Array<{
        description: string;
        isChargeable: boolean;
        amenityType: string;
        amenityProvider: {
            name: string;
        };
    }>;
}
export interface AmadeusFlightOffer {
    type: string;
    id: string;
    source: string;
    instantTicketingRequired: boolean;
    nonHomogeneous: boolean;
    oneWay: boolean;
    lastTicketingDate: string;
    numberOfBookableSeats: number;
    itineraries: AmadeusItinerary[];
    price: {
        currency: string;
        total: string;
        base: string;
        fees: Array<{
            amount: string;
            type: string;
        }>;
        grandTotal: string;
        billingCurrency?: string;
    };
    pricingOptions: {
        fareType: string[];
        includedCheckedBagsOnly: boolean;
    };
    validatingAirlineCodes: string[];
    travelerPricings: Array<{
        travelerId: string;
        fareOption: string;
        travelerType: string;
        price: {
            currency: string;
            total: string;
            base: string;
        };
        fareDetailsBySegment: Array<{
            segmentId: string;
            cabin: string;
            fareBasis: string;
            brandedFare: string;
            class: string;
            includedCheckedBags: {
                quantity: number;
            };
        }>;
    }>;
    dictionaries?: {
        carriers?: {
            [key: string]: string;
        };
        aircraft?: {
            [key: string]: string;
        };
    };
}
export interface AmadeusSegment {
    departure: {
        iataCode: string;
        terminal?: string;
        at: string;
    };
    arrival: {
        iataCode: string;
        terminal?: string;
        at: string;
    };
    carrierCode: string;
    number: string;
    aircraft: {
        code: string;
    };
    operating: {
        carrierCode: string;
    };
    duration: string;
    id: string;
    numberOfStops: number;
    blacklistedInEU: boolean;
    cabin?: string;
}
export interface AmadeusItinerary {
    duration: string;
    segments: AmadeusSegment[];
}
export interface AmadeusFare {
    segmentId: string;
}
export interface HotelSearchParams {
    cityCode: string;
    checkInDate: string;
    checkOutDate: string;
    roomQuantity?: number;
    adults?: number;
    radius?: number;
    radiusUnit?: string;
    hotelName?: string;
    priceRange?: string;
    currency?: string;
    ratings?: string[];
    amenities?: string[];
}
export interface AmadeusHotelOffer {
    hotelId: string;
    name: string;
    rating?: string;
    cityName?: string;
    description?: string;
    offers?: Array<{
        id: string;
        checkInDate: string;
        checkOutDate: string;
        roomQuantity: number;
        price: {
            currency: string;
            total: string;
            variations?: {
                average?: {
                    base: string;
                };
                changes?: Array<{
                    startDate: string;
                    endDate: string;
                    base: string;
                }>;
            };
        };
        policies?: {
            cancellation?: {
                description?: string;
            };
        };
    }>;
    geoCode?: {
        latitude: number;
        longitude: number;
    };
    media?: string[];
}
export interface TransformedHotelOffer {
    name: string;
    location: string;
    price: {
        currency: string;
        total: number;
        perNight: number;
        amount: number;
    };
    tier: string;
    type: string;
    amenities: string;
    rating: number;
    reviewScore: number;
    reviewCount: number;
    images: string[];
    referenceUrl: string;
    coordinates: {
        latitude: number;
        longitude: number;
    };
    features: string[];
    policies: {
        checkIn: string;
        checkOut: string;
        cancellation: string;
    };
}
export interface Amadeus {
    shopping: {
        flightOffersSearch: {
            get(params: {
                originLocationCode: string;
                destinationLocationCode: string;
                departureDate: string;
                adults: number;
                travelClass: string;
                max?: number;
                currencyCode?: string;
                nonStop?: boolean;
            }): Promise<{
                body: {
                    data: AmadeusFlightOffer[];
                    dictionaries?: {
                        carriers?: {
                            [key: string]: string;
                        };
                        aircraft?: {
                            [key: string]: string;
                        };
                    };
                };
            }>;
        };
        hotelOffers: {
            get(params: HotelSearchParams): Promise<{
                body: {
                    data: AmadeusHotelOffer[];
                };
            }>;
        };
    };
    referenceData: {
        locations: {
            get(params: {
                keyword: string;
                subType?: string;
                countryCode?: string;
                page?: number;
            }): Promise<{
                body: {
                    data: Array<{
                        name: string;
                        iataCode: string;
                        address: {
                            cityName: string;
                            countryName: string;
                        };
                    }>;
                };
            }>;
        };
    };
}
export interface SeatMapResponse {
    segments: Array<{
        id: string;
        cabin: string;
        class: string;
        deck: string;
        seats: Array<{
            number: string;
            characteristics: string[];
            travelerPricing?: {
                price: {
                    total: string;
                };
            };
            coordinates?: {
                x: number;
                y: number;
            };
        }>;
        facilities?: Array<{
            code: string;
            description: string;
        }>;
    }>;
}
