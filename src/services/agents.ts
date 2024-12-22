import { Request, Response } from 'express';
import fetch from 'node-fetch';

interface TravelRequest {
  departure: string;
  destination: string;
  dates: {
    start: string;
    end: string;
  };
  travelers: number;
  budget?: number;
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

class VacationBudgetAgent {
  private async fetchWithRetry(url: string, options: any, retries = 3): Promise<Response> {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await fetch(url, options);
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }

    throw lastError;
  }

  async queryPerplexity(prompt: string): Promise<any> {
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
                content: 'You are a helpful assistant that provides accurate travel cost estimates in JSON format.'
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
        throw new Error(`Perplexity API error: ${response.statusText}`);
      }

      const data = await response.json() as PerplexityResponse;
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Error querying Perplexity:', error);
      throw error;
    }
  }

  async handleTravelRequest(req: Request, res: Response): Promise<void> {
    try {
      const travelRequest = req.body as TravelRequest;
      const requestType = req.query.type as string;

      // Validate request
      if (!travelRequest.departure || !travelRequest.destination || !travelRequest.dates) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Construct prompt based on request type
      let prompt = '';
      switch (requestType) {
        case 'flights':
          prompt = this.constructFlightPrompt(travelRequest);
          break;
        case 'hotels':
          prompt = this.constructHotelPrompt(travelRequest);
          break;
        case 'full':
          prompt = this.constructFullPrompt(travelRequest);
          break;
        default:
          res.status(400).json({
            success: false,
            error: 'Invalid request type',
            timestamp: new Date().toISOString()
          });
          return;
      }

      const response = await this.queryPerplexity(prompt);
      res.json({
        success: true,
        result: response,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error handling travel request:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  private constructFlightPrompt(request: TravelRequest): string {
    return `Find flight options from ${request.departure} to ${request.destination} for ${request.travelers} travelers, 
    departing on ${request.dates.start} and returning on ${request.dates.end}. 
    ${request.budget ? `The budget is ${request.budget} USD.` : ''} 
    Provide options in JSON format with economy, business, and first class prices.`;
  }

  private constructHotelPrompt(request: TravelRequest): string {
    return `Find hotel options in ${request.destination} for ${request.travelers} travelers, 
    checking in on ${request.dates.start} and checking out on ${request.dates.end}. 
    ${request.budget ? `The budget is ${request.budget} USD.` : ''} 
    Provide options in JSON format with budget, mid-range, and luxury accommodations.`;
  }

  private constructFullPrompt(request: TravelRequest): string {
    return `Create a complete travel budget for a trip from ${request.departure} to ${request.destination} 
    for ${request.travelers} travelers, from ${request.dates.start} to ${request.dates.end}. 
    ${request.budget ? `The total budget is ${request.budget} USD.` : ''} 
    Include flights, hotels, local transportation, food, and activities in JSON format with budget, mid-range, and luxury options.`;
  }
}

export { VacationBudgetAgent as default }; 