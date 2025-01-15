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
  
  if (!GOOGLE_API_KEY) {
    logger.error('Google Custom Search API key not configured');
    throw new Error('Google Custom Search API not configured');
  }

  try {
    const response = await fetch(
      `https://customsearch.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=partner-pub-9610773351225185:4961151473&q=${encodeURIComponent(query)}&searchType=image&num=3`
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