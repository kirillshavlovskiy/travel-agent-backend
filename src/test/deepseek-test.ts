import axios, { AxiosError } from 'axios';
import { config } from 'dotenv';
import { logger } from '../utils/logger.js';

// Load environment variables
config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = 'https://api.deepseek.com/chat/completions';

interface ValidationError {
  message: string;
  day: number;
  mealIndex?: number;
  type: 'meal' | 'evening';
}

async function testDeepSeekFoodItinerary() {
  try {
    logger.info('Testing DeepSeek food itinerary search...');
    
    const response = await axios.post(
      BASE_URL,
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a local food expert who creates detailed food itineraries. Search the internet to find real, currently operating restaurants, cafes, bars, and street food locations.

CRITICAL RULES:
1. Only recommend places that you can verify are currently operating
2. MUST include TripAdvisor links for each place
3. Organize recommendations by time of day (breakfast, lunch, dinner, snacks)
4. Include mix of dining styles (fine dining, casual, street food)
5. Verify all information is current and accurate
6. Return response in a structured JSON format

Return ONLY a valid JSON object without any explanatory text, following this structure:
{
  "dayPlans": [
    {
      "day": 1,
      "meals": [
        {
          "type": "breakfast" | "lunch" | "dinner" | "snack",
          "timeSlot": "time range (e.g., 8:00-10:00)",
          "venue": {
            "name": "Full venue name",
            "type": "restaurant" | "cafe" | "bar" | "street_food" | "market",
            "cuisine": "Type of cuisine",
            "priceRange": "$" to "$$$$",
            "address": "Complete street address",
            "neighborhood": "Area/district name",
            "mustTry": ["dish1", "dish2"],
            "openingHours": "Detailed hours for this day",
            "tripAdvisorUrl": "REQUIRED: Full TripAdvisor URL",
            "rating": {
              "tripAdvisor": "x.x/5.0",
              "numberOfReviews": number
            },
            "reservationRequired": boolean,
            "reservationUrl": "booking URL if available",
            "tips": ["local tip 1", "local tip 2"]
          }
        }
      ],
      "eveningEntertainment": {
        "name": "Optional evening venue",
        "type": "bar" | "lounge" | "beer_garden",
        "specialty": "What's special about this place",
        "tripAdvisorUrl": "REQUIRED: Full TripAdvisor URL",
        "bestTimeToVisit": "Recommended time slot"
      }
    }
  ],
  "localTips": [
    "General food scene tip 1",
    "General food scene tip 2"
  ]
}`
          },
          {
            role: 'user',
            content: 'Create a 2-day food itinerary for Berlin, Germany focusing on a mix of traditional German cuisine and modern food scene. Include both high-end restaurants and authentic street food. Budget is flexible but should include options in different price ranges.'
          }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('DeepSeek API Response Status:', response.status);
    logger.info('DeepSeek API Response Headers:', response.headers);

    // Try to parse the restaurant data
    const content = response.data.choices[0].message.content;
    try {
      const parsedContent = JSON.parse(content);
      logger.info('Successfully parsed food itinerary:', JSON.stringify(parsedContent, null, 2));
      
      // Validate TripAdvisor URLs
      const validationErrors: string[] = [];
      parsedContent.dayPlans.forEach((day: any, dayIndex: number) => {
        day.meals.forEach((meal: any, mealIndex: number) => {
          if (!meal.venue.tripAdvisorUrl?.includes('tripadvisor.com')) {
            validationErrors.push(`Day ${dayIndex + 1}, Meal ${mealIndex + 1}: Missing or invalid TripAdvisor URL`);
          }
        });
        if (day.eveningEntertainment && !day.eveningEntertainment.tripAdvisorUrl?.includes('tripadvisor.com')) {
          validationErrors.push(`Day ${dayIndex + 1}, Evening: Missing or invalid TripAdvisor URL`);
        }
      });

      if (validationErrors.length > 0) {
        logger.warn('Validation errors found:', validationErrors);
      } else {
        logger.info('All TripAdvisor URLs validated successfully');
      }

    } catch (parseError) {
      logger.error('Failed to parse food itinerary data:', parseError);
      if (content) {
        logger.error('Raw content that failed to parse:', content);
      }
    }

  } catch (error) {
    if (error instanceof AxiosError) {
      logger.error('DeepSeek API test failed:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      if (error.response?.data) {
        logger.error('Error response data:', error.response.data);
      }
    } else {
      logger.error('DeepSeek API test failed:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorObject: error
      });
    }
  }
}

// Run the test
testDeepSeekFoodItinerary(); 