import { Activity } from './activity';
export interface DaySchedule {
    dayNumber: number;
    date: string;
    activities: Activity[];
    theme: string;
    mainArea: string;
    commentary: string;
    highlights: string[];
    breaks: {
        morning?: {
            start: string;
            end: string;
        };
        lunch?: {
            start: string;
            end: string;
        };
        afternoon?: {
            start: string;
            end: string;
        };
        dinner?: {
            start: string;
            end: string;
        };
    };
    logistics: {
        transportSuggestions: string[];
        walkingDistances: string[];
        timeEstimates: string[];
    };
    availabilityStats: {
        totalActivities: number;
        availableActivities: number;
        unavailableActivities: number;
        conflictingActivities: number;
    };
}
export interface OptimizationStats {
    totalActivities: number;
    scheduledActivities: number;
    unscheduledActivities: number;
    daysOptimized: number;
}
export interface OptimizedSchedule {
    schedule: DaySchedule[];
    unscheduledActivities: Activity[];
    optimizationStats: OptimizationStats;
}
