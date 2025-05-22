import { Activity as ActivityType } from '../types/activity';
interface Activity extends ActivityType {
}
interface ViatorCoordinates {
    lat: number;
    lng: number;
    description?: string;
}
interface ViatorLocation {
    address?: string;
    meetingPoint?: string;
    coordinates?: ViatorCoordinates;
    description?: string;
}
interface ViatorProduct {
    productCode: string;
    title: string;
    description: string;
    productUrl?: string;
    destinations?: Array<{
        ref: string;
        name: string;
    }>;
    location?: ViatorLocation;
    duration?: {
        fixedDurationInMinutes: number;
    };
    pricing?: {
        summary: {
            fromPrice: number;
            priceType?: string;
            specialOffer?: boolean;
            retailPrice?: number;
        };
        currency: string;
    };
    reviews?: {
        combinedAverageRating: number;
        totalReviews: number;
    };
    bookingInfo?: {
        cancellationPolicy?: string;
        mobileTicketing?: boolean;
        languages?: string[];
        minParticipants?: number;
        maxParticipants?: number;
        operatingDays?: string[];
        operatingHours?: string[];
        seasonality?: string;
    };
    highlights?: string[];
    images?: Array<{
        variants: Array<{
            url: string;
            width?: number;
            height?: number;
        }>;
    }>;
    available?: boolean;
    confirmationType?: string;
    itinerary?: ViatorItinerary;
}
interface ViatorItineraryItem {
    pointOfInterestLocation: {
        location: {
            ref: string;
            name?: string;
            address?: string;
            coordinates?: {
                latitude: number;
                longitude: number;
            };
        };
        attractionId?: number;
    };
    duration: {
        fixedDurationInMinutes?: number;
        variableDurationFromMinutes?: number;
        variableDurationToMinutes?: number;
    };
    passByWithoutStopping: boolean;
    admissionIncluded: 'YES' | 'NO' | 'NOT_APPLICABLE';
    description: string;
}
interface ViatorLocation {
    ref: string;
    name?: string;
    address?: string;
    coordinates?: ViatorCoordinates;
    googleMapsUrl?: string;
}
interface ViatorItinerary {
    itineraryType: 'STANDARD' | 'ACTIVITY' | 'MULTI_DAY_TOUR' | 'HOP_ON_HOP_OFF' | 'UNSTRUCTURED';
    skipTheLine: boolean;
    privateTour: boolean;
    maxTravelersInSharedTour?: number;
    duration: {
        fixedDurationInMinutes?: number;
        variableDurationFromMinutes?: number;
        variableDurationToMinutes?: number;
    };
    unstructuredDescription?: string;
    itineraryItems?: ViatorItineraryItem[];
    days?: ViatorItineraryDay[];
    routes?: ViatorItineraryRoute[];
    pointsOfInterest?: ViatorPointOfInterest[];
    activityInfo?: ViatorActivityInfo;
    foodMenus?: ViatorFoodMenu[];
}
interface ViatorItineraryDay {
    title: string;
    dayNumber: number;
    items: ViatorItineraryItem[];
    accommodations?: Array<{
        description: string;
    }>;
    foodAndDrinks?: Array<{
        course: string;
        dishName: string;
        dishDescription: string;
    }>;
}
interface ViatorItineraryRoute {
    operatingSchedule: string;
    duration: {
        fixedDurationInMinutes: number;
    };
    name: string;
    stops: Array<{
        stopLocation: {
            ref: string;
        };
        description: string;
    }>;
    pointsOfInterest: Array<{
        location: {
            ref: string;
        };
        attractionId?: number;
    }>;
}
interface ViatorAvailabilityResponse {
    available: boolean;
    pricing: {
        fromPrice: number;
        currency: string;
    };
    schedule: {
        openingHours: string[];
        availableTimeSlots: string[];
    };
}
interface ViatorAvailabilitySchedule {
    productCode: string;
    bookableItems: Array<{
        productOptionCode: string;
        seasons: Array<{
            startDate: string;
            endDate?: string;
            pricingRecords: Array<{
                daysOfWeek: string[];
                timedEntries: Array<{
                    startTime: string;
                    unavailableDates: Array<{
                        date: string;
                        reason: string;
                    }>;
                }>;
                pricingDetails: Array<{
                    pricingPackageType: string;
                    minTravelers: number;
                    ageBand: string;
                    price: {
                        original: {
                            recommendedRetailPrice: number;
                            partnerNetPrice: number;
                            bookingFee: number;
                            partnerTotalPrice: number;
                        };
                        special?: {
                            recommendedRetailPrice: number;
                            partnerNetPrice: number;
                            bookingFee: number;
                            partnerTotalPrice: number;
                            offerStartDate: string;
                            offerEndDate: string;
                        };
                    };
                }>;
            }>;
            operatingHours: Array<{
                dayOfWeek: string;
                operatingHours: Array<{
                    opensAt: string;
                    closesAt: string;
                }>;
            }>;
        }>;
    }>;
    currency: string;
    summary: {
        fromPrice: number;
    };
    extractedPricing?: {
        amount: number;
        currency: string;
        partnerNetPrice: number;
        bookingFee: number;
    };
    extractedOperatingHours?: Record<string, Array<{
        opensAt: string;
        closesAt: string;
    }>>;
    extractedUnavailableDates?: Array<{
        date: string;
        reason: string;
    }>;
    extractedDaysOfWeek?: string[];
    extractedTimeSlots?: string[];
}
interface ActivityAvailability {
    isAvailable: boolean;
    verifiedTimeSlot?: "morning" | "afternoon" | "evening";
    availableTimeSlots: ("morning" | "afternoon" | "evening")[];
    exactStartTime?: string;
    exactStartTimes: string[];
    timesByCategory?: Record<"morning" | "afternoon" | "evening", string[]>;
    realTimeVerification: {
        verified: boolean;
        exactStartTimes: string[];
        lastChecked: string;
        reason?: string;
        pricing?: {
            fromPrice: number;
            currency: string;
        };
    };
    operatingHours?: string;
    bestTimeToVisit?: string;
    nextAvailableDate?: string;
    tripPeriodAvailability?: {
        availableDates: string[];
        availabilityByDate: Record<string, string[]>;
        operatingDays: string[];
        operatingHours: Record<string, string[]>;
    };
}
interface Activity {
    id?: string;
    name: string;
    description: string;
    duration: number;
    price: {
        amount: number;
        currency: string;
    };
    category: string;
    location: string;
    timeSlot: 'morning' | 'afternoon' | 'evening';
    dayNumber: number;
    selected?: boolean;
    tier?: 'budget' | 'medium' | 'premium';
    rating?: number;
    numberOfReviews?: number;
    highlights?: string[];
    date?: string;
    startTime?: string;
    bookingDetails?: {
        provider: string;
        productCode: string;
        referenceUrl: string;
        cancellationPolicy?: string;
        instantConfirmation?: boolean;
        mobileTicket?: boolean;
        languages?: string[];
        minParticipants?: number;
        maxParticipants?: number;
        pickupIncluded?: boolean;
        pickupLocation?: string;
        accessibility?: string;
        restrictions?: string[];
    };
    availability?: {
        isAvailable: boolean;
        availableTimeSlots: ('morning' | 'afternoon' | 'evening')[];
        exactStartTimes: string[];
        timesByCategory: {
            morning: string[];
            afternoon: string[];
            evening: string[];
        };
        realTimeVerification: {
            verified: boolean;
            exactStartTimes: string[];
            lastChecked: string;
            reason?: string;
            pricing?: {
                fromPrice: number;
                currency: string;
            };
        };
        operatingHours?: string;
        bestTimeToVisit?: string;
        nextAvailableDate?: string;
        tripPeriodAvailability?: {
            availableDates: string[];
            availabilityByDate: Record<string, string[]>;
            operatingDays: string[];
            operatingHours: Record<string, string[]>;
        };
    };
    locationDetails?: {
        coordinates?: ViatorCoordinates;
        address?: string;
    };
    enrichmentStatus?: 'success' | 'failed';
    enrichmentError?: string;
    enrichmentDuration?: number;
}
interface ViatorOperatingHours {
    dayOfWeek: string;
    operatingHours: Array<{
        opensAt: string;
        closesAt: string;
    }>;
}
interface TimeSlotAvailability {
    isAvailable: boolean;
    operatingHours: ViatorOperatingHours | null;
    validTimeSlots: string[];
}
interface ViatorDestination {
    destinationId: string;
    name: string;
    parentDestination?: {
        name: string;
    };
    iata?: string;
}
interface ViatorItineraryItem {
    type: string;
    description: string;
    duration: {
        fixedDurationInMinutes?: number;
        variableDurationFromMinutes?: number;
        variableDurationToMinutes?: number;
    };
}
interface ViatorItineraryDay {
    dayNumber: number;
    activities: ViatorItineraryItem[];
}
interface ViatorItineraryRoute {
    name: string;
    stops: string[];
}
interface ViatorPointOfInterest {
    name: string;
    location: ViatorLocation;
}
interface ViatorActivityInfo {
    type: string;
    description: string;
    requirements?: string[];
}
interface ViatorFoodMenu {
    type: string;
    items: string[];
}
interface ViatorItinerary {
    itineraryItems: ViatorItineraryItem[];
    days: ViatorItineraryDay[];
    routes: ViatorItineraryRoute[];
    pointsOfInterest: ViatorPointOfInterest[];
    activityInfo: ViatorActivityInfo;
    foodMenus: ViatorFoodMenu[];
}
export declare class ViatorService {
    private apiKey;
    private baseUrl;
    private isInitialized;
    private destinationsCache;
    private lastCacheUpdate;
    private usedProductCodes;
    constructor(apiKey?: string);
    private ensureInitialized;
    getDestinations(): Promise<ViatorDestination[]>;
    private normalizeLocationName;
    getDestinationId(cityName: string): Promise<string>;
    private stringSimilarity;
    searchActivity(query: string, destinationId?: string, startDate?: string, endDate?: string): Promise<ViatorProduct[]>;
    private getTimeSlotCategory;
    private findBestTimeForSlot;
    getAvailabilitySchedule(productCode: string): Promise<ViatorAvailabilitySchedule>;
    getProductDetails(productCode: string): Promise<ViatorProduct>;
    private formatProductResponse;
    private extractLocation;
    private constructBookingUrl;
    private extractAvailability;
    private extractImages;
    private formatLocation;
    private validateAndAdjustTimeSlot;
    private calculateTransportation;
    private calculateDistance;
    private estimateTravelTime;
    private getTransportationOptions;
    private extractProductCodeFromUrl;
    checkRealTimeAvailability(productCode: string, date: string): Promise<ViatorAvailabilityResponse | null>;
    enrichActivityDetails(activity: Activity): Promise<Activity>;
    private determineTier;
    getAvailability(productCode: string, date: string): Promise<TimeSlotAvailability>;
    validateTimeSlot(activity: Activity, date: string): Promise<ActivityAvailability>;
    private determineCategory;
    private adultPricingFinder;
    resetProductCodes(): void;
    /**
     * Determines accessibility features for an activity
     */
    private determineAccessibility;
    /**
     * Extracts restrictions and requirements from product details
     */
    private extractRestrictions;
    /**
     * Filters activities based on accessibility and dietary requirements
     */
    filterActivitiesByRequirements(activities: Activity[], requirements: {
        accessibility?: string[];
        dietaryRestrictions?: string[];
    }): Activity[];
    /**
     * Determines if an activity is likely to be accessible based on type/venue
     */
    private isLikelyAccessible;
}
export declare const viatorClient: ViatorService;
export {};
