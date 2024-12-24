import { Request, Response } from 'express';
import fetch, { Response as FetchResponse } from 'node-fetch';

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

type CategoryData = FlightData | HotelData | ActivityData | TransportData | FoodData;

const SYSTEM_MESSAGE = `You are an AI travel budget expert. Your role is to:
1. Provide accurate cost estimates for travel expenses
2. Consider seasonality, location, and number of travelers
3. Always return responses in valid JSON format
4. Include min and max ranges for each price tier
5. Provide brief descriptions explaining the estimates
6. Consider local market conditions and currency
7. Base estimates on real-world data and current market rates`;

export class VacationBudgetAgent {
  private async fetchWithRetry(url: string, options: any, retries = 3): Promise<FetchResponse> {
    let lastError: Error | unknown;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        return response;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }

    throw lastError || new Error('Failed to fetch after retries');
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
      console.error('[Flight URL] Error generating flight URL:', error);
      return '';
    }
  }

  private generateHotelSearchUrl(hotel: HotelReference): string {
    try {
      const hotelName = encodeURIComponent(hotel.name);
      const location = encodeURIComponent(hotel.location);
      return `https://www.booking.com/search.html?ss=${hotelName}+${location}`;
    } catch {
      return '';
    }
  }

  async queryPerplexity(prompt: string, category: string): Promise<CategoryData> {
    try {
      console.log(`[${category.toUpperCase()}] Making Perplexity API request`);
      
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
                content: `${SYSTEM_MESSAGE}

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
10. All numbers must be valid JSON numbers (no commas, currency symbols, or units)
11. All dates must be valid ISO strings
12. All URLs must be valid and properly escaped
13. All property names must be double-quoted
14. Do NOT escape quotes in the response`
              },
              {
                role: 'user',
                content: prompt
              }
            ]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.statusText || 'Unknown error'}`);
      }

      const data = await response.json() as PerplexityResponse;
      let content = data.choices[0].message.content;
      
      // Clean the response
      content = content
        // Remove markdown
        .replace(/```json\n|\n```|```/g, '')
        // Remove any text before the first {
        .replace(/^[^{]*/, '')
        // Remove any text after the last }
        .replace(/}[^}]*$/, '}')
        // Remove escaped quotes
        .replace(/\\"/g, '"')
        // Fix property names - ensure they're double-quoted
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
        // Fix single quotes to double quotes (but not within words)
        .replace(/([{,]\s*"[^"]*":\s*)'([^']*)'(?=\s*[,}])/g, '$1"$2"')
        // Remove any trailing commas
        .replace(/,(\s*[}\]])/g, '$1')
        // Fix numbers with commas
        .replace(/"price"\s*:\s*"?\d{1,3}(?:,\d{3})+(?:\.\d+)?"?/g, match => {
          const num = parseFloat(match.replace(/[^0-9.]/g, ''));
          return `"price": ${num}`;
        })
        // Ensure proper spacing
        .replace(/\s+/g, ' ')
        .trim();

      try {
        // Parse the JSON
        const parsed = JSON.parse(content);

        // Validate the structure matches our expected type
        if (!this.validateCategoryData(parsed, category)) {
          throw new Error('Invalid data structure');
        }

        return parsed as CategoryData;
      } catch (parseError) {
        console.error(`[${category}] Failed to parse response:`, parseError);
        console.error(`[${category}] Problematic content:`, content);
        return this.getDefaultData(category);
      }
    } catch (error) {
      console.error(`[${category}] Error:`, error);
      return this.getDefaultData(category);
    }
  }

  private validateCategoryData(data: any, category: string): boolean {
    // Basic structure validation
    if (!data || typeof data !== 'object') return false;

    const categoryKey = category === 'localTransportation' ? 'localTransportation' : 
                       category.endsWith('s') ? category : `${category}s`;

    if (!data[categoryKey]) return false;

    const categoryData = data[categoryKey];
    
    // Validate tiers
    for (const tier of ['budget', 'medium', 'premium']) {
      if (!categoryData[tier]) return false;
      
      const tierData = categoryData[tier];
      if (
        typeof tierData.min !== 'number' ||
        typeof tierData.max !== 'number' ||
        typeof tierData.average !== 'number' ||
        typeof tierData.confidence !== 'number' ||
        typeof tierData.source !== 'string' ||
        !Array.isArray(tierData.references)
      ) {
        return false;
      }
    }

    return true;
  }

  private getDefaultData(category: string): CategoryData {
    const defaultTier = {
      min: 0,
      max: 0,
      average: 0,
      confidence: 0,
      source: 'error',
      references: []
    };

    switch (category) {
      case 'flights':
        return { flights: { budget: defaultTier, medium: defaultTier, premium: defaultTier } } as FlightData;
      case 'hotels':
        return { 
          hotels: { 
            searchDetails: { location: '', dates: { checkIn: '', checkOut: '' }, guests: 0 },
            budget: defaultTier, 
            medium: defaultTier, 
            premium: defaultTier 
          } 
        } as HotelData;
      case 'activities':
        return { activities: { budget: defaultTier, medium: defaultTier, premium: defaultTier } } as ActivityData;
      case 'localTransportation':
        return { localTransportation: { budget: defaultTier, medium: defaultTier, premium: defaultTier } } as TransportData;
      case 'food':
        return { food: { budget: defaultTier, medium: defaultTier, premium: defaultTier } } as FoodData;
      default:
        throw new Error(`Invalid category: ${category}`);
    }
  }

  async handleTravelRequest(request: TravelRequest): Promise<Record<string, any>> {
    try {
      const formattedRequest = {
        ...request,
        departureLocation: {
          ...request.departureLocation,
          name: request.departureLocation.label
        }
      };

      const categories = ['flights', 'hotels', 'localTransportation', 'food', 'activities'];
      const results = await Promise.all(
        categories.map(async (category) => {
          const prompt = this.constructPrompt(category, formattedRequest);
          const data = await this.queryPerplexity(prompt, category);
          return { category, data };
        })
      );

      return results.reduce((acc, { category, data }) => {
        acc[category] = data[category as keyof CategoryData];
        return acc;
      }, {} as Record<string, any>);
    } catch (error) {
      console.error('[VacationBudgetAgent] Error:', error);
      throw error;
    }
  }

  private constructPrompt(category: string, params: TravelRequest): string {
    switch (category) {
      case 'flights':
        return `Search for current flight prices from ${params.departureLocation?.label} to ${params.country}.
        Return a JSON object with flight estimates.
        
        Consider these details:
        - Departure: ${params.departureLocation?.label}
        - Destination: ${params.country}
        - Type: ${params.departureLocation?.isRoundTrip ? 'round-trip' : 'one-way'} flight
        - Outbound Date: ${params.departureLocation?.outboundDate}
        - Inbound Date: ${params.departureLocation?.inboundDate}
        - Travelers: ${params.travelers}
        - Currency: ${params.currency}

        Use this exact JSON structure:
        {
          "flights": {
            "budget": {
              "min": number (lowest price in this tier),
              "max": number (highest price in this tier),
              "average": number (average price in this tier),
              "confidence": number (between 0 and 1),
              "source": "string (data source)",
              "references": [
                {
                  "airline": "string (airline name)",
                  "route": "string (e.g., 'LAX to CDG')",
                  "price": number (exact price),
                  "outbound": "string (ISO date, e.g., '2024-12-26T10:00:00Z')",
                  "inbound": "string (ISO date, e.g., '2024-12-31T15:00:00Z')",
                  "duration": "string (e.g., '10 hours')",
                  "layovers": number (0 for direct flights),
                  "flightNumber": "string (e.g., 'AA123')",
                  "tier": "string (budget, medium, or premium)",
                  "referenceUrl": "string (booking URL)"
                }
              ]
            },
            "medium": { same structure as budget },
            "premium": { same structure as budget }
          }
        }

        IMPORTANT FORMATTING RULES:
        1. All fields are required - do not omit any fields
        2. Dates must be in ISO format with timezone (e.g., "2024-12-26T10:00:00Z")
        3. Price must be a number (not a string or range)
        4. Layovers must be a number (0 for direct flights)
        5. Each tier must have at least 2 flight references
        6. Flight numbers should be in standard format (e.g., "AA123", "UA456")
        7. Include actual booking URLs from major travel sites (Kayak, Google Flights, Skyscanner)
        8. Ensure all prices are in ${params.currency}
        9. Route should be in format "AIRPORT_CODE to AIRPORT_CODE" (e.g., "LAX to CDG")
        10. Do not include any explanatory text, only return the JSON object
        11. Do not use single quotes, only double quotes
        12. Do not include any trailing commas
        13. Ensure all URLs are properly formatted and complete
        14. Do not wrap the response in markdown code blocks
        15. Return ONLY the JSON object, no additional text`;

      case 'hotels':
        return `Find accommodation options in ${params.country} for ${params.travelers} travelers.
        Stay details:
        - Location: ${params.country}
        - Check-in: ${params.departureLocation.outboundDate}
        - Check-out: ${params.departureLocation.inboundDate}
        - Guests: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Provide a detailed JSON response with:
        {
          "hotels": {
            "searchDetails": {
              "location": "string",
              "dates": {
                "checkIn": "string",
                "checkOut": "string"
              },
              "guests": number
            },
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "name": "string",
                  "location": "string",
                  "price": number,
                  "type": "string (e.g., 'Hotel', 'Hostel', 'Apartment')",
                  "amenities": "string (comma-separated list)",
                  "rating": number (1-5 stars),
                  "reviewScore": number (0-10),
                  "reviewCount": number,
                  "images": ["string (image URLs)"],
                  "referenceUrl": "string (booking URL)",
                  "coordinates": {
                    "latitude": number,
                    "longitude": number
                  },
                  "features": ["string (key features)"],
                  "policies": {
                    "checkIn": "string (e.g., '14:00')",
                    "checkOut": "string (e.g., '11:00')",
                    "cancellation": "string"
                  }
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }

        Requirements:
        1. Include actual booking URLs from major travel sites (Booking.com, Hotels.com, etc.)
        2. Provide real hotel names and locations
        3. Include accurate amenities and features
        4. Add real review scores and counts when available
        5. Include at least 3 references per tier
        6. Ensure all prices are in ${params.currency}
        7. Include actual hotel images when available
        8. Provide accurate location coordinates
        9. Include detailed cancellation policies

        Return ONLY the JSON object, no additional text.`;

      case 'localTransportation':
        return `Analyze local transportation options in ${params.country} for ${params.travelers} travelers.
        Details:
        - Location: ${params.country}
        - Duration: ${params.departureLocation.outboundDate} to ${params.departureLocation.inboundDate}
        - Travelers: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Include:
        - Public transportation (buses, trains, metro)
        - Taxis and ride-sharing
        - Car rentals
        - Airport transfers

        Provide a detailed JSON response with:
        {
          "localTransportation": {
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "type": "string",
                  "description": "string",
                  "price": number,
                  "unit": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;

      case 'food':
        return `Estimate daily food costs in ${params.country} for ${params.travelers} travelers.
        Details:
        - Location: ${params.country}
        - Duration: ${params.departureLocation.outboundDate} to ${params.departureLocation.inboundDate}
        - Travelers: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Include:
        - Local restaurants
        - Cafes and street food
        - Grocery stores
        - Fine dining

        Provide a detailed JSON response with:
        {
          "food": {
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "type": "string",
                  "description": "string",
                  "price": number,
                  "mealType": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;

      case 'activities':
        return `Research tourist activities and attractions in ${params.country} for ${params.travelers} travelers.
        Details:
        - Location: ${params.country}
        - Duration: ${params.departureLocation.outboundDate} to ${params.departureLocation.inboundDate}
        - Travelers: ${params.travelers}
        ${params.budget ? `- Budget: ${params.budget} ${params.currency}` : ''}

        Include:
        - Tourist attractions
        - Guided tours
        - Cultural experiences
        - Entertainment
        - Adventure activities

        Provide a detailed JSON response with:
        {
          "activities": {
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "name": "string",
                  "description": "string",
                  "price": number,
                  "duration": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;

      default:
        throw new Error(`Invalid category: ${category}`);
    }
  }
} 