import { Router } from 'express';
const router = Router();
router.post('/', async (req, res) => {
    try {
        const { query, model, messages } = req.body;
        if (!process.env.PERPLEXITY_API_KEY) {
            throw new Error('Perplexity API key not configured');
        }
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
            },
            body: JSON.stringify({
                model: model || 'llama-3.1-sonar-small-128k-online',
                messages: messages || [
                    {
                        role: 'system',
                        content: `You are a helpful assistant that provides detailed travel itineraries and activity suggestions.`
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ]
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Perplexity API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            throw new Error(`Perplexity API error: ${response.statusText}`);
        }
        const data = await response.json();
        // Extract the response content
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('Invalid response format from Perplexity API');
        }
        // Return the response in a consistent format
        res.json({
            output: content,
            model: data.model || model || 'unknown',
            created: data.created || Date.now()
        });
    }
    catch (error) {
        console.error('Error calling Perplexity API:', error);
        res.status(500).json({
            error: 'Failed to query Perplexity API',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
export default router;
//# sourceMappingURL=perplexity.js.map