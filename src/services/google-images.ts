import { logger } from '../utils/logger.js';

interface GoogleImageSearchResult {
  items?: Array<{
    link: string;
    image: {
      thumbnailLink: string;
    };
  }>;
}

export async function searchImages(query: string): Promise<string[]> {
  const GOOGLE_API_KEY = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const SEARCH_ENGINE_ID = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
  
  if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
    logger.error('Google Custom Search API configuration missing', {
      hasApiKey: !!GOOGLE_API_KEY,
      hasSearchEngineId: !!SEARCH_ENGINE_ID
    });
    throw new Error('Google Custom Search API not configured');
  }

  try {
    const response = await fetch(
      `https://customsearch.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&searchType=image&num=3`
    );

    if (!response.ok) {
      throw new Error(`Google API error: ${response.statusText}`);
    }

    const data: GoogleImageSearchResult = await response.json();
    logger.debug('Google Images API response', { query, itemCount: data.items?.length });

    return (data.items || [])
      .map(item => item.link)
      .filter(url => url && !url.includes('example.com'))
      .slice(0, 3);
  } catch (error) {
    logger.error('Failed to fetch images from Google API', { error, query });
    return [];
  }
} 