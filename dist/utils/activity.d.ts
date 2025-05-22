import { Activity } from '../types/activity';
/**
 * Enriches activities with consistent category information
 * This is useful for creating diverse options in fast-paced schedules
 */
export declare function enhanceActivityCategories(activity: Activity): Activity;
/**
 * Enhances activity with rating information if missing
 */
export declare function enhanceActivityRatings(activity: Activity): Activity;
/**
 * Creates selection options for fast-paced travelers
 * This combines activities into option groups for each time slot
 */
export declare function createFastPacedOptions(activities: Activity[], days: number): Activity[];
