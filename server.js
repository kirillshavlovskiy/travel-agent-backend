import express from 'express';
import cors from 'cors';
import VacationBudgetAgent from './services/agents.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const agent = new VacationBudgetAgent();

app.post('/calculate-budget', (req, res) => agent.handleTravelRequest(req, res));

app.get('/test-perplexity', async (req, res) => {
  const agent = new VacationBudgetAgent();
  try {
    const response = await agent.queryPerplexity('What is the best time to visit Paris?');
    res.json(response);
  } catch (error) {
    console.error('Perplexity API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// Take basic travel inputs (departure, destination, dates, travelers, budget)
// Generate 3 price tiers for each category (budget, standard, premium)
// Calculate accurate price ranges with median values
// Provide confidence levels for each suggestion