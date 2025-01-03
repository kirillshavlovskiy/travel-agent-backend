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
            ]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.statusText || 'Unknown error'}`);
      }

      const data = await response.json() as PerplexityResponse;
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from Perplexity API');
      }

      console.log(`[${category}] Raw response:`, content);

      // Clean up the response before parsing
      const cleanedContent = content
        // Replace price ranges with their average
        .replace(/(\d+)-(\d+)/g, (_, min, max) => {
          const average = (parseInt(min) + parseInt(max)) / 2;
          return average.toString();
        })
        // Remove any trailing commas in arrays and objects
        .replace(/,(\s*[}\]])/g, '$1')
        // Ensure all property names are double-quoted
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

      console.log(`[${category}] Cleaned response:`, cleanedContent);

      try {
        return JSON.parse(cleanedContent);
      } catch (parseError) {
        console.error(`[${category}] Failed to parse response:`, parseError);
        console.error(`[${category}] Problematic content:`, content);
        // Return a default structure for the category
        return this.getDefaultCategoryData(category);
      }
    } catch (error) {
      console.error(`[${category}] Error querying Perplexity:`, error);
      // Return a default structure for the category
      return this.getDefaultCategoryData(category);
    }
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
      case 'activities':
        return {
          activities: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      case 'localTransportation':
        return {
          localTransportation: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      case 'food':
        return {
          food: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
      default:
        return {
          food: {
            budget: defaultTier,
            medium: defaultTier,
            premium: defaultTier
          }
        };
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

      // Create the response object with request details
      const response: Record<string, any> = {
        requestDetails: {
          departureLocation: formattedRequest.departureLocation,
          destinations: formattedRequest.destinations,
          travelers: formattedRequest.travelers,
          startDate: formattedRequest.startDate,
          endDate: formattedRequest.endDate,
          currency: formattedRequest.currency
        }
      };

      // Add category data to the response
      results.forEach(({ category, data }) => {
        response[category] = data[category as keyof CategoryData];
      });

      return response;
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

        Return a valid JSON object with this EXACT structure:
        {
          "hotels": {
            "searchDetails": {
              "location": "${params.country}",
              "dates": {
                "checkIn": "${params.departureLocation.outboundDate}",
                "checkOut": "${params.departureLocation.inboundDate}"
              },
              "guests": ${params.travelers}
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
                  "type": "string",
                  "amenities": "string",
                  "rating": number,
                  "reviewScore": number,
                  "reviewCount": number,
                  "images": ["string"],
                  "referenceUrl": "string",
                  "coordinates": {
                    "latitude": number,
                    "longitude": number
                  },
                  "features": ["string"],
                  "policies": {
                    "checkIn": "string",
                    "checkOut": "string",
                    "cancellation": "string"
                  }
                }
              ]
            },
            "medium": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [/* same structure as budget references */]
            },
            "premium": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [/* same structure as budget references */]
            }
          }
        }

        IMPORTANT RULES:
        1. Use ONLY double quotes for all strings and property names
        2. Do NOT use single quotes anywhere
        3. Do NOT include any trailing commas
        4. All prices must be numbers (no currency symbols or commas)
        5. All coordinates must be valid numbers
        6. All arrays must be properly closed
        7. All objects must be properly closed
        8. Include at least 2 references per tier
        9. All prices must be in ${params.currency}
        10. All URLs must be valid and properly escaped
        11. Return ONLY the JSON object, no additional text`;

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

  private constructHotelPrompt(request: TravelRequest): string {
    const destination = request.destinations[0].label;
    const checkIn = request.startDate;
    const checkOut = request.endDate;
    const travelers = request.travelers;
    const budget = request.budget;

    return `Provide detailed hotel recommendations in ${destination} for ${travelers} travelers, checking in on ${checkIn} and checking out on ${checkOut}.
For each price category (budget, medium, premium), provide at least 5 real hotels with:
1. Full hotel name (use real, well-known hotels)
2. Exact location within ${destination}
3. Price per night in USD (realistic market rates)
4. Star rating (out of 5)
5. At least 3-5 key amenities (e.g., "Free WiFi, Pool, Restaurant")
6. Direct booking URL - IMPORTANT:
   - Prefer direct hotel website booking URLs (e.g., hilton.com, marriott.com)
   - Include the specific dates: ${checkIn} to ${checkOut}
   - Include number of guests: ${travelers}
   - Only use Booking.com as a last resort
7. At least 2 high-quality images of the hotel:
   - Exterior view
   - Room or amenity view
   - Must be real images from the hotel's website or official sources

Return in this exact JSON structure:
{
  "hotels": {
    "searchDetails": {
      "location": "${destination}",
      "dates": {
        "checkIn": "${checkIn}",
        "checkOut": "${checkOut}"
      },
      "guests": ${travelers}
    },
    "budget": {
      "min": [minimum price in category],
      "max": [maximum price in category],
      "average": [average price in category],
      "confidence": 0.9,
      "source": "Direct hotel websites and market research",
      "references": [
        {
          "name": "Hotel Name",
          "location": "Exact address",
          "price": 100,
          "rating": 4.5,
          "amenities": ["amenity1", "amenity2", "amenity3"],
          "link": "https://www.hilton.com/...",
          "images": [
            "https://www.hotel-website.com/image1.jpg",
            "https://www.hotel-website.com/image2.jpg"
          ],
          "hotelChain": "Hilton/Marriott/etc or Independent",
          "directBooking": true
        }
      ]
    },
    "medium": { [same structure as budget] },
    "premium": { [same structure as budget] }
  }
}

${budget ? `Consider total budget of ${budget} USD when suggesting options.` : ''}
IMPORTANT RULES:
1. Prioritize hotels with direct booking websites
2. All URLs must be complete and include check-in/out dates when possible
3. All images must be from official hotel sources
4. Prices must reflect actual rates for the specified dates
5. Only include hotels that can be booked online
6. Verify that all links and images are accessible
7. Include major hotel chains when available in each tier`;
  }
} 