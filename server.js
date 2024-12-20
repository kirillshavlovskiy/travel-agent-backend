import express from 'express';
import cors from 'cors';
import VacationBudgetAgent from './services/agents.js';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS with more permissive options for development
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const agent = new VacationBudgetAgent();

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  
  // Add CORS headers explicitly
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Capture the response
  const oldSend = res.send;
  res.send = function(data) {
    console.log('Response data:', data);
    oldSend.apply(res, arguments);
  };
  
  next();
});

// Route for flight search
app.post('/search-flights', async (req, res) => {
  try {
    console.log('Received flight search request:', req.body);
    req.query.type = 'flights';
    return await agent.handleTravelRequest(req, res);
  } catch (error) {
    console.error('Error in flight search:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Route for hotel search
app.post('/search-hotels', async (req, res) => {
  try {
    console.log('Received hotel search request:', req.body);
    req.query.type = 'hotels';
    return await agent.handleTravelRequest(req, res);
  } catch (error) {
    console.error('Error in hotel search:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Combined search (legacy support)
app.post('/calculate-budget', async (req, res) => {
  try {
    console.log('Received calculate budget request:', req.body);
    req.query.type = 'full';
    return await agent.handleTravelRequest(req, res);
  } catch (error) {
    console.error('Error in budget calculation:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    perplexityApiKey: !!process.env.PERPLEXITY_API_KEY
  });
});

// Test endpoint for Perplexity
app.get('/test-perplexity', async (req, res) => {
  try {
    const response = await agent.queryPerplexity('What is the best time to visit Paris?');
    console.log('Perplexity test response:', response);
    res.json(response);
  } catch (error) {
    console.error('Perplexity API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Perplexity API proxy endpoint
app.post('/api/perplexity', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log('[Perplexity] Sending request:', query);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`
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
            content: query
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Perplexity] API error:', errorText);
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[Perplexity] Raw response:', data);

    res.json({
      success: true,
      result: data.choices[0].message.content
    });
  } catch (error) {
    console.error('[Perplexity] Request failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch from Perplexity API'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    timestamp: new Date().toISOString()
  });
});

// Start server with error handling
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log('Perplexity API Key status:', !!process.env.PERPLEXITY_API_KEY);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please try a different port or kill the process using this port.`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});


// Take basic travel inputs (departure, destination, dates, travelers, budget)
// Generate 3 price tiers for each category (budget, standard, premium)
// Calculate accurate price ranges with median values
// Provide confidence levels for each suggestion