import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const VIATOR_API_KEY = process.env.VIATOR_API_KEY || '24e35633-0018-48e9-b9b7-b2b36554ada3';
const BASE_URL = 'https://api.viator.com/partner';

async function testViatorSearch() {
  try {
    // Search for activities in Barcelona
    const searchTerm = 'Barcelona Walking Tour';
    console.log('Searching for:', searchTerm);
    
    console.log('Making request to:', `${BASE_URL}/search/freetext`);
    const searchRequest = {
      searchTerm,
      searchTypes: [
        {
          searchType: "PRODUCTS",
          pagination: {
            offset: 0,
            limit: 3
          }
        }
      ],
      currency: "USD",
      productFiltering: {
        rating: {
          minimum: 4
        }
      },
      productSorting: {
        sortBy: "RELEVANCE",
        sortOrder: "DESC"
      }
    };
    console.log('With request body:', JSON.stringify(searchRequest, null, 2));

    const searchResponse = await axios.post(
      `${BASE_URL}/search/freetext`,
      searchRequest,
      {
        headers: {
          'Accept': 'application/json;version=2.0',
          'Content-Type': 'application/json',
          'Accept-Language': 'en-US',
          'exp-api-key': VIATOR_API_KEY
        }
      }
    );

    console.log('Full response:', JSON.stringify(searchResponse.data, null, 2));

    // Log the results
    if (searchResponse.data?.products?.results?.length > 0) {
      const activity = searchResponse.data.products.results[0];
      console.log('Found activity:', JSON.stringify({
        title: activity.title,
        productCode: activity.productCode,
        description: activity.description,
        duration: activity?.duration?.fixedDurationInMinutes,
        price: activity?.pricing?.summary?.fromPrice,
        currency: activity?.pricing?.currency,
        rating: activity?.reviews?.combinedAverageRating,
        reviewCount: activity?.reviews?.totalReviews,
        bookingInfo: activity.bookingInfo,
        images: activity?.images?.map(img => img.variants[0]?.url),
        highlights: activity.highlights,
        location: activity.location
      }, null, 2));
    } else {
      console.log('No results found for:', searchTerm);
    }
  } catch (error) {
    console.error('Test failed:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
  }
}

// Run the test
testViatorSearch(); 