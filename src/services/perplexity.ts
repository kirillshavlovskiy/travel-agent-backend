import axios from 'axios';

interface PerplexityResponse {
  text: string;
  images?: string[];
  address?: string;
  description?: string;
  highlights?: string[];
  openingHours?: string;
  rating?: number;
  reviews?: number;
  error?: string;
}

export class PerplexityService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || '';
    this.baseUrl = 'https://api.perplexity.ai';
  }

  async chat(query: string) {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [
            {
              role: 'system',
              content: `You are a helpful assistant that provides detailed information about places and activities in JSON format.
              CRITICAL: Return ONLY a valid JSON object with no markdown formatting or code blocks.
              Use ONLY double quotes for strings and property names.
              Do NOT use single quotes anywhere.
              Do NOT include any trailing commas.
              All numbers must be valid JSON numbers (no ranges like "35-40", use average value instead).`
            },
            {
              role: 'user',
              content: query
            }
          ],
          options: {
            temperature: 0.1,
            max_tokens: 4000
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Clean the response content before returning
      if (response.data.choices?.[0]?.message?.content) {
        const content = response.data.choices[0].message.content
          .replace(/```json\n?|\n?```/g, '') // Remove markdown code blocks
          .replace(/^\s*\n/gm, '') // Remove empty lines
          .replace(/\r\n/g, '\n') // Normalize line endings
          .replace(/\n/g, ' ') // Convert newlines to spaces
          .replace(/\t/g, ' ') // Convert tabs to spaces
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();

        response.data.choices[0].message.content = content;
      }

      return response.data;
    } catch (error) {
      console.error('Error in Perplexity chat:', error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error('Perplexity API endpoint not found. Please check the API configuration.');
        }
        if (error.response?.status === 401) {
          throw new Error('Invalid Perplexity API key. Please check your API key configuration.');
        }
        if (error.response?.status === 400) {
          const errorMessage = error.response.data?.error?.message || 'Bad request to Perplexity API';
          throw new Error(`Perplexity API error: ${errorMessage}`);
        }
        throw new Error(`Perplexity API error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  async getEnrichedDetails(query: string): Promise<PerplexityResponse> {
    try {
      if (!this.apiKey) {
        throw new Error('Perplexity API key is not configured');
      }

      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [
            {
              role: 'system',
              content: `You are a travel planning assistant that creates detailed, well-structured activity itineraries. 
              Each activity must be properly categorized by price tier, day number, and time slot.
              
              Price tiers must be strictly followed:
              - Budget: Under $30 per person
              - Medium: $30-$100 per person
              - Premium: Over $100 per person
              
              Time slots must be evenly distributed:
              - Morning: 9 AM - 12 PM
              - Afternoon: 12 PM - 5 PM
              - Evening: 5 PM - 10 PM`
            },
            {
              role: 'user',
              content: `Create a comprehensive ${query} including:

              For EACH DAY of the trip, provide exactly:
              Morning activities (9 AM - 12 PM):
              - 1 Budget activity (under $30)
              - 1 Medium activity ($30-$100)
              - 1 Premium activity (over $100)

              Afternoon activities (12 PM - 5 PM):
              - 1 Budget activity (under $30)
              - 1 Medium activity ($30-$100)
              - 1 Premium activity (over $100)

              Evening activities (5 PM - 10 PM):
              - 1 Budget activity (under $30)
              - 1 Medium activity ($30-$100)
              - 1 Premium activity (over $100)

              Requirements:
              - Each activity MUST have a specific day number (1, 2, 3, etc.)
              - Each activity MUST have a specific time slot (morning, afternoon, evening)
              - Activities must be appropriate for their time slot (e.g. dinner in evening)
              - Premium activities must be truly exclusive experiences
              - Consider local specialties and unique experiences
              - Respect arrival/departure times
              
              For each activity provide:
              {
                name: string
                description: string
                price: number (exact amount in USD)
                duration: number (in hours)
                location: string
                address: string
                openingHours: string
                keyHighlights: string[]
                rating: number (1-5)
                numberOfReviews: number
                category: string
                dayNumber: number (1, 2, 3, etc.)
                timeSlot: "morning" | "afternoon" | "evening"
                referenceUrl: string
                images: string[]
                priceCategory: "budget" | "medium" | "premium"
              }

              Format the response as a JSON object with an activities array containing all activities properly organized by day and time slot.`
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Parse the response text as JSON
      const content = response.data.choices[0].message.content;
      try {
        return JSON.parse(content);
      } catch (e) {
        console.error('Failed to parse Perplexity response:', e);
        // If parsing fails, return a structured response with just the text
        return {
          text: content,
          error: 'Failed to parse activity data'
        };
      }
    } catch (error) {
      console.error('Error fetching details from Perplexity:', error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error('Perplexity API endpoint not found. Please check the API configuration.');
        }
        if (error.response?.status === 401) {
          throw new Error('Invalid Perplexity API key. Please check your API key configuration.');
        }
        if (error.response?.status === 400) {
          const errorMessage = error.response.data?.error?.message || 'Bad request to Perplexity API';
          throw new Error(`Perplexity API error: ${errorMessage}`);
        }
        throw new Error(`Perplexity API error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }
}

// Create and export a singleton instance
export const perplexityClient = new PerplexityService(); 