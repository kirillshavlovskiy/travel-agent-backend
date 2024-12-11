# Travel Budget Calculator Backend

Node.js/Express backend service for the Travel Budget Calculator application, featuring integration with Perplexity API for intelligent budget analysis.

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Perplexity API key

## Running Locally

1. Clone the repository (create separate folder called "backend"):
bash
git clone <repository-url>

2. Install dependencies:
bash
npm install

3. Create a `.env` file in the backend root directory with:
PORT=3000
PERPLEXITY_API_KEY=your_api_key_here
4. Replace `your_api_key_here` with your actual Perplexity API key (get one at https://www.perplexity.ai/api)

5. Start the development server:
bash
npm start

The server will run on http://localhost:3000

6. Test that it's working by visiting:
- http://localhost:3000/test-perplexity (should return JSON response)

## Project Structure
backend/
├── services/ # Business logic
│ ├── agents.js # Perplexity API integration
│ └── priceController.js
├── server.js # Express server setup
└── .env # Environment variables

## API Endpoints

### POST /calculate-budget
Calculates travel budget based on input parameters.

Request body:
json
{
"departure": "string",
"destination": "string",
"dates": "string",
"travelers": "number",
"budget": "number"
}

Response format:
json
{
"Flights": {
"Budget": { "min": "number", "max": "number", "confidence": "number", "source": "string" },
"Standard": { "min": "number", "max": "number", "confidence": "number", "source": "string" },
"Premium": { "min": "number", "max": "number", "confidence": "number", "source": "string" }
},
"Accommodation": {...},
"Food": {...},
"CarRental": {...},
"Activities": {...}
}

### GET /test-perplexity
Test endpoint for Perplexity API connection.

## Troubleshooting

1. If you get a PORT already in use error:
   - Kill the process using the port: `kill $(lsof -t -i:3000)`
   - Or change the PORT in .env file

2. If you get "Invalid API Key":
   - Make sure your PERPLEXITY_API_KEY in .env is correct
   - Check that .env file is in the root backend directory
   - Try recreating your API key at Perplexity website

3. If nodemon isn't working:
   - Install it globally: `npm install -g nodemon`
   - Or use: `node server.js` instead of `npm start`

## Production Deployment

The backend is deployed at: https://your-app-name.railway.app

To deploy your own instance:
1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Initialize: `railway init`
4. Deploy: `railway up`

## Environment Variables

Required environment variables:
- `PORT`: Server port (default 3000)
- `PERPLEXITY_API_KEY`: Your Perplexity API key

Optional environment variables:
- `NODE_ENV`: Set to "production" in production environment
