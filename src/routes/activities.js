import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

interface ActivityPlanRequest {
  destination: string;
  startDate: string;
  endDate: string;
  budgetTiers: {
    budget: number;
    medium: number;
    premium: number;
  };
  currency: string;
}

interface Activity {
  name: string;
  description: string;
  price: number;
  duration: string;
  category: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generatePrompt = (destination: string, budget: number, currency: string, tier: string) => {
  return `Generate a detailed itinerary of activities for ${destination} with a total budget of ${budget} ${currency} for the ${tier} tier.
Each activity should include:
- A specific name
- A brief description
- An estimated price in ${currency}
- Approximate duration
- Activity category (e.g., Sightseeing, Adventure, Cultural, etc.)

The activities should be appropriate for the tier level:
- Budget tier: Focus on free/low-cost activities, walking tours, public transport, street food
- Medium tier: Mix of popular attractions, guided tours, mid-range restaurants
- Premium tier: VIP experiences, private tours, luxury dining, exclusive access

Format the response as a JSON array of activities, each with the following structure:
{
  "name": "Activity name",
  "description": "Brief description",
  "price": number,
  "duration": "X hours/days",
  "category": "Category"
}

Ensure the total cost of all activities is within the specified budget of ${budget} ${currency}.`;
};

router.post('/generate', async (req, res) => {
  try {
    const { destination, startDate, endDate, budgetTiers, currency }: ActivityPlanRequest = req.body;

    // Calculate duration in days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const durationInDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    // Generate activities for each tier
    const tiers = ['budget', 'medium', 'premium'] as const;
    const activities: Record<string, Activity[]> = {};

    for (const tier of tiers) {
      const budget = budgetTiers[tier];
      const prompt = generatePrompt(destination, budget, currency, tier);

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a travel planning assistant that generates detailed activity itineraries."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('Failed to generate activities');
      }

      try {
        const parsedActivities = JSON.parse(response);
        activities[tier] = parsedActivities;
      } catch (error) {
        console.error('Error parsing activities:', error);
        throw new Error('Failed to parse generated activities');
      }
    }

    res.json(activities);
  } catch (error) {
    console.error('Error generating activities:', error);
    res.status(500).json({ error: 'Failed to generate activities' });
  }
});

export default router; 