interface Restaurant {
    name: string;
    branch?: string;
    address: string;
    cuisine: string;
    priceRange: '$' | '$$' | '$$$' | '$$$$';
    openingHours: string;
    popularDishes: string[];
    specialties: string[];
    contact: {
        phone?: string;
        email?: string;
        website?: string;
    };
    booking?: {
        platform: string;
        url: string;
        requiresReservation: boolean;
    };
    rating?: number;
    reviews?: number;
    description?: string;
    images?: string[];
    coordinates?: {
        latitude: number;
        longitude: number;
    };
}
interface Venue {
    name: string;
    type: 'restaurant' | 'cafe' | 'bar' | 'street_food' | 'market';
    cuisine: string;
    priceRange: '$' | '$$' | '$$$' | '$$$$';
    address: string;
    neighborhood: string;
    mustTry: string[];
    openingHours: string;
    tripAdvisorUrl: string;
    rating: {
        tripAdvisor: string;
        numberOfReviews: number;
    };
    reservationRequired: boolean;
    reservationUrl?: string;
    tips: string[];
}
interface Meal {
    type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    timeSlot: string;
    venue: Venue;
}
interface EveningEntertainment {
    name: string;
    type: 'bar' | 'lounge' | 'beer_garden';
    specialty: string;
    tripAdvisorUrl: string;
    bestTimeToVisit: string;
}
interface DayPlan {
    day: number;
    meals: Meal[];
    eveningEntertainment?: EveningEntertainment;
}
interface FoodItinerary {
    dayPlans: DayPlan[];
    localTips: string[];
}
interface RestaurantSearchParams {
    city: string;
    cuisine?: string;
    priceRange?: string;
    mealType?: 'breakfast' | 'lunch' | 'dinner';
    numberOfPeople?: number;
    date?: string;
    time?: string;
}
interface FoodItineraryParams {
    city: string;
    days: number;
    cuisine?: string;
    priceRange?: string[];
    includeStreetFood?: boolean;
    dietaryRestrictions?: string[];
}
interface DeepSeekResponse {
    restaurants: Restaurant[];
    error?: string;
}
export declare class DeepSeekService {
    private apiKey;
    private baseUrl;
    constructor();
    searchRestaurants(params: RestaurantSearchParams): Promise<DeepSeekResponse>;
    private constructSearchQuery;
    getRestaurantDetails(restaurantName: string, city: string): Promise<Restaurant | null>;
    createFoodItinerary(params: FoodItineraryParams): Promise<FoodItinerary | {
        error: string;
    }>;
    private validateFoodItinerary;
    private constructFoodItineraryQuery;
}
export declare const deepseekClient: DeepSeekService;
export {};
