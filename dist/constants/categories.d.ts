export interface ActivityCategory {
    name: string;
    keywords: string[];
    preferredTimeOfDay: 'morning' | 'afternoon' | 'evening';
    typicalDuration: number;
}
export declare const ACTIVITY_CATEGORIES: ActivityCategory[];
export declare const CATEGORY_MAP: Record<string, string>;
export declare function normalizeCategory(category: string): string;
export declare function getPreferredTimeSlot(category: string): 'morning' | 'afternoon' | 'evening';
export declare function getTypicalDuration(category: string): number;
export declare function determineCategoryFromDescription(description: string): string;
