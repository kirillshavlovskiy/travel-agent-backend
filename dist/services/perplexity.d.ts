import { Activity } from '../types/activity';
interface PerplexityResponse {
    text?: string;
    images?: string[];
    address?: string;
    description?: string;
    highlights?: string[];
    openingHours?: string;
    rating?: number;
    reviews?: number;
    error?: string;
    commentary?: string;
    itineraryHighlight?: string;
    activities?: Activity[];
    schedule?: Array<{
        dayNumber: number;
        activities: Activity[];
        dayPlanningLogic?: string;
    }>;
    tripOverview?: string;
    activityFitNotes?: string;
}
export interface PerplexityApiResponse {
    schedule?: Array<{
        dayNumber: number;
        activities: Activity[];
        dayPlanningLogic?: string;
    }>;
    activities?: Activity[];
    tripOverview?: string;
    activityFitNotes?: string;
}
export interface GenerateActivitiesParams {
    departureLocation: {
        code: string;
        label: string;
    };
    destinations: Array<{
        code: string;
        label: string;
    }>;
    startDate: string;
    endDate: string;
    travelers: number;
    currency: string;
    budgetLimit: number;
    preferences: {
        travelStyle: string;
        pacePreference: string;
        interests: string[];
        accessibility: string[];
        dietaryRestrictions: string[];
    };
}
export interface DayHighlight {
    dayNumber: number;
    theme: string;
    mainArea: string;
    summary: string;
    activities: Activity[];
}
export interface DailyItinerarySummary {
    dayNumber: number;
    date: string;
    summary: string;
    activities: Activity[];
    highlights: string[];
    mainArea: string;
    theme: string;
}
export declare class PerplexityService {
    private perplexityApiCallCount;
    private readonly apiKey;
    private readonly baseUrl;
    constructor();
    getPerplexityApiCallCount(): number;
    resetPerplexityApiCallCount(): void;
    private getDateForActivity;
    generateActivities(params: GenerateActivitiesParams): Promise<any>;
    private determineTimeSlot;
    private determineCategory;
    chat(query: string, options?: {
        web_search?: boolean;
        temperature?: number;
        max_tokens?: number;
    }): Promise<PerplexityApiResponse>;
    private cleanJsonString;
    private getTimeSlot;
    private estimateDuration;
    private normalizeActivity;
    private parseReviewCount;
    private parseCost;
    getEnrichedDetails(query: string, userPreferences?: {
        interests: string[];
        travelStyle: string;
        pacePreference: string;
        accessibility: string[];
        dietaryRestrictions: string[];
    }, date?: string): Promise<PerplexityResponse>;
    private cleanAndBalanceActivities;
    private getMatchedPreferences;
    private ensurePreferenceReferences;
    private getRelevantPreferences;
    private determineOptimalTimeSlot;
    private generateDayHighlights;
    private getMostFrequentCategory;
    private getDayTheme;
    private getMainArea;
    private getDayHighlightText;
    generateDailyHighlights(activities: Activity[]): Promise<DailyItinerarySummary[]>;
    private findNextAvailableDate;
    enrichActivity(activity: Activity, params: GenerateActivitiesParams, retryCount?: number): Promise<Activity | null>;
    private calculateTimeSlotScore;
    private calculatePreferenceScore;
    private matchesTravelStyle;
    private buildActivityQuery;
    private transformDailyItineraryToActivities;
    private buildEnrichmentQuery;
    private optimizeSchedule;
    private generateAvailabilityConsiderations;
    private determineStartTime;
    private generateAvailabilityNotes;
    private getDefaultStartTime;
    private getTimeSlotCategory;
    private getPreferredTimeSlot;
    private buildScheduleOptimizationQuery;
}
declare const perplexityClient: PerplexityService;
export { perplexityClient };
