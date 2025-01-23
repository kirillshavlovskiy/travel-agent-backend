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

interface PerplexitySearchResult {
  title: string;
  url: string;
  content: string;
}

interface PerplexityMessage {
  content: string;
  search_results?: PerplexitySearchResult[];
}

interface PerplexityChoice {
  message: PerplexityMessage;
}

interface PerplexityResponse {
  choices: PerplexityChoice[];
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
  startTime: string;
  endTime: string;
  rating: number;
  number_of_reviews: number;
  key_highlights: string[];
  preferred_time_of_day: string;
  images?: string[];
  timeSlot?: string;
  dayNumber?: number;
  tier?: string;
  bookingDetails: {
    provider: 'Viator' | 'GetYourGuide';
    referenceUrl: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
    pickupIncluded: boolean;
    pickupLocation: string;
    accessibility: string;
    restrictions: string[];
  };
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

interface TimeSlot {
  budget: any[];
  medium: any[];
  premium: any[];
}

interface ActivityGroup {
  [key: string]: TimeSlot;
}

interface TransformedActivity {
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  location: string;
  exact_address: string;
  opening_hours: string;
  startTime: string;
  endTime: string;
  rating: number;
  number_of_reviews: number;
  key_highlights: string[];
  preferred_time_of_day: string;
  dayNumber: number;
  timeSlot: string;
  tier: string;
  bookingDetails: {
    provider: 'Viator' | 'GetYourGuide';
    referenceUrl: string;
    cancellationPolicy: string;
    instantConfirmation: boolean;
    mobileTicket: boolean;
    languages: string[];
    minParticipants: number;
    maxParticipants: number;
    pickupIncluded: boolean;
    pickupLocation: string;
    accessibility: string;
    restrictions: string[];
  };
  images: string[];
}

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
            segments: [{
              originLocationCode: request.departureLocation.code,
              destinationLocationCode: request.destinations[0].code,
              departureDate: request.startDate || ''
            }],
            adults: request.travelers,
            travelClass
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
    const prompt = `Search for and recommend REAL, BOOKABLE activities in ${request.destinations[0].label} for a ${request.days}-day trip.
Total budget: ${request.budget} ${request.currency}

CRITICAL: Only suggest activities that ACTUALLY EXIST on Viator or GetYourGuide.

For each day (Day 1 to ${request.days}), find activities that match these requirements:

MORNING ACTIVITIES (9:00-12:00):
- 1 budget activity (under $30) from GetYourGuide
- 1 medium activity ($30-$100) from GetYourGuide
- 1 premium activity ($100+) from Viator

AFTERNOON ACTIVITIES (14:00-17:00):
- 1 budget activity (under $30) from GetYourGuide
- 1 medium activity ($30-$100) from GetYourGuide
- 1 premium activity ($100+) from Viator

EVENING ACTIVITIES (19:00-22:00):
- 1 budget activity (under $30) from GetYourGuide
- 1 medium activity ($30-$100) from GetYourGuide
- 1 premium activity ($100+) from Viator

CRITICAL URL REQUIREMENTS:
1. For Viator activities, use EXACT URLs in this format:
   https://www.viator.com/tours/[city]/[activity-name]/[product-code]
   Example: https://www.viator.com/tours/Paris/Skip-the-Line-Eiffel-Tower-Tour/d479-3731EIFFEL

2. For GetYourGuide activities, use EXACT URLs in this format:
   https://www.getyourguide.com/[city]/[activity-code]
   Example: https://www.getyourguide.com/paris-l16/eiffel-tower-skip-the-line-ticket-summit-access-t288139

3. DO NOT make up or guess URLs - only use real ones you can verify
4. Each activity MUST have a valid, working booking URL
5. Premium activities MUST be from Viator
6. Budget/medium activities MUST be from GetYourGuide

Return a JSON object with this structure for each activity:
{
  "day": number,
  "name": "string (actual activity name from provider)",
  "description": "string (actual description from provider)",
  "price": number (exact price from provider),
  "duration": number (in hours),
  "location": "string",
  "address": "string (exact address)",
  "openingHours": "string",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "rating": number (from provider),
  "number_of_reviews": number (from provider),
  "key_highlights": ["string (from provider)"],
  "preferred_time_of_day": "morning" | "afternoon" | "evening",
  "bookingDetails": {
    "provider": "Viator" | "GetYourGuide",
    "referenceUrl": "string (EXACT booking URL)",
    "cancellationPolicy": "string (from provider)",
    "instantConfirmation": boolean,
    "mobileTicket": boolean,
    "languages": ["string"],
    "minParticipants": number,
    "maxParticipants": number,
    "pickupIncluded": boolean,
    "pickupLocation": "string",
    "accessibility": "string",
    "restrictions": ["string"]
  }
}

IMPORTANT:
- Only include activities that ACTUALLY EXIST on these platforms
- Use REAL prices, ratings, and review counts from the providers
- Include EXACT booking details from the actual listings
- Verify each URL exists before including it
- DO NOT make up or guess any information`;

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
    logger.debug('Content before cleaning:', content);
    
    try {
      // First try to parse it directly in case it's already valid JSON
      try {
        JSON.parse(content);
        return content;
      } catch (e) {
        // If direct parsing fails, proceed with cleaning
      }

      // Remove any markdown code block markers
      content = content.replace(/```json\n?|\n?```/g, '');
      
      // Remove any text before the first {
      content = content.substring(content.indexOf('{'));
      
      // Remove any text after the last }
      content = content.substring(0, content.lastIndexOf('}') + 1);
      
      // Quote unquoted property names
      content = content.replace(/(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
      
      // Fix duration ranges by taking the average
      content = content.replace(/"duration"\s*:\s*"?(\d+)-(\d+)"?/g, (match, start, end) => {
        const avg = (parseInt(start) + parseInt(end)) / 2;
        return `"duration": ${avg}`;
      });

      // Convert any remaining duration ranges to single numbers
      content = content.replace(/"duration"\s*:\s*"([0-9.]+)"/g, '"duration": $1');
      
      // Quote unquoted string values
      content = content.replace(/:\s*(true|false)(\s*[,}])/gi, ':"$1"$2');
      
      // Clean up any malformed URLs
      content = content.replace(/(\/[^\/]+)\1{10,}/g, '/malformed-url-removed');

      // Try to parse the cleaned content
      const parsed = JSON.parse(content);
      
      // Convert back to string with proper formatting
      return JSON.stringify(parsed, null, 2);
      
    } catch (error) {
      logger.error('Failed to clean JSON response:', { error, content });
      // Return a valid empty activity object as fallback
      return JSON.stringify({
        name: "Fallback Activity",
        description: "Unable to generate activity details. Please try again.",
        duration: 2,
        price: 0,
        category: "General",
        location: "To be determined",
        exact_address: "",
        opening_hours: "",
        startTime: "09:00",
        endTime: "11:00",
        rating: 0,
        number_of_reviews: 0,
        key_highlights: ["Please try generating another activity"],
        preferred_time_of_day: "morning",
        bookingDetails: {
          provider: "GetYourGuide",
          referenceUrl: "",
          cancellationPolicy: "Free cancellation",
          instantConfirmation: true,
          mobileTicket: true,
          languages: ["English"],
          minParticipants: 1,
          maxParticipants: 10,
          pickupIncluded: false,
          pickupLocation: "",
          accessibility: "Standard",
          restrictions: []
        },
        images: []
      });
    }
  }

  private async querySingleActivity(prompt: string): Promise<string> {
    try {
      logger.info('[Perplexity] Starting activity search with prompt', {
        promptLength: prompt.length,
        searchEnabled: true,
        webSearchEnabled: true
      });

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
                content: `You are a travel activity expert specializing in Viator and GetYourGuide bookings.
Your task is to search through Viator and GetYourGuide's platforms to find and recommend REAL, BOOKABLE activities.

SEARCH PROCESS:
1. First search Viator.com for premium activities ($100+)
2. Then search GetYourGuide.com for budget/medium activities (under $100)
3. Use the search filters on each platform to find activities matching the requirements
4. Verify each activity exists and is currently bookable
5. Copy exact details from the actual listings

CRITICAL RULES:
1. ONLY suggest activities that you can find on these platforms
2. ALL URLs must be real, active booking links that you verify
3. Premium activities ($100+) MUST be from Viator.com
4. Budget/medium activities (under $100) MUST be from GetYourGuide.com
5. Include EXACT booking URLs in this format:
   - Viator: https://www.viator.com/tours/[city]/[activity-name]/[product-code]
   - GetYourGuide: https://www.getyourguide.com/[city]/[activity-code]
6. Copy exact prices, descriptions, and details from the listings
7. Do not make up or guess any information - only use what you find
8. If you can't find a suitable activity, say so instead of making one up

SEARCH LOGGING:
For each activity you find, log:
{
  "searchUrl": "URL you searched",
  "foundActivity": true/false,
  "provider": "Viator or GetYourGuide",
  "activityUrl": "actual booking URL found",
  "price": "exact price found",
  "tier": "budget/medium/premium"
}`
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            options: {
              search: true,
              temperature: 0.1,
              max_tokens: 4000,
              web_search: true
            }
          })
        },
        3
      );

      if (!response.ok) {
        throw new Error(`Perplexity API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as PerplexityResponse;
      
      // Log the search results
      const searchResults = result.choices[0].message.search_results || [];
      logger.info('[Perplexity] Search completed', {
        contentLength: result.choices[0].message.content.length,
        hasSearchResults: searchResults.length > 0,
        searchResultCount: searchResults.length,
        viatorResults: searchResults.filter(r => r.url.includes('viator.com')).length,
        getyourguideResults: searchResults.filter(r => r.url.includes('getyourguide.com')).length
      });

      if (searchResults.length > 0) {
        logger.debug('[Perplexity] Search results', {
          results: searchResults.map(r => ({
            title: r.title,
            url: r.url,
            isViator: r.url.includes('viator.com'),
            isGetYourGuide: r.url.includes('getyourguide.com'),
            content: r.content.substring(0, 100) + '...'
          }))
        });
      } else {
        logger.warn('[Perplexity] No search results found from Viator or GetYourGuide');
      }

      return result.choices[0].message.content;
    } catch (error) {
      logger.error('[Perplexity] API error:', error);
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
    const preferencesStr = params.userPreferences ? ` that matches these preferences: ${params.userPreferences}` : '';
    
    // Determine price range based on tier
    const priceRange = this.getPriceRangeForTier(params.budget, params.currency);
    const provider = params.budget >= 100 ? 'Viator' : 'GetYourGuide';
    
    const prompt = `Find a REAL, BOOKABLE ${provider} activity in ${params.destination} during ${params.timeOfDay} on day ${params.dayNumber}${categoryStr}${preferencesStr}.

STRICT PRICE REQUIREMENTS:
- Activity MUST cost between ${priceRange.min} and ${priceRange.max} ${params.currency}
- This is a ${params.budget >= 100 ? 'PREMIUM' : params.budget >= 30 ? 'MEDIUM' : 'BUDGET'} tier activity
- ${provider} activities in this price range include: [list real examples you find]

CRITICAL URL REQUIREMENTS:
1. MUST be from ${provider} - NO EXCEPTIONS
2. MUST use this EXACT URL format:
   ${provider === 'Viator' 
     ? '- https://www.viator.com/tours/[city]/[activity-name]/d[destination-id]-[activity-id]'
     : '- https://www.getyourguide.com/[city]/[activity-code]'}
3. URL must be for a real, active listing
4. Verify the URL exists before including it

SEARCH INSTRUCTIONS:
1. Search ${provider}'s website for activities in ${params.destination}
2. Filter for activities in the ${priceRange.min}-${priceRange.max} ${params.currency} range
3. Find activities matching the category${categoryStr ? ` (${params.category})` : ''} and time slot (${params.timeOfDay})
4. Verify the activity exists and is bookable
5. Include EXACT details from the real listing

Response Format:
{
  "name": "EXACT activity name from ${provider}",
  "description": "EXACT description from the listing",
  "duration": 2,
  "price": 150,
  "category": "${params.category || 'General'}",
  "location": "Specific venue name",
  "exact_address": "Full street address",
  "opening_hours": "Real operating hours",
  "startTime": "19:00",
  "endTime": "21:00",
  "rating": 4.5,
  "number_of_reviews": 2500,
  "key_highlights": [
    "Real highlight 1",
    "Real highlight 2",
    "Real highlight 3"
  ],
  "preferred_time_of_day": "${params.timeOfDay}",
  "bookingDetails": {
    "provider": "${provider}",
    "referenceUrl": "REAL ${provider} URL HERE",
    "cancellationPolicy": "Exact policy from listing",
    "instantConfirmation": true,
    "mobileTicket": true,
    "languages": ["English", "Local language"],
    "minParticipants": 1,
    "maxParticipants": 8,
    "pickupIncluded": false,
    "pickupLocation": "",
    "accessibility": "From listing",
    "restrictions": [
      "From listing"
    ]
  },
  "images": [
    "Real image URL 1",
    "Real image URL 2"
  ]
}

IMPORTANT:
- Only return activities that ACTUALLY EXIST on ${provider}
- Price MUST be between ${priceRange.min} and ${priceRange.max} ${params.currency}
- All details must be from a real listing
- Do not make up or guess any information`;

    try {
      const response = await this.querySingleActivity(prompt);
      const cleanedResponse = this.cleanJsonResponse(response);
      const activity = JSON.parse(cleanedResponse);

      // Validate price is within range
      if (activity.price < priceRange.min || activity.price > priceRange.max) {
        logger.warn('Activity price out of range, retrying with adjusted prompt', {
          price: activity.price,
          min: priceRange.min,
          max: priceRange.max
        });
        
        // Try one more time with a stronger emphasis on price
        const retryPrompt = `${prompt}\n\nCRITICAL: The activity MUST cost between ${priceRange.min} and ${priceRange.max} ${params.currency}. DO NOT suggest activities outside this price range.`;
        const retryResponse = await this.querySingleActivity(retryPrompt);
        const retryCleanedResponse = this.cleanJsonResponse(retryResponse);
        const retryActivity = JSON.parse(retryCleanedResponse);
        
        if (retryActivity.price < priceRange.min || retryActivity.price > priceRange.max) {
          throw new Error(`Could not find activity in price range ${priceRange.min}-${priceRange.max} ${params.currency}`);
        }
        
        return retryActivity;
      }

      // Validate booking details
      if (!activity.bookingDetails?.provider || !activity.bookingDetails?.referenceUrl) {
        throw new Error('Missing required booking details');
      }

      // Validate provider matches tier
      if (activity.bookingDetails.provider !== provider) {
        throw new Error(`Invalid provider ${activity.bookingDetails.provider} for tier ${params.budget}, expected ${provider}`);
      }

      // Validate URL format
      const urlPattern = provider === 'Viator' 
        ? /^https:\/\/www\.viator\.com\/tours\/.*\/.*\/d\d+-\w+$/
        : /^https:\/\/www\.getyourguide\.com\/.*\/.*-\d+$/;
      
      if (!urlPattern.test(activity.bookingDetails.referenceUrl)) {
        throw new Error(`Invalid ${provider} URL format`);
      }

      return activity;
    } catch (error) {
      logger.error('[Activity Generation] Error:', error);
      
      // If we've tried with a retry and still failed, return a placeholder
      const placeholder = this.createPlaceholderActivity(
        params.dayNumber,
        params.timeOfDay,
        params.budget >= 100 ? 'premium' : params.budget >= 30 ? 'medium' : 'budget'
      );
      
      // Customize the placeholder with the specific category and preferences
      if (params.category) {
        placeholder.category = params.category;
      }
      if (params.userPreferences) {
        placeholder.description += ` (${params.userPreferences})`;
      }
      
      return placeholder;
    }
  }

  private getPriceRangeForTier(budget: number | string, currency: string): { min: number; max: number } {
    const budgetNum = typeof budget === 'string' ? this.getBudgetAmount(budget) : budget;
    
    switch(budget) {
      case 'budget':
        return { min: 0, max: 30 };
      case 'medium':
        return { min: 30, max: 100 };
      case 'premium':
        return { min: 100, max: budgetNum }; // Use the total budget as max for premium
      default:
        return { min: 0, max: budgetNum };
    }
  }

  private getBudgetAmount(tier: string): number {
    switch(tier.toLowerCase()) {
      case 'budget':
        return 30;
      case 'medium':
        return 100;
      case 'premium':
        return 500; // Default max for premium tier
      default:
        return 100; // Default to medium tier budget
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

  private async transformActivities(validActivities: any[], days: number): Promise<TransformedActivity[]> {
    logger.debug('Starting activity transformation', {
      totalActivities: validActivities.length,
      days
    });

    // Group activities by day and time slot
    const activityGroups = validActivities.reduce((acc: Record<number, ActivityGroup>, activity: any) => {
      // Skip activities without proper booking details
      if (!this.hasValidBookingDetails(activity)) {
        logger.warn('Skipping activity without valid booking details', {
          name: activity.name,
          provider: activity.bookingDetails?.provider
        });
        return acc;
      }

      const day = activity.day || activity.dayNumber || activity.day_number;
      const timeSlot = activity.preferred_time_of_day || 'morning';
      const tier = this.determineActivityTier(activity.price);

      if (!acc[day]) {
        acc[day] = {
          morning: { budget: [], medium: [], premium: [] },
          afternoon: { budget: [], medium: [], premium: [] },
          evening: { budget: [], medium: [], premium: [] }
        };
      }

      if (acc[day][timeSlot] && acc[day][timeSlot][tier]) {
        acc[day][timeSlot][tier].push(activity);
      }
      return acc;
    }, {});

    // Ensure each day has activities in each time slot and tier
    const transformedActivities: TransformedActivity[] = [];
    for (let day = 1; day <= days; day++) {
      const dayActivities = activityGroups[day] || {
        morning: { budget: [], medium: [], premium: [] },
        afternoon: { budget: [], medium: [], premium: [] },
        evening: { budget: [], medium: [], premium: [] }
      };

      // Process each time slot
      (['morning', 'afternoon', 'evening'] as const).forEach((timeSlot) => {
        // Ensure at least one activity per tier in each time slot
        (['budget', 'medium', 'premium'] as const).forEach((tier) => {
          const activities = dayActivities[timeSlot][tier];
          if (activities.length === 0) {
            // Create placeholder activity if none exists
            const placeholder = this.createPlaceholderActivity(day, timeSlot, tier);
            activities.push(placeholder);
          }

          // Add all activities from this tier and time slot
          activities.forEach((activity: any) => {
            transformedActivities.push({
              ...activity,
              dayNumber: day,
              timeSlot,
              tier,
              bookingDetails: this.ensureValidBookingDetails(activity.bookingDetails, tier)
            } as TransformedActivity);
          });
        });
      });
    }

    logger.debug('Activity transformation complete', {
      transformedCount: transformedActivities.length,
      daysProcessed: days
    });

    return transformedActivities;
  }

  private hasValidBookingDetails(activity: any): boolean {
    const isViatorUrl = (url: string) => /^https:\/\/www\.viator\.com\/tours\/[^/]+\/[^/]+\/d\d+-\w+$/.test(url);
    const isGetYourGuideUrl = (url: string) => /^https:\/\/www\.getyourguide\.com\/[^/]+\/[^/]+-t\d+$/.test(url);
    
    const isValid = activity.bookingDetails &&
      (activity.bookingDetails.provider === 'Viator' || activity.bookingDetails.provider === 'GetYourGuide') &&
      activity.bookingDetails.referenceUrl &&
      activity.bookingDetails.referenceUrl.length > 0 &&
      (
        (activity.bookingDetails.provider === 'Viator' && isViatorUrl(activity.bookingDetails.referenceUrl)) ||
        (activity.bookingDetails.provider === 'GetYourGuide' && isGetYourGuideUrl(activity.bookingDetails.referenceUrl))
      );

    // Log validation details
    logger.debug('[Activity Validation]', {
      name: activity.name,
      provider: activity.bookingDetails?.provider,
      url: activity.bookingDetails?.referenceUrl,
      isValid,
      price: activity.price,
      tier: this.determineActivityTier(activity.price),
      isViatorUrl: activity.bookingDetails?.referenceUrl ? isViatorUrl(activity.bookingDetails.referenceUrl) : false,
      isGetYourGuideUrl: activity.bookingDetails?.referenceUrl ? isGetYourGuideUrl(activity.bookingDetails.referenceUrl) : false
    });

    if (!isValid) {
      logger.warn('[Activity Validation] Invalid booking details', {
        name: activity.name,
        provider: activity.bookingDetails?.provider,
        url: activity.bookingDetails?.referenceUrl,
        price: activity.price,
        missingProvider: !activity.bookingDetails?.provider,
        missingUrl: !activity.bookingDetails?.referenceUrl,
        invalidProvider: activity.bookingDetails?.provider !== 'Viator' && activity.bookingDetails?.provider !== 'GetYourGuide',
        invalidUrlFormat: activity.bookingDetails?.referenceUrl ? 
          !isViatorUrl(activity.bookingDetails.referenceUrl) && !isGetYourGuideUrl(activity.bookingDetails.referenceUrl) : 
          true
      });
    }

    return isValid;
  }

  private ensureValidBookingDetails(bookingDetails: any, tier: string): TransformedActivity['bookingDetails'] {
    const provider = tier === 'premium' ? 'Viator' : 'GetYourGuide';
    const baseUrl = provider === 'Viator' ? 'https://www.viator.com' : 'https://www.getyourguide.com';
    
    return {
      provider,
      referenceUrl: bookingDetails?.referenceUrl || `${baseUrl}/error-invalid-url`,
      cancellationPolicy: bookingDetails?.cancellationPolicy || 'Free cancellation up to 24 hours before the activity starts',
      instantConfirmation: bookingDetails?.instantConfirmation ?? true,
      mobileTicket: bookingDetails?.mobileTicket ?? true,
      languages: bookingDetails?.languages || ['English'],
      minParticipants: bookingDetails?.minParticipants || 1,
      maxParticipants: bookingDetails?.maxParticipants || (tier === 'premium' ? 8 : 50),
      pickupIncluded: bookingDetails?.pickupIncluded ?? (tier === 'premium'),
      pickupLocation: bookingDetails?.pickupLocation || (tier === 'premium' ? 'Your hotel' : ''),
      accessibility: bookingDetails?.accessibility || 'Standard',
      restrictions: bookingDetails?.restrictions || []
    };
  }

  private createPlaceholderActivity(day: number, timeSlot: string, tier: string): TransformedActivity {
    const timeSlots = {
      morning: { start: "09:00", end: "12:00" },
      afternoon: { start: "14:00", end: "17:00" },
      evening: { start: "19:00", end: "22:00" }
    };
    const slot = timeSlots[timeSlot as keyof typeof timeSlots];

    const prices = {
      budget: 25,
      medium: 75,
      premium: 150
    };

    const provider = tier === 'premium' ? 'Viator' : 'GetYourGuide';
    const baseUrl = provider === 'Viator' ? 'https://www.viator.com' : 'https://www.getyourguide.com';

    return {
      name: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Activity`,
      description: `A ${tier} activity in ${timeSlot}`,
      duration: 2,
      price: prices[tier as keyof typeof prices],
      category: "General",
      location: "To be determined",
      exact_address: "",
      opening_hours: `${slot.start} - ${slot.end}`,
      startTime: slot.start,
      endTime: slot.end,
      rating: 4.5,
      number_of_reviews: 100,
      key_highlights: [`${tier.charAt(0).toUpperCase() + tier.slice(1)} experience`],
      preferred_time_of_day: timeSlot,
      dayNumber: day,
      timeSlot,
      tier,
      bookingDetails: {
        provider,
        referenceUrl: `${baseUrl}/placeholder-${tier}-activity`,
        cancellationPolicy: "Free cancellation up to 24 hours before the activity starts",
        instantConfirmation: true,
        mobileTicket: true,
        languages: ["English", "German"],
        minParticipants: 1,
        maxParticipants: tier === 'premium' ? 8 : 50,
        pickupIncluded: tier === 'premium',
        pickupLocation: tier === 'premium' ? "Your hotel" : "",
        accessibility: "Standard",
        restrictions: []
      },
      images: []
    };
  }
} 