/* 
  services/ratings/fetchBusinessRatings.js
  Adding minimum rating threshold functionality
*/

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Constants
const MINIMUM_ACCEPTABLE_RATING = 3.0;

// Load environment variables (unchanged)
const {
  AMADEUS_API_KEY,
  AMADEUS_API_SECRET,
  TRIPADVISOR_API_KEY,
  TRUSTPILOT_API_KEY
} = process.env;

/**
 * Check if rating meets minimum threshold
 */
function isRatingAcceptable(rating) {
  return rating !== null && parseFloat(rating) >= MINIMUM_ACCEPTABLE_RATING;
}

/**
 * Fetch and validate rating from Amadeus
 */
async function fetchFromAmadeus(businessName, businessType) {
  try {
    const token = await getAmadeusToken();
    if (!token) return null;

    const headers = {
      'Authorization': `Bearer ${token}`
    };

    let endpoint;
    switch(businessType) {
      case 'hotel':
        endpoint = '/v3/reference-data/locations/hotels';
        break;
      case 'airline':
        endpoint = '/v1/reference-data/airlines';
        break;
      case 'restaurant':
        return null;
      default:
        return null;
    }

    const response = await axios.get(`https://test.api.amadeus.com${endpoint}`, {
      headers,
      params: {
        keyword: businessName
      }
    });

    const rating = response.data.rating || null;
    return isRatingAcceptable(rating) ? rating : null;
  } catch (error) {
    console.error('Error fetching from Amadeus:', error.message);
    return null;
  }
}

/**
 * Fetch and validate rating from Tripadvisor
 */
async function fetchFromTripadvisor(businessName, businessType) {
  try {
    // Check cache first
    const existingReference = await prisma[`${businessType}Reference`].findFirst({
      where: {
        name: businessName
      },
      include: {
        perplexityReference: true
      }
    });

    if (existingReference?.perplexityReference?.details) {
      const cachedRating = parseFloat(existingReference.perplexityReference.details);
      return isRatingAcceptable(cachedRating) ? cachedRating : null;
    }

    // If no cached rating, fetch from Tripadvisor API
    const response = await axios.get(`https://api.tripadvisor.com/data/v1/${businessType}s`, {
      params: {
        key: TRIPADVISOR_API_KEY,
        q: businessName
      }
    });

    const rating = response.data.rating || null;
    return isRatingAcceptable(rating) ? rating : null;
  } catch (error) {
    console.error('Error fetching from Tripadvisor:', error.message);
    return null;
  }
}

/**
 * Fetch and validate rating from Trustpilot
 */
async function fetchFromTrustpilot(airlineName) {
  try {
    // Check cache first
    const existingReference = await prisma.flightReference.findFirst({
      where: {
        airline: airlineName
      },
      include: {
        perplexityReference: true
      }
    });

    if (existingReference?.perplexityReference?.details) {
      const cachedRating = parseFloat(existingReference.perplexityReference.details);
      return isRatingAcceptable(cachedRating) ? cachedRating : null;
    }

    // If no cached rating, fetch from Trustpilot API
    const response = await axios.get('https://api.trustpilot.com/v1/business-units/find', {
      headers: {
        'ApiKey': TRUSTPILOT_API_KEY
      },
      params: {
        name: airlineName
      }
    });

    const rating = response.data.stars || null;
    return isRatingAcceptable(rating) ? rating : null;
  } catch (error) {
    console.error('Error fetching from Trustpilot:', error.message);
    return null;
  }
}

/**
 * Main function to fetch ratings with validation
 */
async function fetchRatingForBusiness(businessName, businessType) {
  // Try Amadeus first
  const amadeusRating = await fetchFromAmadeus(businessName, businessType);
  if (amadeusRating !== null) {
    await storeRating(businessName, businessType, 'amadeus', amadeusRating);
    return {
      rating: amadeusRating,
      isAcceptable: true,
      source: 'amadeus'
    };
  }

  // Try fallback sources
  let rating = null;
  let source = null;

  if (businessType === 'hotel' || businessType === 'restaurant') {
    rating = await fetchFromTripadvisor(businessName, businessType);
    source = 'tripadvisor';
  } else if (businessType === 'airline') {
    rating = await fetchFromTrustpilot(businessName);
    source = 'trustpilot';
  }

  if (rating !== null) {
    await storeRating(businessName, businessType, source, rating);
    return {
      rating: rating,
      isAcceptable: true,
      source: source
    };
  }

  return {
    rating: null,
    isAcceptable: false,
    source: null
  };
}

/**
 * Helper function to store ratings in database (unchanged)
 */
async function storeRating(businessName, businessType, provider, rating) {
  try {
    await prisma.perplexityReference.create({
      data: {
        category: businessType,
        provider: provider,
        details: rating.toString(),
        price: 0,
        overview: `Rating for ${businessName}`,
        estimateHistory: {
          create: {
            category: businessType,
            estimates: { rating }
          }
        }
      }
    });
  } catch (error) {
    console.error('Error storing rating:', error.message);
  }
}

/**
 * New function to validate a business before proposing it
 */
async function isBusinessProposable(businessName, businessType) {
  const ratingInfo = await fetchRatingForBusiness(businessName, businessType);
  return ratingInfo.isAcceptable;
}

module.exports = {
  fetchRatingForBusiness,
  isBusinessProposable,
  MINIMUM_ACCEPTABLE_RATING
};