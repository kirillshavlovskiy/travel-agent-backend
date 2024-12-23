import { Request, Response } from 'express';
import fetch, { Response as FetchResponse } from 'node-fetch';

interface TravelRequest {
  type: string;
  departureLocation: {
    name: string;
    outboundDate: string;
    inboundDate: string;
    isRoundTrip: boolean;
  };
  country: string;
  travelers: number;
  currency: string;
  budget?: number;
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
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

  async queryPerplexity(prompt: string, category: string): Promise<string> {
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
                content: SYSTEM_MESSAGE
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

      const data = await response.json() as unknown as PerplexityResponse;
      const content = data.choices[0].message.content;
      
      console.log(`[${category.toUpperCase()}] Received response from Perplexity API`);
      return this.cleanJsonResponse(content);
    } catch (error) {
      console.error(`[${category.toUpperCase()}] Error querying Perplexity:`, error);
      throw error;
    }
  }

  private cleanJsonResponse(content: string): string {
    console.log('[Perplexity] Cleaning JSON response');
    
    // Remove markdown code blocks
    let cleaned = content.replace(/```json\n|\n```/g, '');
    
    // Extract just the JSON object if there's surrounding text
    const jsonMatch = cleaned.match(/({[\s\S]*})/);
    if (jsonMatch) {
      cleaned = jsonMatch[1];
    }

    console.log('[Perplexity] Cleaned JSON');
    return cleaned;
  }

  async handleTravelRequest(request: TravelRequest): Promise<Record<string, any>> {
    try {
      console.log('[VacationBudgetAgent] Processing request:', {
        type: request.type,
        departure: request.departureLocation.name,
        country: request.country,
        dates: {
          outbound: request.departureLocation.outboundDate,
          inbound: request.departureLocation.inboundDate
        },
        travelers: request.travelers,
        budget: request.budget
      });

      // Validate request
      if (!request.departureLocation?.name || !request.country) {
        throw new Error('Missing required fields: departure location or country');
      }

      // Process all categories in parallel
      const categories = ['flights', 'hotels', 'localTransportation', 'food', 'activities'];
      const categoryPromises = categories.map(async (category) => {
        try {
          const prompt = this.constructPrompt(category, request);
          const response = await this.queryPerplexity(prompt, category);
          return { category, data: JSON.parse(response) };
        } catch (error) {
          console.error(`[${category}] Failed to process:`, error);
          return { category, data: null };
        }
      });

      const results = await Promise.all(categoryPromises);
      const estimatesData = results.reduce((acc, { category, data }) => {
        if (data) {
          acc[category] = data[category] || data;
        }
        return acc;
      }, {} as Record<string, any>);

      console.log('[VacationBudgetAgent] All categories processed');

      return estimatesData;
    } catch (error) {
      console.error('[VacationBudgetAgent] Error:', error);
      throw error;
    }
  }

  private constructPrompt(category: string, request: TravelRequest): string {
    switch (category) {
      case 'flights':
        return `Find flight options from ${request.departureLocation.name} to ${request.country} for ${request.travelers} travelers.
        Trip details:
        - Departure: ${request.departureLocation.name}
        - Destination: ${request.country}
        - Dates: ${request.departureLocation.outboundDate} to ${request.departureLocation.inboundDate}
        - Travelers: ${request.travelers}
        - Type: ${request.departureLocation.isRoundTrip ? 'Round-trip' : 'One-way'}
        ${request.budget ? `- Budget: ${request.budget} ${request.currency}` : ''}

        Provide a detailed JSON response with:
        {
          "flights": {
            "searchDetails": {
              "from": "string",
              "to": "string",
              "type": "string",
              "dates": {
                "outbound": "string",
                "inbound": "string"
              },
              "travelers": number
            },
            "budget": {
              "min": number,
              "max": number,
              "average": number,
              "confidence": number,
              "source": "string",
              "references": [
                {
                  "airline": "string",
                  "route": "string",
                  "price": number,
                  "outbound": "string",
                  "inbound": "string",
                  "layovers": number,
                  "duration": "string",
                  "class": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;

      case 'hotels':
        return `Find accommodation options in ${request.country} for ${request.travelers} travelers.
        Stay details:
        - Location: ${request.country}
        - Check-in: ${request.departureLocation.outboundDate}
        - Check-out: ${request.departureLocation.inboundDate}
        - Guests: ${request.travelers}
        ${request.budget ? `- Budget: ${request.budget} ${request.currency}` : ''}

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
                  "type": "string",
                  "amenities": "string"
                }
              ]
            },
            "medium": { same structure },
            "premium": { same structure }
          }
        }`;

      case 'localTransportation':
        return `Analyze local transportation options in ${request.country} for ${request.travelers} travelers.
        Details:
        - Location: ${request.country}
        - Duration: ${request.departureLocation.outboundDate} to ${request.departureLocation.inboundDate}
        - Travelers: ${request.travelers}
        ${request.budget ? `- Budget: ${request.budget} ${request.currency}` : ''}

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
        return `Estimate daily food costs in ${request.country} for ${request.travelers} travelers.
        Details:
        - Location: ${request.country}
        - Duration: ${request.departureLocation.outboundDate} to ${request.departureLocation.inboundDate}
        - Travelers: ${request.travelers}
        ${request.budget ? `- Budget: ${request.budget} ${request.currency}` : ''}

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
        return `Research tourist activities and attractions in ${request.country} for ${request.travelers} travelers.
        Details:
        - Location: ${request.country}
        - Duration: ${request.departureLocation.outboundDate} to ${request.departureLocation.inboundDate}
        - Travelers: ${request.travelers}
        ${request.budget ? `- Budget: ${request.budget} ${request.currency}` : ''}

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