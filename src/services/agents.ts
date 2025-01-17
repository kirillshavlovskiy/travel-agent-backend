import { Request, Response } from 'express';
import fetch, { Response as FetchResponse } from 'node-fetch';
import { AmadeusFlightOffer } from '../types/amadeus.js';
import { AmadeusService as FlightService } from '../services/amadeus.js';
import { logger } from '../utils/logger.js';

interface TravelRequest {
  type: string;
  departureLocation: {
    code: string;
    label: string;
    airport?: string;
    outboundDate: string;
    inboundDate: string;
    isRoundTrip?: boolean;
  };
  destinations: Array<{
    code: string;
    label: string;
    airport?: string;
  }>;
  country: string;
  travelers: number;
  currency: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  flightData?: AmadeusFlightOffer[];
  cabinClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  days: number;
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface FlightReference {
  airline: string;
  route: string;
  price: number;
  outbound: string;
  inbound: string;
  duration: string;
  layovers: number;
  flightNumber: string;
  tier: 'budget' | 'medium' | 'premium';
  referenceUrl: string;
}

interface HotelReference {
  name: string;
  location: string;
  price: number;
  type: string;
  amenities: string;
  rating: number;
  reviewScore: number;
  reviewCount: number;
  images: string[];
  referenceUrl: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  features: string[];
  policies: {
    checkIn: string;
    checkOut: string;
    cancellation: string;
  };
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

interface FlightData {
  flights: {
    budget: CategoryTier<FlightReference>;
    medium: CategoryTier<FlightReference>;
    premium: CategoryTier<FlightReference>;
  };
}

interface HotelData {
  hotels: {
    searchDetails: {
      location: string;
      dates: {
        checkIn: string;
        checkOut: string;
      };
      guests: number;
    };
    budget: CategoryTier<HotelReference>;
    medium: CategoryTier<HotelReference>;
    premium: CategoryTier<HotelReference>;
  };
}

interface ActivityData {
  activities: {
    budget: CategoryTier<ActivityReference>;
    medium: CategoryTier<ActivityReference>;
    premium: CategoryTier<ActivityReference>;
  };
}

interface TransportData {
  localTransportation: {
    budget: CategoryTier<TransportReference>;
    medium: CategoryTier<TransportReference>;
    premium: CategoryTier<TransportReference>;
  };
}

interface FoodData {
  food: {
    budget: CategoryTier<FoodReference>;
    medium: CategoryTier<FoodReference>;
    premium: CategoryTier<FoodReference>;
  };
}

interface CategoryData {
  flights?: {
    budget: CategoryTier<FlightReference>;
    medium: CategoryTier<FlightReference>;
    premium: CategoryTier<FlightReference>;
  };
  hotels?: {
    searchDetails: {
      location: string;
      dates: {
        checkIn: string;
        checkOut: string;
      };
      guests: number;
    };
    budget: CategoryTier<HotelReference>;
    medium: CategoryTier<HotelReference>;
    premium: CategoryTier<HotelReference>;
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
}

interface SingleActivityResponse {
  id?: string;
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  location: string;
  exact_address: string;
  opening_hours: string;
  rating: number;
  number_of_reviews: number;
  reference_url?: string;
  key_highlights: string[];
  preferred_time_of_day: string;
  images?: string[];
  timeSlot?: string;
  dayNumber?: number;
  tier?: string;
}

interface GoogleSearchItem {
  link: string;
  image: {
    contextLink: string;
    height: number;
    width: number;
    byteSize: number;
    thumbnailLink: string;
    thumbnailHeight: number;
    thumbnailWidth: number;
  };
}

interface GoogleSearchResponse {
  items?: GoogleSearchItem[];
  searchInformation?: {
    totalResults: string;
  };
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
}

const SYSTEM_MESSAGE = `You are an AI travel budget expert. Your role is to:
1. Provide accurate cost estimates for travel expenses
2. Consider seasonality, location, and number of travelers
3. Always return responses in valid JSON format
4. Include min and max ranges for each price tier
5. Provide brief descriptions explaining the estimates
6. Consider local market conditions and currency
7. Base estimates on real-world data and current market rates`;

export class VacationBudgetAgent {
  private flightService: FlightService;
  private startTime: number = Date.now();

  constructor(flightService: FlightService) {
    this.flightService = flightService;
  }

  private async fetchWithRetry(url: string, options: any, retries = 3): Promise<FetchResponse> {
    let lastError: Error | unknown;
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        return response;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
      }
    }
    throw lastError || new Error('Failed to fetch after retries');
  }

  private async queryPerplexity(prompt: string, category: string): Promise<CategoryData> {
    try {
      logger.info(`[${category.toUpperCase()}] Making Perplexity API request`);

      const response = await this.fetchWithRetry(
        'https://api.perplexity.ai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-sonar-small-128k-online',
            messages: [
              {
                role: 'system',
                content: SYSTEM_MESSAGE
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            options: {
              search: true,
              temperature: 0.1,
              max_tokens: 4000
            }
          })
        },
        3
      );

      if (!response.ok) {
        throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as PerplexityResponse;
      return result.choices[0].message.content as unknown as CategoryData;
    } catch (error) {
      logger.error(`[${category.toUpperCase()}] Perplexity API error:`, error);
      return this.getDefaultCategoryData(category);
    }
  }

  private generateFlightSearchUrl(flight: FlightReference): string {
    try {
      const [from, to] = (flight.route || '').split(' to ').map((s: string) => s.trim());
      if (!from || !to) return '';

      const fromCode = from.match(/\(([A-Z]{3})\)/) ? from.match(/\(([A-Z]{3})\)/)?.[1] : from;
      const toCode = to.match(/\(([A-Z]{3})\)/) ? to.match(/\(([A-Z]{3})\)/)?.[1] : to;
      
      const outDate = new Date(flight.outbound).toISOString().split('T')[0];
      const inDate = new Date(flight.inbound).toISOString().split('T')[0];
      
      return `https://www.kayak.com/flights/${fromCode}-${toCode}/${outDate}/${inDate}`;
    } catch (error) {
      logger.error('[Flight URL] Error generating flight URL:', error);
      return '';
    }
  }

  private transformAmadeusFlight(flight: AmadeusFlightOffer): FlightReference {
    const segments = flight.itineraries[0].segments;
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    const returnSegments = flight.itineraries[1]?.segments || [];
    const returnFirstSegment = returnSegments[0];
    const returnLastSegment = returnSegments[returnSegments.length - 1];

    const route = `${firstSegment.departure.iataCode} to ${lastSegment.arrival.iataCode}`;
    const flightRef: FlightReference = {
      airline: firstSegment.carrierCode,
      route,
      price: parseFloat(flight.price.total),
      outbound: firstSegment.departure.at,
      inbound: returnFirstSegment ? returnFirstSegment.departure.at : '',
      duration: `${flight.itineraries[0].duration}${returnSegments.length ? ` / ${flight.itineraries[1].duration}` : ''}`,
      layovers: segments.length - 1 + returnSegments.length - 1,
      flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
      tier: this.determineFlightTier(flight),
      referenceUrl: this.generateFlightSearchUrl({
        route,
        outbound: firstSegment.departure.at,
        inbound: returnFirstSegment ? returnFirstSegment.departure.at : '',
      } as FlightReference)
    };

    return flightRef;
  }

  private getDefaultCategoryData(category: string): CategoryData {
    const defaultTier = {
      min: 0,
      max: 0,
      average: 0,
      confidence: 0,
      source: 'Default due to API error',
      references: []
    };

    switch (category) {
      case 'flights':
        return {
          flights: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      case 'hotels':
        return {
          hotels: {
            searchDetails: {
              location: '',
              dates: {
                checkIn: '',
                checkOut: ''
              },
              guests: 0
            },
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      default:
        return {
          [category]: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
    }
  }

  async handleTravelRequest(request: TravelRequest): Promise<BudgetBreakdown> {
    this.startTime = Date.now();
    logger.info('Starting budget calculation');
    
    // Initialize arrays to store flight data
    let flightData: AmadeusFlightOffer[] = [];
    let errors: Error[] = [];

    // If we have flight data in the request, use it
    if (request.flightData && request.flightData.length > 0) {
      flightData = request.flightData;
    } else {
      // Try to get flight data with retries
      const cabinClasses = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
      
      // Sequential search with delay between requests
      for (const travelClass of cabinClasses) {
        try {
          const result = await this.flightService.searchFlights({
            originLocationCode: request.departureLocation.code,
            destinationLocationCode: request.destinations[0].code,
            departureDate: request.startDate || '',
            returnDate: request.endDate || '',
            adults: request.travelers,
            travelClass,
            currencyCode: request.currency
          });
          if (result && result.length > 0) {
            flightData.push(...result);
          }
          // Add delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.warn(`Failed to fetch flights for ${travelClass}`, { error });
          errors.push(error as Error);
          // Add longer delay after error
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // Only throw error if we have no flight data at all
    if (flightData.length === 0) {
      logger.error('No flight data available after all attempts', { errors });
      throw new Error('No flight data available');
    }

    // Process the flight data we have
    const groupedFlights = this.groupFlightsByTier(flightData);

    const response: BudgetBreakdown = {
      requestDetails: {
        departureLocation: request.departureLocation,
        destinations: request.destinations,
        travelers: request.travelers,
        startDate: request.startDate || '',
        endDate: request.endDate || '',
        currency: request.currency
      },
      flights: {
        budget: groupedFlights.budget || this.getDefaultCategoryData('flights').flights!.budget,
        medium: groupedFlights.medium || this.getDefaultCategoryData('flights').flights!.medium,
        premium: groupedFlights.premium || this.getDefaultCategoryData('flights').flights!.premium
      }
    };

    // Process other categories with Perplexity (excluding flights)
    const categories = ['localTransportation', 'food', 'activities'];
    console.log(`[TIMING] Processing ${categories.length} categories with Perplexity`);

      const results = await Promise.all(
        categories.map(async (category) => {
          const categoryStart = Date.now();
          console.log(`[TIMING][${category}] Starting category processing`);

        const prompt = this.constructPrompt(category, request);
          console.log(`[TIMING][${category}] Prompt constructed in ${Date.now() - categoryStart}ms`);

          const data = await this.queryPerplexity(prompt, category);
          console.log(`[TIMING][${category}] Perplexity query completed in ${Date.now() - categoryStart}ms`);

          return { category, data };
        })
      );

    // Add Perplexity category data to the response
      results.forEach(({ category, data }) => {
      (response as any)[category] = data[category as keyof CategoryData];
    });

    const totalTime = Date.now() - this.startTime;
      console.log(`[TIMING] Total budget calculation completed in ${totalTime}ms`);
      if (totalTime > 25000) {
        console.warn(`[TIMING] Warning: Budget calculation took longer than 25 seconds`);
      }

      return response;
  }

  private determineFlightTier(flight: AmadeusFlightOffer): 'budget' | 'medium' | 'premium' {
    const cabinClass = flight.travelerPricings[0].fareDetailsBySegment[0].cabin;
    const price = parseFloat(flight.price.total);

    if (cabinClass === 'FIRST' || cabinClass === 'BUSINESS') {
      return 'premium';
    } else if (cabinClass === 'PREMIUM_ECONOMY') {
      return 'medium';
    } else if (price <= 1000) {
      return 'budget';
    } else if (price <= 2000) {
      return 'medium';
    } else {
      return 'premium';
    }
  }

  private constructPrompt(category: string, request: TravelRequest): string {
    const prompt = `Generate a ${request.days}-day activity plan for ${request.destinations[0].label} with a total budget of ${request.budget} ${request.currency}. 
For EACH DAY (Day 1 to ${request.days}), suggest 2-3 activities per time slot (morning/afternoon/evening) across different price ranges:
- Budget activities (under $30 per person)
- Medium-priced activities ($30-$100 per person)
- Premium/exclusive activities (over $100 per person)

Requirements:
1. CRITICAL: Each activity MUST have a "day" field with a number from 1 to ${request.days}
2. Each day MUST have activities from each price tier (budget, medium, premium)
3. Activities MUST be distributed across time slots (morning, afternoon, evening)
4. Include a diverse range of categories (cultural, adventure, entertainment, etc.)
5. Premium activities should be truly exclusive experiences
6. Consider local specialties and unique experiences
7. For Day 1, respect arrival time ${request.startDate}
8. For Day ${request.days}, respect departure time ${request.endDate}

Return a JSON object with this EXACT structure:
{
  "activities": [
    {
      "day": number (1 to ${request.days}),
                  "name": "string",
      "description": "string",
                  "price": number,
      "duration": number,
      "location": "string",
      "address": "string",
      "openingHours": "string",
      "highlights": ["string"],
      "rating": number (1-5),
                  "reviewCount": number,
      "category": "string",
      "preferredTimeOfDay": "morning" | "afternoon" | "evening",
      "referenceUrl": "string (max 100 chars)",
      "images": ["string (max 100 chars)"]
    }
  ]
        }

        IMPORTANT RULES:
1. Use ONLY double quotes for strings and property names
        2. Do NOT use single quotes anywhere
        3. Do NOT include any trailing commas
        4. All prices must be numbers (no currency symbols or commas)
5. Duration must be a number (hours)
6. Rating must be a number between 1 and 5
7. Review count must be a number
8. Day must be a number between 1 and ${request.days}
9. Each day must have activities evenly distributed across morning/afternoon/evening
10. Each day must have a mix of budget/medium/premium activities
11. Return ONLY the JSON object, no additional text
12. Do not wrap the response in markdown code blocks
13. All URLs must be less than 100 characters
14. Use short, direct URLs for referenceUrl and images`;

    return prompt;
  }

  private constructHotelPrompt(request: TravelRequest): string {
    const destination = request.destinations[0].label;
    const checkIn = request.startDate;
    const checkOut = request.endDate;
    const travelers = request.travelers;
    const budget = request.budget;

    let prompt = `Provide detailed hotel recommendations in ${destination} for ${travelers} travelers, checking in on ${checkIn} and checking out on ${checkOut}.`;

    if (budget) {
      prompt += `\nConsider total budget of ${budget} USD when suggesting options.`;
    }

    prompt += `\n\nIMPORTANT RULES:
1. Prioritize hotels with direct booking websites
2. All URLs must be complete and include check-in/out dates when possible
3. All images must be from official hotel sources
4. Prices must reflect actual rates for the specified dates
5. Only include hotels that can be booked online
6. Verify that all links and images are accessible
7. Include major hotel chains when available in each tier`;

    return prompt;
  }

  private cleanJsonResponse(content: string): string {
    logger.debug('Cleaning JSON response');
    
    // Remove any markdown code block markers
    content = content.replace(/```json\n?|\n?```/g, '');
    
    // Clean up any malformed URLs that might break JSON parsing
    // Look for repeated patterns in URLs that indicate they're malformed
    content = content.replace(/(\/[^\/]+)\1{10,}/g, '/malformed-url-removed');
    content = content.replace(/https?:\/\/[^\s"]+(?=\s|"|$)/g, 'https://placeholder.com/image.jpg');
    
    // Find the activities array closing bracket
    const activitiesEndMatch = content.match(/\s*}\s*\]\s*}\s*$/);
    if (!activitiesEndMatch) {
      // If we can't find the end, try to reconstruct it
      if (content.includes('"images": [')) {
        content = content.replace(/\s*"images":\s*\[[^\]]*$/, '"images": []}}]}');
      }
    }

    // Clean up any trailing commas in arrays and objects
    content = content.replace(/,(\s*[}\]])/g, '$1');
    
    // Clean up any leading commas in arrays
    content = content.replace(/\[,\s*/g, '[');
    
    logger.debug('Cleaned JSON response. First activity:', {
      firstActivity: content.substring(0, content.indexOf('"images"'))
    });
    
      return content;
  }

  private async querySingleActivity(prompt: string): Promise<string> {
    try {
      const response = await this.fetchWithRetry(
        'https://api.perplexity.ai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-sonar-small-128k-online',
            messages: [
              {
                role: 'system',
                content: `You are a travel expert who searches real booking websites to find current activities and prices. Always verify information from official sources.

CRITICAL JSON FORMATTING RULES:
1. Return ONLY a valid JSON object
2. Do NOT include any text before or after the JSON
3. Do NOT use markdown formatting or code blocks
4. Use ONLY double quotes for strings and property names
5. Do NOT use single quotes anywhere
6. Do NOT include any comments
7. Do NOT include any trailing commas
8. Ensure all strings are properly escaped
9. Ensure all arrays and objects are properly closed
10. All numbers must be valid JSON numbers (no ranges like "35-40", use average value instead)
11. All dates must be valid ISO strings
12. All URLs must be valid and properly escaped
13. All property names must be double-quoted
14. Do NOT escape quotes in the response
15. For price ranges, use the average value (e.g., for "35-40", use 37.5)`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            options: {
              search: true,
              system_prompt: "You are a travel expert who searches real booking websites to find current activities and prices. Always verify information from official sources.",
              temperature: 0.1,
              max_tokens: 4000
            }
          })
        },
        3
      );

      if (!response.ok) {
        throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as PerplexityResponse;
      
      if (!result.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from Perplexity API');
      }

      return result.choices[0].message.content;
      } catch (error) {
      console.error('[Single Activity] Perplexity API error:', error);
      throw error;
    }
  }

  private determineActivityTier(price: number): 'budget' | 'medium' | 'premium' {
    if (price <= 30) {
      return 'budget';
    } else if (price <= 100) {
      return 'medium';
    } else {
      return 'premium';
    }
  }

  async generateSingleActivity(params: {
    destination: string;
    timeOfDay: string;
    dayNumber: number;
    budget: number;
    currency: string;
    category?: string;
    userPreferences?: any;
    existingActivities?: any[];
    flightTimes?: any;
  }): Promise<SingleActivityResponse> {
    const categoryStr = params.category ? ` in the ${params.category} category` : '';
    const preferencesStr = params.userPreferences ? ` that matches these preferences: ${JSON.stringify(params.userPreferences)}` : '';
    
    const prompt = `Generate a single activity recommendation for ${params.destination} during ${params.timeOfDay} on day ${params.dayNumber}${categoryStr}${preferencesStr} with a budget of ${params.budget} ${params.currency}.

Example response:
{
  "name": "Rooftop Dinner at Le Perchoir Marais",
  "description": "Enjoy a romantic dinner with spectacular views of Paris from this trendy rooftop restaurant. The menu features modern French cuisine with seasonal ingredients.",
  "duration": 2,
  "price": 85,
  "category": "Food & Drink",
  "location": "Le Perchoir Marais",
  "exact_address": "33 Rue de la Verrerie, 75004 Paris, France",
  "opening_hours": "7:00 PM - 11:00 PM",
  "rating": 4.5,
  "number_of_reviews": 2500,
  "reference_url": "https://leperchoir.fr",
  "key_highlights": ["Panoramic views of Paris", "Modern French cuisine", "Romantic atmosphere"],
  "preferred_time_of_day": "Evening"
}

Requirements:
1. Must be a real, bookable activity
2. Must be within budget of ${params.budget} ${params.currency}
3. Must be available during ${params.timeOfDay}
4. Must match the category "${params.category || 'any'}"
5. Must include accurate pricing and location details
6. All prices must be numbers (no ranges)
7. All text must be in English
8. URLs must be complete and valid
9. Ratings must be between 1-5
10. Duration must be in hours as a number`;

    try {
      const response = await this.querySingleActivity(prompt);
      const cleanedResponse = this.cleanJsonResponse(response);
      const activity = JSON.parse(cleanedResponse) as SingleActivityResponse;

      // Validate required fields
      if (!activity.name || !activity.description || !activity.duration || !activity.price || 
          !activity.category || !activity.location || !activity.exact_address || 
          !activity.opening_hours || !activity.rating || !activity.number_of_reviews || 
          !activity.key_highlights || !activity.preferred_time_of_day) {
        throw new Error('Missing required fields in activity response');
      }

      // Add tier based on price
      activity.tier = this.determineActivityTier(activity.price);

      // Rest of validation
      if (typeof activity.price !== 'number' || typeof activity.duration !== 'number' ||
          typeof activity.rating !== 'number' || typeof activity.number_of_reviews !== 'number') {
        throw new Error('Invalid numeric fields in activity response');
      }

      // Fetch images from Google
      try {
        const searchQuery = `${activity.name} ${activity.location} ${params.destination} photos`;
        const googleImagesResponse = await fetch(
          `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_CUSTOM_SEARCH_API_KEY}&cx=${process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID}&searchType=image&q=${encodeURIComponent(searchQuery)}&num=6&imgSize=large&safe=active`
        );
        
        if (googleImagesResponse.ok) {
          const data = await googleImagesResponse.json() as GoogleSearchResponse;
          if (data.items && data.items.length > 0) {
            activity.images = data.items.map(item => item.link);
          } else {
            activity.images = [];
          }
        } else {
          console.error('[Google Images] Failed to fetch images:', await googleImagesResponse.text());
          activity.images = [];
        }
      } catch (error) {
        console.error('[Google Images] Error fetching images:', error);
        activity.images = [];
      }

      return activity;
    } catch (error) {
      console.error('[Activity Generation] Error:', error);
      throw new Error('Failed to generate activity recommendation');
    }
  }

  private groupFlightsByTier(flights: AmadeusFlightOffer[]): Record<'budget' | 'medium' | 'premium', CategoryTier<FlightReference>> {
    const result = flights.reduce((acc, flight) => {
      const tier = this.determineFlightTier(flight);
      if (!acc[tier]) {
        acc[tier] = {
          min: Infinity,
          max: -Infinity,
          average: 0,
          confidence: 0.9, // Higher confidence for real data
          source: 'Amadeus',
          references: []
        };
      }
      const price = parseFloat(flight.price.total);
      acc[tier].min = Math.min(acc[tier].min, price);
      acc[tier].max = Math.max(acc[tier].max, price);
      acc[tier].references.push(this.transformAmadeusFlight(flight));
      return acc;
    }, {} as Record<'budget' | 'medium' | 'premium', CategoryTier<FlightReference>>);

    // Calculate averages
    Object.keys(result).forEach(tier => {
      const refs = result[tier as keyof typeof result].references;
      result[tier as keyof typeof result].average = 
        refs.reduce((sum: number, ref: any) => sum + ref.price, 0) / refs.length;
    });

    return result;
  }

  private async transformActivities(validActivities: any[], days: number): Promise<any[]> {
    logger.debug('Starting activity transformation', {
      totalActivities: validActivities.length,
      days
    });

    return validActivities.map((activity, index) => {
      // Get the day number from the activity data
      const rawDayNumber = activity.day || activity.dayNumber || activity.day_number;
      
      // Only calculate if raw day number is invalid
      const calculatedDayNumber = Math.floor(index / Math.ceil(validActivities.length / days)) + 1;
      const dayNumber = (rawDayNumber && rawDayNumber >= 1 && rawDayNumber <= days) ? rawDayNumber : calculatedDayNumber;

      logger.debug('Activity day assignment:', {
        activityName: activity.name,
        rawDayNumber,
        calculatedDayNumber,
        finalDayNumber: dayNumber,
        price: activity.price
      });

      // Determine tier based on price
      const tier = this.determineActivityTier(activity.price);

      return {
        ...activity,
        dayNumber,
        timeSlot: activity.preferred_time_of_day || activity.preferredTimeOfDay || 'morning',
        tier
      };
    });
  }
} 