import axios from 'axios';
export class PerplexityService {
    constructor() {
        this.apiKey = process.env.PERPLEXITY_API_KEY || '';
        this.baseUrl = 'https://api.perplexity.ai';
    }
    async chat(query) {
        try {
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: 'llama-3.1-sonar-small-128k-online',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that provides detailed information about places and activities in JSON format.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        }
        catch (error) {
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
    async getEnrichedDetails(query) {
        try {
            if (!this.apiKey) {
                throw new Error('Perplexity API key is not configured');
            }
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: 'llama-3.1-sonar-small-128k-online',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that provides detailed information about places and activities. Please include relevant images, addresses, descriptions, and other useful details in your responses.'
                    },
                    {
                        role: 'user',
                        content: `Please provide detailed information about ${query} including:
              1. A brief description
              2. The exact address
              3. Key highlights or features
              4. Opening hours if applicable
              5. Relevant high-quality images (provide URLs)
              6. Ratings and reviews if available
              
              Format the response as a JSON object with these fields: description, address, highlights (array), openingHours, images (array of URLs), rating, reviews`
                    }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            // Parse the response text as JSON
            const content = response.data.choices[0].message.content;
            try {
                return JSON.parse(content);
            }
            catch (e) {
                // If parsing fails, return a structured response with just the text
                return {
                    text: content
                };
            }
        }
        catch (error) {
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
//# sourceMappingURL=perplexity.js.map