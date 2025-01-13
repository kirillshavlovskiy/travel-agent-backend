class PerplexityClient {
    constructor() {
        this.baseUrl = 'https://api.perplexity.ai';
        const apiKey = process.env.PERPLEXITY_API_KEY;
        if (!apiKey) {
            throw new Error('PERPLEXITY_API_KEY environment variable is not set');
        }
        this.apiKey = apiKey;
    }
    async chat(query) {
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-sonar-small-128k-online',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a helpful assistant that provides detailed travel itineraries and activity suggestions.

CRITICAL FORMATTING RULES:
1. You MUST return ONLY a valid JSON object, nothing else
2. The response MUST start with { and end with }
3. The JSON MUST have an "activities" array as its root property
4. Each activity MUST have these EXACT fields:
   - "name": string (activity name)
   - "description": string (brief description)
   - "duration": number (length in hours)
   - "price": number (exact price, no ranges)
   - "category": string (one of: "Sightseeing", "Cultural", "Entertainment", "Local Experience")
   - "location": string (specific area within the city)
   - "rating": number (between 1-5)
   - "timeOfDay": string (one of: "Morning", "Afternoon", "Evening", "Any")
   - "referenceUrl": string (direct booking link or official website URL)

5. DO NOT include any explanatory text, markdown, or other content outside the JSON object
6. Ensure all JSON values are properly escaped
7. Use double quotes for all strings
8. Use numbers without quotes for numeric values
9. DO NOT use trailing commas
10. DO NOT include any comments or explanations
11. Ensure all URLs are properly formatted and escaped
12. DO NOT use any special characters that would need escaping in strings

Example of correct format:
{
  "activities": [
    {
      "name": "Sagrada Familia Tour",
      "description": "Guided tour of Gaudi's masterpiece",
      "duration": 2,
      "price": 35.50,
      "category": "Cultural",
      "location": "Carrer de Mallorca, 401",
      "rating": 4.8,
      "timeOfDay": "Morning",
      "referenceUrl": "https://sagradafamilia.org/en/tickets"
    }
  ]
}`
                        },
                        {
                            role: 'user',
                            content: query
                        }
                    ]
                })
            });
            if (!response.ok) {
                throw new Error(`Perplexity API error: ${response.statusText}`);
            }
            const data = await response.json();
            return data;
        }
        catch (error) {
            console.error('[Perplexity Service] Error:', error);
            throw error;
        }
    }
}
export const perplexityClient = new PerplexityClient();
//# sourceMappingURL=perplexity.js.map