import { AmadeusFlightOffer } from '../types/amadeus';
import { FlightService } from './flight';
import { Activity } from '../types/activity';
interface TravelRequest {
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
    travelers: string | number;
    budgetLimit: number;
    flightData?: AmadeusFlightOffer[];
    preferences?: {
        travelStyle?: string;
        pacePreference?: string;
        interests?: string[];
        accessibility?: string[];
        dietaryRestrictions?: string[];
    };
}
interface FlightReference {
    id: string;
    airline: string;
    route: string;
    price: {
        amount: number;
        currency: string;
    };
    outbound: string;
    inbound: string;
    duration: string;
    layovers: number;
    flightNumber: string;
    tier: 'budget' | 'medium' | 'premium';
    referenceUrl: string;
    details: {
        outbound: {
            duration: string;
            segments: {
                departure: {
                    airport: string;
                    terminal: string;
                    time: string;
                };
                arrival: {
                    airport: string;
                    terminal: string;
                    time: string;
                };
                duration: string;
                flightNumber: string;
                aircraft: {
                    code: string;
                };
                airline: {
                    code: string;
                    name: string;
                };
            }[];
        };
        inbound?: {
            duration: string;
            segments: {
                departure: {
                    airport: string;
                    terminal: string;
                    time: string;
                };
                arrival: {
                    airport: string;
                    terminal: string;
                    time: string;
                };
                duration: string;
                flightNumber: string;
                aircraft: {
                    code: string;
                };
                airline: {
                    code: string;
                    name: string;
                };
            }[];
        };
        policies: {
            cancellation: string;
            changes: string;
            refund: string;
            checkedBags: number;
            carryOn: number;
            seatSelection: boolean;
        };
    };
    cabinClass: string;
    bookingClass: string;
    airlineCode: string;
    airportCodes?: string[];
}
interface ActivityReference {
    name: string;
    description: string;
    price: number;
    duration: string;
}
interface TransportReference {
    type: string;
    description: string;
    price: number;
    unit: string;
}
interface FoodReference {
    type: string;
    description: string;
    price: number;
    mealType: string;
}
interface CategoryTier<T> {
    min: number;
    max: number;
    average: number;
    confidence: number;
    source: string;
    references: T[];
}
interface BudgetBreakdown {
    requestDetails: {
        departureLocation: any;
        destinations: any[];
        travelers: number;
        startDate: string;
        endDate: string;
        currency: string;
    };
    flights: {
        budget: CategoryTier<FlightReference>;
        medium: CategoryTier<FlightReference>;
        premium: CategoryTier<FlightReference>;
    };
    activities?: {
        budget: CategoryTier<ActivityReference>;
        medium: CategoryTier<ActivityReference>;
        premium: CategoryTier<ActivityReference>;
    };
    localTransportation?: {
        budget: CategoryTier<TransportReference>;
        medium: CategoryTier<TransportReference>;
        premium: CategoryTier<TransportReference>;
    };
    food?: {
        budget: CategoryTier<FoodReference>;
        medium: CategoryTier<FoodReference>;
        premium: CategoryTier<FoodReference>;
    };
    dailySummaries?: Array<{
        dayNumber: number;
        summary: string;
        activities: Activity[];
    }>;
    dayHighlights?: Array<{
        dayNumber: number;
        highlight: string;
        theme: string;
        mainAttractions: string[];
    }>;
    itineraryMetadata?: {
        totalDays: number;
        destination: string;
        preferences: TravelRequest['preferences'];
    };
    tripSummary?: {
        overview: string;
        highlights: string[];
        dailyPlans: Array<{
            dayNumber: number;
            summary: string;
            selectedActivities: string[];
            alternativeActivities: string[];
            suggestedBreaks: Array<{
                time: string;
                type: string;
            }>;
            logistics: {
                transportation: string;
                timing: string;
                suggestions: string[];
            };
        }>;
    };
    organizationLogic?: {
        overview: string;
        considerations: string[];
        recommendations: string[];
        accessibility: {
            general: string;
            specific: Record<string, string>;
        };
        timing: {
            bestTimes: Record<string, string>;
            avoidTimes: Record<string, string>;
        };
    };
    dailyPlans?: DailyPlan[];
    error?: {
        message: string;
        type: string;
        timestamp: string;
    };
    activities?: {
        budget: CategoryTier<ActivityReference>;
        medium: CategoryTier<ActivityReference>;
        premium: CategoryTier<ActivityReference>;
    };
    enrichedActivities?: Activity[];
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
    timeSlot: string;
    dayNumber: number;
    selected?: boolean;
    dailyPlan?: DailyPlan;
    numberOfReviews?: number;
    preferredTimeOfDay?: string;
    referenceUrl?: string;
    bookingDetails?: {
        provider: string;
        productCode: string;
        referenceUrl: string;
        [key: string]: any;
    };
    availability: Activity['availability'];
}
interface ActivityGenerationParams {
    destination: string;
    dayNumber: number;
    timeOfDay: 'morning' | 'afternoon' | 'evening';
    budget: 'budget' | 'medium' | 'premium';
    category?: string;
    userPreferences?: string;
    existingActivities?: Activity[];
    flightTimes?: {
        arrival?: string;
        departure?: string;
    };
    currency?: string;
}
interface MapLocation {
    name: string;
    coordinates: {
        latitude: number;
        longitude: number;
    };
    address: string;
    type: 'activity' | 'break' | 'transport' | 'landmark';
    category?: string;
    description?: string;
    duration?: number;
    timeSlot?: string;
    order: number;
    locationType?: string;
}
interface Route {
    from: string;
    to: string;
    mode: 'walking' | 'transit' | 'driving';
    duration: number;
    distance: string;
}
interface MapData {
    center: {
        latitude: number;
        longitude: number;
    };
    bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    };
    locations: MapLocation[];
    routes: Route[];
}
interface Break {
    startTime: string;
    endTime: string;
    duration: number;
    suggestion: string;
    location?: string;
}
interface DailyPlan {
    dayNumber: number;
    theme: string;
    mainArea: string;
    commentary: string;
    highlights: string[];
    mapData: MapData;
    breaks: {
        morning?: Break;
        lunch?: Break;
        afternoon?: Break;
        dinner?: Break;
    };
    logistics: {
        transportSuggestions: string[];
        walkingDistances: string[];
        timeEstimates: string[];
    };
}
export declare class VacationBudgetAgent {
    private flightService;
    private startTime;
    private dayThemes;
    constructor(flightService: FlightService);
    private fetchWithRetry;
    private queryPerplexity;
    private generateFlightSearchUrl;
    private transformAmadeusFlight;
    private getDefaultCategoryData;
    handleTravelRequest(request: TravelRequest): Promise<BudgetBreakdown>;
    private determineFlightTier;
    private constructPrompt;
    private constructHotelPrompt;
    private cleanJsonResponse;
    private querySingleActivity;
    private isValidJson;
    private determineActivityTier;
    generateSingleActivity(params: ActivityGenerationParams): Promise<any>;
    private getPriceRangeForTier;
    private getBudgetAmount;
    private groupFlightsByTier;
    private transformActivities;
    private validateAndTransformActivity;
    private getDefaultActivities;
    private normalizeCategory;
    private generateDailyPlan;
    private optimizeSchedule;
    private optimizeDaySchedule;
    private getDayTheme;
    private getMainArea;
    enrichActivity(activity: Activity): Promise<EnrichedActivity>;
    private calculateEndTime;
    private determineTimeSlotByIndex;
    /**
     * Returns the budget distribution percentages based on destination
     * @param destination The destination to get budget distribution for
     * @returns Budget distribution percentages for different categories
     */
    private getBudgetDistribution;
}
export {};
