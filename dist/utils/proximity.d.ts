import { Activity } from '../types/activity';
export declare function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
/**
 * Extracts coordinates from activity or estimates them based on name/description
 */
export declare function getActivityCoordinates(activity: Activity): {
    lat: number;
    lng: number;
};
/**
 * Assigns a neighborhood to each activity
 */
export declare function assignNeighborhood(activity: Activity): string;
/**
 * Builds a distance matrix between all activities
 */
export declare function buildDistanceMatrix(activities: Activity[]): Map<string, Map<string, number>>;
/**
 * Clusters activities by geographic proximity
 */
export declare function clusterActivitiesByProximity(activities: Activity[], days: number, withAccessibilityNeeds?: boolean, includeExtraOptions?: boolean): Activity[][];
/**
 * Creates a proximity-optimized schedule for multiple days, with multiple options per time slot for faster pace
 */
export declare function createProximityBasedSchedule(activities: Activity[], days: number, accessibilityNeeds?: string[], pacePreference?: string): Activity[];
