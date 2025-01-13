import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// Constants for categories and tiers
const DEFAULT_EXPENSE_CATEGORIES = [
  { key: 'flight', name: 'Flight', defaultPercentage: 25 },
  { key: 'accommodation', name: 'Accommodation', defaultPercentage: 25 },
  { key: 'localTransportation', name: 'Local Transportation', defaultPercentage: 10 },
  { key: 'carRental', name: 'Car Rental', defaultPercentage: 10 },
  { key: 'food', name: 'Food', defaultPercentage: 10 },
  { key: 'activities', name: 'Activities', defaultPercentage: 8 },
  { key: 'culturalEvents', name: 'Cultural Events', defaultPercentage: 7 },
  { key: 'shopping', name: 'Shopping', defaultPercentage: 5 }
];

const API_URL = 'https://api.perplexity.ai/chat/completions';

class VacationBudgetAgent {
  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY;
    if (!this.apiKey) {
      console.warn('Warning: PERPLEXITY_API_KEY is not set in environment variables');
    }
  }

  async queryPerplexity(query) {
    try {
      console.log('Querying Perplexity with:', query);
      
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [{ role: 'user', content: query }]
        })
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Perplexity response:', data);
      
      return data;
    } catch (error) {
      console.error('Error querying Perplexity:', error);
      throw error;
    }
  }

  // Helper function to clean JSON response
  cleanJsonResponse(content) {
    console.log('[Perplexity] Cleaning JSON response:', content);
    
    // Remove markdown code blocks
    let cleaned = content.replace(/```json\n|\n```/g, '');
    
    // Extract just the JSON object if there's surrounding text
    const jsonMatch = cleaned.match(/({[\s\S]*})/);
    if (jsonMatch) {
      cleaned = jsonMatch[1];
    }

    console.log('[Perplexity] Cleaned JSON:', cleaned);
    return cleaned;
  }

  // Process a single category
  async processCategory(category, params) {
    console.log(`[${category.toUpperCase()}] Generating prompt`);
    const prompt = category === 'flight' && params.departureLocation
      ? this.generateFlightPrompt({ ...params, selectedCategories: [category] })
      : this.generateGeneralPrompt({ ...params, selectedCategories: [category] });

    console.log(`[${category.toUpperCase()}] Making API request`);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-small-128k-online",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that provides accurate travel cost estimates in JSON format."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${category.toUpperCase()}] API error:`, errorText);
      throw new Error(`API error for ${category}: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[${category.toUpperCase()}] Raw API response:`, data.choices[0].message.content);

    const cleanedContent = this.cleanJsonResponse(data.choices[0].message.content);
    console.log(`[${category.toUpperCase()}] Attempting to parse:`, cleanedContent);

    try {
      const parsedData = JSON.parse(cleanedContent);
      console.log(`[${category.toUpperCase()}] Successfully parsed JSON:`, parsedData);

      return {
        budget: this.normalizeTier(parsedData[category]?.budget || parsedData.budget, category),
        medium: this.normalizeTier(parsedData[category]?.medium || parsedData.medium, category),
        premium: this.normalizeTier(parsedData[category]?.premium || parsedData.premium, category)
      };
    } catch (parseError) {
      console.error(`[${category.toUpperCase()}] JSON parse error:`, parseError);
      console.error(`[${category.toUpperCase()}] Failed content:`, cleanedContent);
      throw new Error(`Failed to parse response for ${category}: ${parseError.message}`);
    }
  }

  // Normalize tier data
  normalizeTier(tier, category) {
    if (!tier || typeof tier !== 'object') {
      console.log('[Perplexity] Invalid tier data:', tier);
      return {
        min: 0,
        max: 0,
        average: 0,
        confidence: 0.7,
        source: 'default',
        references: []
      };
    }

    console.log(`[Perplexity] Normalizing ${category} tier:`, JSON.stringify(tier, null, 2));

    const min = Number(tier.Minimum || tier.min || 0);
    const max = Number(tier.Maximum || tier.max || 0);
    const average = Number(tier.Average || tier.average || 0);
    const confidence = Number(tier.Confidence || tier.confidence || 0.7);

    const references = Array.isArray(tier.Examples || tier.References || tier.references) 
      ? (tier.Examples || tier.References || tier.references).map(ref => {
          if (typeof ref === 'string') {
            const urlMatch = ref.match(/https?:\/\/[^\s]+/);
            return {
              provider: 'Unknown',
              details: ref.replace(urlMatch?.[0] || '', '').trim() || ref,
              price: 0,
              link: urlMatch?.[0] || null
            };
          }

          let details = ref.details || ref.description || '';
          let link = ref.link || null;
          
          if (!link) {
            const urlMatch = details.match(/https?:\/\/[^\s]+/);
            if (urlMatch) {
              link = urlMatch[0];
              details = details.replace(urlMatch[0], '').trim();
            }
          }

          const baseRef = {
            provider: ref.provider || ref.airline || 'Unknown',
            details: details,
            price: Number(ref.price || ref.totalPrice || 0),
            link: link,
            ...ref
          };

          if (category === 'flight') {
            return {
              ...baseRef,
              airline: ref.airline || baseRef.provider,
              outbound: ref.outbound || ref.outboundFlight || '',
              inbound: ref.inbound || ref.inboundFlight || null,
              outboundDate: ref.outboundDate || null,
              inboundDate: ref.inboundDate || null,
              layovers: Number(ref.layovers || 0),
              duration: ref.duration || null,
              baggage: ref.baggage || null,
              class: ref.class || null
            };
          }

          return baseRef;
        })
      : [];

    return {
      min,
      max,
      average,
      confidence,
      source: tier.Source || tier.source || 'default',
      references
    };
  }

  // Generate prompt for general categories
  generateGeneralPrompt(params) {
    const categoryList = params.selectedCategories.map(cat => `"${cat}"`).join(', ');
    
    return `Search for current daily costs in ${params.country} for ${params.travelers} travelers.
    Return a JSON object with estimates for these categories: ${categoryList}
    
    For each category, provide real prices from ${params.country} cities and tourist areas.
    Include specific examples from major ${params.country} destinations.
    All costs must be in ${params.currency}.
    
    Use this exact JSON structure for each category:
    {
      "category_name": {
        "searchDetails": {
          "location": "${params.country}",
          "travelers": ${params.travelers},
          "currency": "${params.currency}"
        },
        "budget": {
          "min": number,
          "max": number,
          "average": number,
          "confidence": number (between 0-1),
          "source": "string",
          "references": [
            {
              "provider": "string (actual provider name)",
              "details": "string (specific details)",
              "price": number,
              "link": "string (optional URL)"
            }
          ]
        },
        "medium": { same structure },
        "premium": { same structure }
      }
    }

    Return ONLY the JSON object, no additional text.`;
  }

  // Generate prompt for flight searches
  generateFlightPrompt(params) {
    const departureLocation = params.departureLocation;
    const flightType = departureLocation?.isRoundTrip ? 'round-trip' : 'one-way';

    return `Search for current flight prices from ${departureLocation?.name} to ${params.country}.
    Return a JSON object with flight estimates.
    
    Consider these details:
    - Departure: ${departureLocation?.name}
    - Destination: ${params.country}
    - Type: ${flightType} flight
    - Dates: ${departureLocation?.outboundDate ? `Outbound on ${departureLocation.outboundDate}` : 'Flexible'}
    - Travelers: ${params.travelers}
    - Currency: ${params.currency}

    Use this exact JSON structure:
    {
      "flight": {
        "searchDetails": {
          "from": "${departureLocation?.name}",
          "to": "${params.country}",
          "type": "${flightType}",
          "dates": {
            "outbound": "${departureLocation?.outboundDate || 'flexible'}",
            "inbound": "${departureLocation?.inboundDate || 'N/A'}"
          },
          "travelers": ${params.travelers}
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
              "duration": "string",
              "layovers": number
            }
          ]
        },
        "medium": { same structure },
        "premium": { same structure }
      }
    }

    Return ONLY the JSON object, no additional text.`;
  }

  async handleTravelRequest(req, res) {
    try {
      const { type } = req.query;
      const requestData = req.body;

      console.log('Processing travel request:', {
        type,
        requestData: {
          ...requestData,
          apiKey: '[REDACTED]'
        }
      });

      let result;
      switch (type) {
        case 'flights':
          result = await this.processCategory('flight', requestData);
          break;
        case 'hotels':
          result = await this.processCategory('accommodation', requestData);
          break;
        case 'full':
          const flightResults = await this.processCategory('flight', requestData);
          const hotelResults = await this.processCategory('accommodation', requestData);
          result = {
            flights: flightResults,
            hotels: hotelResults
          };
          break;
        default:
          throw new Error('Invalid request type');
      }

      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error processing travel request:', error);
      return res.status(error.status || 500).json({
        success: false,
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }
}

export default VacationBudgetAgent;
