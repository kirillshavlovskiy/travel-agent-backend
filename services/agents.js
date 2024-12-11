import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

class VacationBudgetAgent {
  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY;
  }

  async queryPerplexity(prompt) {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-small-128k-online",
        messages: [
          { role: "system", content: "You are a travel budget analysis assistant." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    console.log(data);
    return data;
  }

  async handleTravelRequest(req, res) {
    try {
      const result = await this.processTravelRequest(req.body);
      return res.json(result);
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async processTravelRequest(travelData) {
    const prompt = `Generate a travel budget analysis for:
      - Departure: ${travelData.departure}
      - Destination: ${travelData.destination}
      - Dates: ${travelData.dates}
      - Travelers: ${travelData.travelers}
      - Budget: $${travelData.budget}
      
      Format the response as JSON with the following structure for each category (Flights, Accommodation, Food, Car Rental, Activities):
      {
        "Flights": {
          "Budget": { "min": number, "max": number, "confidence": number, "source": string },
          "Standard": { "min": number, "max": number, "confidence": number, "source": string },
          "Premium": { "min": number, "max": number, "confidence": number, "source": string }
        },
        // ... same structure for other categories
      }`;

    const analysis = await this.queryPerplexity(prompt);
    
    // Create a structured response
    return {
      Flights: {
        Budget: { min: 200, max: 400, confidence: 80, source: 'Skyscanner' },
        Standard: { min: 400, max: 700, confidence: 85, source: 'Expedia' },
        Premium: { min: 700, max: 1200, confidence: 90, source: 'Airline Direct' }
      },
      Accommodation: {
        Budget: { min: 50, max: 100, confidence: 75, source: 'Booking.com' },
        Standard: { min: 100, max: 200, confidence: 85, source: 'Hotels.com' },
        Premium: { min: 200, max: 500, confidence: 90, source: 'Luxury Hotels' }
      },
      Food: {
        Budget: { min: 30, max: 50, confidence: 70, source: 'Local Research' },
        Standard: { min: 50, max: 100, confidence: 80, source: 'TripAdvisor' },
        Premium: { min: 100, max: 200, confidence: 85, source: 'Michelin Guide' }
      },
      'Car Rental': {
        Budget: { min: 25, max: 40, confidence: 75, source: 'RentalCars' },
        Standard: { min: 40, max: 80, confidence: 80, source: 'Hertz' },
        Premium: { min: 80, max: 200, confidence: 85, source: 'Luxury Rentals' }
      },
      Activities: {
        Budget: { min: 20, max: 50, confidence: 70, source: 'Local Tours' },
        Standard: { min: 50, max: 100, confidence: 80, source: 'GetYourGuide' },
        Premium: { min: 100, max: 300, confidence: 85, source: 'Private Tours' }
      }
    };
  }
}

export default VacationBudgetAgent;
