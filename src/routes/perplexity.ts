import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  PerplexityApiResponse,
  PerplexityErrorResponse,
  PerplexityRequest,
  PerplexityRequestMessage
} from '../types/perplexity';

const router = Router();

const DEFAULT_SYSTEM_MESSAGE = `You are a travel activity planner. CRITICAL INSTRUCTIONS:
1. You MUST return ONLY a valid JSON object
2. DO NOT include any markdown, headings, or explanatory text
3. DO NOT wrap the response in code blocks
4. The response must be a raw JSON object following this EXACT structure:
{
  "activities": [
    {
      "name": "Example Activity",
      "description": "Brief description",
      "duration": 2,
      "price": { "amount": 50, "currency": "USD" },
      "category": "Cultural",
      "location": "Example Location, Address",
      "timeSlot": "morning",
      "dayNumber": 1,
      "rating": 4,
      "isVerified": false,
      "verificationStatus": "pending",
      "tier": "medium"
    }
  ],
  "dailyPlans": [
    {
      "dayNumber": 1,
      "theme": "Example Theme",
      "mainArea": "Example Area",
      "commentary": "Brief commentary",
      "highlights": ["highlight 1", "highlight 2"],
      "logistics": {
        "transportSuggestions": ["suggestion 1"],
        "walkingDistances": ["distance 1"],
        "timeEstimates": ["estimate 1"]
      }
    }
  ]
}`;

router.post('/', async (req: Request, res: Response) => {
  try {
    const { query, model = 'llama-3.1-sonar-small-128k-online', messages } = req.body;

    if (!process.env.PERPLEXITY_API_KEY) {
      logger.error('[Perplexity] API key not configured');
      return res.status(500).json({ 
        error: 'Perplexity API key not configured',
        timestamp: new Date().toISOString()
      });
    }

    if (!query) {
      return res.status(400).json({
        error: 'Query is required',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('[Perplexity] Making API request:', {
      model,
      queryLength: query?.length,
      hasMessages: !!messages
    });

    const defaultMessages: PerplexityRequestMessage[] = [
      {
        role: 'system',
        content: DEFAULT_SYSTEM_MESSAGE
      },
      {
        role: 'user',
        content: `${query}\n\nCRITICAL: Your response MUST be a raw JSON object. DO NOT include any markdown, text explanations, or code blocks. The response should start with '{' and end with '}'.`
      }
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const startTime = Date.now();
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: messages || defaultMessages,
          temperature: 0.1
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[Perplexity] API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        return res.status(response.status).json({
          error: 'Perplexity API error',
          details: errorText,
          timestamp: new Date().toISOString()
        });
      }

      const data = await response.json();
      
      logger.debug('[Perplexity] Raw response data:', {
        rawData: JSON.stringify(data, null, 2),
        id: data.id,
        model: data.model,
        created: data.created,
        choicesCount: data.choices?.length
      });

      logger.debug('[Perplexity] Received response:', {
        status: response.status,
        statusText: response.statusText,
        duration: `${Date.now() - startTime}ms`,
        hasChoices: !!data.choices,
        choiceCount: data.choices?.length,
        responseSize: JSON.stringify(data).length,
        model: data.model,
        created: data.created
      });

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        logger.error('[Perplexity] Invalid response format - missing content');
        return res.status(500).json({
          error: 'Invalid response format from Perplexity API - missing content',
          timestamp: new Date().toISOString()
        });
      }

      logger.debug('[Perplexity] Raw message content:', {
        content,
        contentLength: content.length,
        firstChars: content.substring(0, 100),
        lastChars: content.substring(content.length - 100)
      });

      // Clean the content to ensure it's valid JSON
      const cleanedContent = content.trim()
        .replace(/^```json\s*/, '') // Remove JSON code block start
        .replace(/\s*```$/, '')     // Remove JSON code block end
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
        .trim();

      logger.debug('[Perplexity] Cleaned response content:', {
        originalLength: content.length,
        cleanedLength: cleanedContent.length,
        isJsonLike: cleanedContent.startsWith('{') && cleanedContent.endsWith('}')
      });

      try {
        const parsedContent = JSON.parse(cleanedContent);
        
        // Validate required structure
        if (!parsedContent.activities || !Array.isArray(parsedContent.activities)) {
          logger.error('[Perplexity] Invalid activity structure:', {
            hasActivities: !!parsedContent.activities,
            isArray: Array.isArray(parsedContent.activities),
            keys: Object.keys(parsedContent)
          });
          return res.status(500).json({
            error: 'Invalid activity structure - missing required fields',
            timestamp: new Date().toISOString()
          });
        }

        logger.info('[Perplexity] Request successful:', {
          duration: `${Date.now() - startTime}ms`,
          activityCount: parsedContent.activities.length,
          dailyPlansCount: parsedContent.dailyPlans?.length
        });

        return res.json({
          output: parsedContent,
          model: data.model || model,
          created: data.created || Date.now(),
          timestamp: new Date().toISOString()
        });

      } catch (parseError) {
        logger.error('[Perplexity] Failed to parse JSON response:', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error',
          content: cleanedContent.substring(0, 1000) + '...'
        });
        return res.status(500).json({
          error: 'Failed to parse Perplexity response',
          details: parseError instanceof Error ? parseError.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('[Perplexity] Request timed out');
        return res.status(504).json({
          error: 'Gateway Timeout',
          message: 'Request took too long to process',
          timestamp: new Date().toISOString()
        });
      }
      throw error;
    }

  } catch (error) {
    logger.error('[Perplexity] Error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return res.status(500).json({
      error: 'Failed to query Perplexity API',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router; 