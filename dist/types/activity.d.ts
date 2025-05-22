export interface Activity {
    id: string;
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
    date?: string;
    startTime: string;
    selected: boolean;
    rating: number;
    numberOfReviews: number;
    bookingDetails: {
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
    availability: {
        isAvailable: boolean;
        availableTimeSlots: string[];
        exactStartTimes: string[];
        timesByCategory: Record<string, string[]>;
        realTimeVerification: {
            verified: boolean;
            exactStartTimes: string[];
            lastChecked: string;
            pricing?: {
                fromPrice: number;
                currency: string;
            };
            reason?: string;
        };
        operatingHours?: string;
        bestTimeToVisit?: string;
        nextAvailableDate?: string;
        tripPeriodAvailability: {
            availableDates: string[];
            availabilityByDate: Record<string, string[]>;
            operatingDays: string[];
            operatingHours: Record<string, {
                opensAt: string;
                closesAt: string;
            }[]>;
        };
    };
    enrichmentStatus?: 'success' | 'failed';
    enrichmentDuration?: number;
    highlights?: string[];
    commentary?: string;
    itineraryHighlight?: string;
    keyHighlights?: string[];
    scoringReason?: string;
    preferenceScore?: number;
    matchedPreferences?: string[];
    images?: Array<{
        source: string;
        url: string;
    }>;
    tier?: 'budget' | 'medium' | 'premium';
    locationDetails?: {
        coordinates?: {
            lat: number;
            lng: number;
        };
        neighborhood?: string;
        address?: string;
        accessibility?: string[];
        transportOptions?: {
            walking?: boolean;
            publicTransport?: boolean;
            taxi?: boolean;
            accessibility?: boolean;
        };
    };
}
export interface GenerateActivitiesParams {
    destination: string;
    destinationId: string;
    budget: number;
    startDate?: string;
    endDate?: string;
    preferences?: {
        travelStyle?: string;
        pacePreference?: string;
        interests?: string[];
        accessibility?: string[];
        dietaryRestrictions?: string[];
    };
}
