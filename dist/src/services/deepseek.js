import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger.js';
export class DeepSeekService {
    constructor() {
        this.apiKey = process.env.DEEPSEEK_API_KEY || '';
        this.baseUrl = 'https://api.deepseek.com/chat/completions';
    }
    async searchRestaurants(params) {
        try {
            if (!this.apiKey) {
                throw new Error('DeepSeek API key is not configured');
            }
            const query = this.constructSearchQuery(params);
            logger.info('[DeepSeek] Searching restaurants with params:', params);
            const response = await axios.post(this.baseUrl, {
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `You are a restaurant recommendation expert. Search the internet to find real, currently operating restaurants.

CRITICAL RULES:
1. Only recommend restaurants that you can verify are currently operating
2. Include exact details: name, cuisine, price range, address, opening hours
3. Verify all information is current and accurate
4. Return response in a structured JSON format
5. Include direct links to restaurant websites or booking platforms if available

Return ONLY a valid JSON object without any explanatory text, following this structure:
{
  "restaurants": [
    {
      "name": "Full restaurant name",
      "branch": "Location/branch name if applicable",
      "address": "Complete street address",
      "cuisine": "Type of cuisine",
      "priceRange": "$" to "$$$$",
      "openingHours": "Detailed opening hours",
      "popularDishes": ["dish1", "dish2", "dish3"],
      "specialties": ["specialty1", "specialty2"],
      "contact": {
        "phone": "Contact number",
        "email": "Email if available",
        "website": "Restaurant website"
      },
      "booking": {
        "platform": "Booking platform name",
        "url": "Direct booking URL",
        "requiresReservation": true/false
      },
      "rating": number (1-5),
      "reviews": number of reviews,
      "description": "Brief description",
      "images": ["image_url1", "image_url2"]
    }
  ]
}`
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ],
                temperature: 0.1,
                max_tokens: 2000,
                stream: false
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            const content = response.data.choices[0].message.content;
            try {
                const parsedContent = JSON.parse(content);
                if (!parsedContent.restaurants || !Array.isArray(parsedContent.restaurants)) {
                    throw new Error('Invalid response format: missing restaurants array');
                }
                return parsedContent;
            }
            catch (parseError) {
                logger.error('[DeepSeek] Failed to parse response:', parseError);
                return {
                    restaurants: [],
                    error: 'Failed to parse restaurant data'
                };
            }
        }
        catch (error) {
            logger.error('[DeepSeek] Error searching restaurants:', error);
            if (error instanceof AxiosError) {
                return {
                    restaurants: [],
                    error: error.response?.data?.error || error.message
                };
            }
            return {
                restaurants: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    constructSearchQuery(params) {
        const { city, cuisine, priceRange, mealType, numberOfPeople, date, time } = params;
        let query = `Find top restaurants in ${city}`;
        if (cuisine) {
            query += ` specializing in ${cuisine} cuisine`;
        }
        if (priceRange) {
            query += ` in the ${priceRange} price range`;
        }
        if (mealType) {
            query += ` for ${mealType}`;
        }
        if (numberOfPeople) {
            query += ` suitable for a group of ${numberOfPeople} people`;
        }
        if (date && time) {
            query += ` with availability on ${date} at ${time}`;
        }
        query += '. Include a mix of traditional and modern establishments.';
        return query;
    }
    async getRestaurantDetails(restaurantName, city) {
        try {
            const response = await this.searchRestaurants({
                city,
                cuisine: undefined,
                priceRange: undefined,
            });
            if (response.error || !response.restaurants.length) {
                return null;
            }
            // Find the specific restaurant
            const restaurant = response.restaurants.find(r => r.name.toLowerCase().includes(restaurantName.toLowerCase()));
            return restaurant || null;
        }
        catch (error) {
            logger.error('[DeepSeek] Error getting restaurant details:', error);
            return null;
        }
    }
    async createFoodItinerary(params) {
        try {
            if (!this.apiKey) {
                throw new Error('DeepSeek API key is not configured');
            }
            const query = this.constructFoodItineraryQuery(params);
            logger.info('[DeepSeek] Creating food itinerary with params:', params);
            const response = await axios.post(this.baseUrl, {
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `You are a local food expert who creates detailed food itineraries. Search the internet to find real, currently operating restaurants, cafes, bars, and street food locations.

CRITICAL RULES:
1. Only recommend places that you can verify are currently operating
2. MUST include TripAdvisor links for each place
3. Organize recommendations by time of day (breakfast, lunch, dinner, snacks)
4. Include mix of dining styles (fine dining, casual, street food)
5. Verify all information is current and accurate
6. Return response in a structured JSON format

Return ONLY a valid JSON object without any explanatory text, following this structure:
{
  "dayPlans": [
    {
      "day": 1,
      "meals": [
        {
          "type": "breakfast" | "lunch" | "dinner" | "snack",
          "timeSlot": "time range (e.g., 8:00-10:00)",
          "venue": {
            "name": "Full venue name",
            "type": "restaurant" | "cafe" | "bar" | "street_food" | "market",
            "cuisine": "Type of cuisine",
            "priceRange": "$" to "$$$$",
            "address": "Complete street address",
            "neighborhood": "Area/district name",
            "mustTry": ["dish1", "dish2"],
            "openingHours": "Detailed hours for this day",
            "tripAdvisorUrl": "REQUIRED: Full TripAdvisor URL",
            "rating": {
              "tripAdvisor": "x.x/5.0",
              "numberOfReviews": number
            },
            "reservationRequired": boolean,
            "reservationUrl": "booking URL if available",
            "tips": ["local tip 1", "local tip 2"]
          }
        }
      ],
      "eveningEntertainment": {
        "name": "Optional evening venue",
        "type": "bar" | "lounge" | "beer_garden",
        "specialty": "What's special about this place",
        "tripAdvisorUrl": "REQUIRED: Full TripAdvisor URL",
        "bestTimeToVisit": "Recommended time slot"
      }
    }
  ],
  "localTips": [
    "General food scene tip 1",
    "General food scene tip 2"
  ]
}`
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000,
                stream: false
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            const content = response.data.choices[0].message.content;
            try {
                const parsedContent = JSON.parse(content);
                if (!this.validateFoodItinerary(parsedContent)) {
                    throw new Error('Invalid food itinerary format');
                }
                return parsedContent;
            }
            catch (parseError) {
                logger.error('[DeepSeek] Failed to parse food itinerary:', parseError);
                return {
                    error: 'Failed to parse food itinerary data'
                };
            }
        }
        catch (error) {
            logger.error('[DeepSeek] Error creating food itinerary:', error);
            return {
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    validateFoodItinerary(data) {
        if (!data.dayPlans || !Array.isArray(data.dayPlans)) {
            return false;
        }
        for (const day of data.dayPlans) {
            if (!day.day || !day.meals || !Array.isArray(day.meals)) {
                return false;
            }
            for (const meal of day.meals) {
                if (!meal.type || !meal.timeSlot || !meal.venue) {
                    return false;
                }
                const venue = meal.venue;
                if (!venue.name || !venue.type || !venue.tripAdvisorUrl) {
                    return false;
                }
            }
            if (day.eveningEntertainment) {
                const entertainment = day.eveningEntertainment;
                if (!entertainment.name || !entertainment.type || !entertainment.tripAdvisorUrl) {
                    return false;
                }
            }
        }
        return Array.isArray(data.localTips);
    }
    constructFoodItineraryQuery(params) {
        const { city, days, cuisine, priceRange, includeStreetFood, dietaryRestrictions } = params;
        let query = `Create a ${days}-day food itinerary for ${city}`;
        if (cuisine) {
            query += ` focusing on ${cuisine}`;
        }
        if (priceRange && priceRange.length > 0) {
            query += ` including options in ${priceRange.join(', ')} price ranges`;
        }
        if (includeStreetFood) {
            query += ` including authentic street food options`;
        }
        if (dietaryRestrictions && dietaryRestrictions.length > 0) {
            query += ` with options suitable for ${dietaryRestrictions.join(', ')} diets`;
        }
        query += '. Include both traditional and modern establishments, and ensure all venues are currently operating with verified TripAdvisor listings.';
        return query;
    }
}
// Create and export a singleton instance
export const deepseekClient = new DeepSeekService();
