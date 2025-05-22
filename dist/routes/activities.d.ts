import { Activity as BaseActivity } from '../types/activity';
declare const activitiesRouter: import("express-serve-static-core").Router;
interface Activity extends BaseActivity {
    id?: string;
    name: string;
    description: string;
    category: string;
    timeSlot: 'morning' | 'afternoon' | 'evening';
    dayNumber: number;
    startTime: string;
    duration: number;
    location: string;
    price: {
        amount: number;
        currency: string;
    };
    selected: boolean;
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
    };
    rating?: number;
    numberOfReviews?: number;
    highlights?: string[];
    date?: string;
    locationDetails?: {
        coordinates?: {
            lat: number;
            lng: number;
        };
        address?: string;
    };
    enrichmentStatus?: 'success' | 'failed';
    enrichmentError?: string;
    enrichmentDuration?: number;
    [key: string]: any;
}
interface Schedule {
    dayNumber: number;
    date: string;
    theme: string;
    mainArea: string;
    commentary: string;
    highlights: string[];
    activities: Activity[];
    breaks: {
        morning: {
            startTime: string;
            endTime: string;
            duration: number;
            suggestion: string;
        };
        lunch: {
            startTime: string;
            endTime: string;
            duration: number;
            suggestion: string;
        };
        afternoon: {
            startTime: string;
            endTime: string;
            duration: number;
            suggestion: string;
        };
        dinner: {
            startTime: string;
            endTime: string;
            duration: number;
            suggestion: string;
        };
    };
    logistics: {
        transportSuggestions: string[];
        walkingDistances: string[];
        timeEstimates: string[];
    };
    availabilityStats: {
        verifiedActivities: number;
        totalActivities: number;
        realTimeAvailabilityRate: string;
    };
}
interface OptimizedSchedule {
    schedule: Schedule[];
    dailyHighlights: Array<{
        dayNumber: number;
        theme: string;
        highlights: string[];
    }>;
    tripOverview: string;
    unscheduledActivities?: Activity[];
    statistics?: {
        totalScheduled: number;
        totalUnscheduled: number;
        scheduledByDay: number[];
    };
}
export declare function optimizeSchedule(activities: Activity[], days: number, destination: string, preferences?: any, startDate?: string): Promise<OptimizedSchedule>;
export declare function determineMainArea(activities: Activity[]): string;
export declare function getDefaultStartTime(timeSlot: string): string;
export declare function generateDayTheme(activities: Activity[], preferences: any): string;
export declare function generateDayCommentary(activities: Activity[], dayNumber: number): string;
export declare function generateDayHighlights(activities: Activity[], preferences: any): string[];
export declare function generateBreakSchedule(activities: Activity[], preferences: any): {
    morning: {
        startTime: string;
        endTime: string;
        duration: number;
        suggestion: string;
    };
    lunch: {
        startTime: string;
        endTime: string;
        duration: number;
        suggestion: string;
    };
    afternoon: {
        startTime: string;
        endTime: string;
        duration: number;
        suggestion: string;
    };
    dinner: {
        startTime: string;
        endTime: string;
        duration: number;
        suggestion: string;
    };
};
export declare function generateLogistics(activities: Activity[], preferences: any): {
    transportSuggestions: string[];
    walkingDistances: string[];
    timeEstimates: string[];
};
export { activitiesRouter };
