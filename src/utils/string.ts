import { logger } from './logger';

/**
 * Calculate similarity between two strings using multiple methods
 * Returns a value between 0 (completely different) and 1 (identical)
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  // Normalize strings
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);

  logger.debug('[String Similarity] Comparing strings:', {
    original1: str1,
    original2: str2,
    normalized1: s1,
    normalized2: s2
  });

  // Calculate different similarity metrics
  const levenshteinSimilarity = calculateLevenshteinSimilarity(s1, s2);
  const wordSetSimilarity = calculateWordSetSimilarity(s1, s2);
  const keywordSimilarity = calculateKeywordSimilarity(s1, s2);

  logger.debug('[String Similarity] Similarity scores:', {
    levenshtein: levenshteinSimilarity,
    wordSet: wordSetSimilarity,
    keyword: keywordSimilarity
  });

  // Adjust weights to favor keyword matches
  const combinedSimilarity = (
    levenshteinSimilarity * 0.2 +  // Reduced from 0.3
    wordSetSimilarity * 0.3 +      // Reduced from 0.4
    keywordSimilarity * 0.5        // Increased from 0.3
  );

  // Boost score if there are significant keyword matches
  if (keywordSimilarity > 0.5) {
    return Math.min(1, combinedSimilarity * 1.5);
  }

  return combinedSimilarity;
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
    .replace(/\s+/g, ' ')      // Normalize spaces
    .trim();
}

function calculateLevenshteinSimilarity(s1: string, s2: string): number {
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(
            Math.min(newValue, lastValue),
            costs[j]
          ) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }
  
  const levenshteinDistance = costs[s2.length];
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - (levenshteinDistance / maxLength);
}

function calculateWordSetSimilarity(s1: string, s2: string): number {
  const words1 = new Set(s1.split(' '));
  const words2 = new Set(s2.split(' '));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

function calculateKeywordSimilarity(s1: string, s2: string): number {
  // Expanded list of important keywords
  const keywords = [
    // Common activity types
    'tour', 'visit', 'experience', 'adventure', 'excursion',
    'cruise', 'walk', 'exploration', 'trip', 'journey',
    
    // Access types
    'skip', 'line', 'priority', 'access', 'entry', 'ticket',
    'admission', 'pass', 'guided', 'private', 'small-group',
    
    // Time-related
    'day', 'night', 'evening', 'morning', 'afternoon', 'sunset',
    'sunrise', 'hour', 'full-day', 'half-day',
    
    // Common attractions
    'museum', 'palace', 'castle', 'cathedral', 'church',
    'garden', 'park', 'monument', 'tower', 'bridge',
    
    // Activity features
    'tasting', 'food', 'wine', 'cooking', 'workshop',
    'photography', 'bike', 'boat', 'bus', 'walking',
    
    // Locations (add specific to your destinations)
    'paris', 'seine', 'louvre', 'eiffel', 'versailles',
    'montmartre', 'latin', 'quarter', 'marais', 'opera'
  ];
  
  const words1 = s1.split(' ');
  const words2 = s2.split(' ');
  
  let matchingKeywords = 0;
  let totalKeywords = 0;
  
  // Count matching keywords in both strings
  keywords.forEach(keyword => {
    const inStr1 = words1.some(w => w.includes(keyword));
    const inStr2 = words2.some(w => w.includes(keyword));
    
    if (inStr1 || inStr2) {
      totalKeywords++;
      if (inStr1 && inStr2) {
        matchingKeywords++;
      }
    }
  });
  
  // If no keywords found, fall back to basic word matching
  if (totalKeywords === 0) {
    return calculateWordSetSimilarity(s1, s2);
  }
  
  return matchingKeywords / totalKeywords;
} 