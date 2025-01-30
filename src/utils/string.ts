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

  // Weight and combine the similarities
  // Give more weight to word set and keyword similarities for activity names
  const combinedSimilarity = (
    levenshteinSimilarity * 0.3 +
    wordSetSimilarity * 0.4 +
    keywordSimilarity * 0.3
  );

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
  // Define important keywords that indicate similar activities
  const keywords = [
    'seine', 'river', 'cruise', 'tour', 'ticket', 'paris',
    'eiffel', 'tower', 'louvre', 'museum', 'palace',
    'guided', 'skip', 'line', 'priority', 'access'
  ];
  
  const words1 = s1.split(' ');
  const words2 = s2.split(' ');
  
  let matchingKeywords = 0;
  let totalKeywords = 0;
  
  for (const keyword of keywords) {
    const inFirst = words1.includes(keyword);
    const inSecond = words2.includes(keyword);
    
    if (inFirst || inSecond) {
      totalKeywords++;
      if (inFirst && inSecond) {
        matchingKeywords++;
      }
    }
  }
  
  return totalKeywords === 0 ? 0 : matchingKeywords / totalKeywords;
} 