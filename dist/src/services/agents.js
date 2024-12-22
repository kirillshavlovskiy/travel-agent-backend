import fetch from 'node-fetch';
class VacationBudgetAgent {
    async fetchWithRetry(url, options, retries = 3) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                return response;
            }
            catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
            }
        }
        throw lastError || new Error('Failed to fetch after retries');
    }
    async queryPerplexity(prompt) {
        try {
            const response = await this.fetchWithRetry('https://api.perplexity.ai/chat/completions', {
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
            });
            if (!response.ok) {
                throw new Error(`Perplexity API error: ${response.statusText || 'Unknown error'}`);
            }
            const data = await response.json();
            return data.choices[0].message.content;
        }
        catch (error) {
            console.error('Error querying Perplexity:', error);
            throw error;
        }
    }
    async handleTravelRequest(req, res) {
        try {
            const travelRequest = req.body;
            const requestType = req.query.type;
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
        }
        catch (error) {
            console.error('Error handling travel request:', error);
            const errorMessage = error instanceof Error ? error.message : 'Internal server error';
            res.status(500).json({
                success: false,
                error: errorMessage,
                timestamp: new Date().toISOString()
            });
        }
    }
    constructFlightPrompt(request) {
        return `Find flight options from ${request.departure} to ${request.destination} for ${request.travelers} travelers, 
    departing on ${request.dates.start} and returning on ${request.dates.end}. 
    ${request.budget ? `The budget is ${request.budget} USD.` : ''} 
    Provide options in JSON format with economy, business, and first class prices.`;
    }
    constructHotelPrompt(request) {
        return `Find hotel options in ${request.destination} for ${request.travelers} travelers, 
    checking in on ${request.dates.start} and checking out on ${request.dates.end}. 
    ${request.budget ? `The budget is ${request.budget} USD.` : ''} 
    Provide options in JSON format with budget, mid-range, and luxury accommodations.`;
    }
    constructFullPrompt(request) {
        return `Create a complete travel budget for a trip from ${request.departure} to ${request.destination} 
    for ${request.travelers} travelers, from ${request.dates.start} to ${request.dates.end}. 
    ${request.budget ? `The total budget is ${request.budget} USD.` : ''} 
    Include flights, hotels, local transportation, food, and activities in JSON format with budget, mid-range, and luxury options.`;
    }
}
export { VacationBudgetAgent as default };
