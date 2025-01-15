import express from 'express';
import axios from 'axios';

const router = express.Router();
const GOOGLE_API_KEY = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
const GOOGLE_PLACES_API_BASE_URL = 'https://maps.googleapis.com/maps/api/place';

router.post('/search', async (req, res) => {
  try {
    const { query, location } = req.body;

    console.log('Google Places API request:', { query, location });

    if (!GOOGLE_API_KEY) {
      console.error('Google API key is not configured');
      return res.status(500).json({ 
        success: false, 
        error: 'Google API key is not configured' 
      });
    }

    // First, search for the place
    console.log('Searching for place:', `${query} ${location}`);
    const searchResponse = await axios.get(`${GOOGLE_PLACES_API_BASE_URL}/textsearch/json`, {
      params: {
        query: `${query} ${location}`,
        key: GOOGLE_API_KEY
      }
    });

    console.log('Place search response:', {
      status: searchResponse.data.status,
      resultsCount: searchResponse.data.results?.length
    });

    if (!searchResponse.data.results.length) {
      console.warn('No places found for query:', `${query} ${location}`);
      return res.status(404).json({ 
        success: false, 
        error: 'No results found' 
      });
    }

    const placeId = searchResponse.data.results[0].place_id;
    console.log('Found place ID:', placeId);

    // Then, get detailed information about the place
    console.log('Fetching place details');
    const detailsResponse = await axios.get(`${GOOGLE_PLACES_API_BASE_URL}/details/json`, {
      params: {
        place_id: placeId,
        key: GOOGLE_API_KEY,
        fields: 'name,formatted_address,rating,photos,website,url,price_level,reviews,geometry,opening_hours'
      }
    });

    const placeDetails = detailsResponse.data.result;
    console.log('Place details response:', {
      name: placeDetails.name,
      hasPhotos: Boolean(placeDetails.photos?.length),
      photoCount: placeDetails.photos?.length
    });

    // Get photo references and fetch actual photo URLs
    const photoUrls = placeDetails.photos?.map((photo: any) => 
      `${GOOGLE_PLACES_API_BASE_URL}/photo?maxwidth=800&photoreference=${photo.photo_reference}&key=${GOOGLE_API_KEY}`
    ) || [];

    console.log('Generated photo URLs:', {
      count: photoUrls.length,
      urls: photoUrls
    });

    const enrichedDetails = {
      name: placeDetails.name,
      formatted_address: placeDetails.formatted_address,
      rating: placeDetails.rating,
      photos: photoUrls,
      website: placeDetails.website,
      url: placeDetails.url,
      price_level: placeDetails.price_level,
      reviews: placeDetails.reviews?.map((review: any) => ({
        rating: review.rating,
        text: review.text,
        time: review.time
      })),
      opening_hours: placeDetails.opening_hours?.weekday_text,
      geometry: placeDetails.geometry
    };

    return res.json({ 
      success: true, 
      data: enrichedDetails
    });
  } catch (error: any) {
    console.error('Google Places API error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    return res.status(error.response?.status || 500).json({ 
      success: false, 
      error: 'Failed to fetch from Google Places API',
      details: error.response?.data || error.message
    });
  }
});

export default router; 