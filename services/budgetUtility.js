// services/budgetUtility.js

const { fetchRatingForBusiness, MINIMUM_ACCEPTABLE_RATING } = require('./ratings/fetchBusinessRatings');

// Budget category weights (must sum to 100)
const CATEGORY_WEIGHTS = {
  flight: {
    budget: { weight: 30, minRating: 3.0 },
    medium: { weight: 25, minRating: 3.5 },
    premium: { weight: 20, minRating: 4.0 }
  },
  hotel: {
    budget: { weight: 25, minRating: 3.0 },
    medium: { weight: 30, minRating: 3.5 },
    premium: { weight: 35, minRating: 4.0 }
  },
  restaurant: {
    budget: { weight: 15, minRating: 3.0 },
    medium: { weight: 20, minRating: 3.5 },
    premium: { weight: 25, minRating: 4.0 }
  },
  activity: {
    budget: { weight: 10, minRating: 3.0 },
    medium: { weight: 15, minRating: 3.5 },
    premium: { weight: 20, minRating: 4.0 }
  }
};

class BudgetUtility {
  constructor() {
    this.ratingCache = new Map();
  }

  /**
   * Calculate weighted score for a business based on its rating and category
   */
  async calculateBusinessScore(business, category, tier) {
    const rating = await this.getBusinessRating(business.name, category);
    if (!rating) return 0;

    const categoryConfig = CATEGORY_WEIGHTS[category][tier];
    if (!categoryConfig) return 0;

    // Base score calculation
    const baseScore = (rating / 5) * categoryConfig.weight;
    
    // Penalty if rating is below minimum for tier
    if (rating < categoryConfig.minRating) {
      return baseScore * 0.5;
    }

    return baseScore;
  }

  /**
   * Get cached rating or fetch new one
   */
  async getBusinessRating(businessName, category) {
    const cacheKey = `${category}:${businessName}`;
    
    if (this.ratingCache.has(cacheKey)) {
      return this.ratingCache.get(cacheKey);
    }

    const ratingInfo = await fetchRatingForBusiness(businessName, category);
    if (ratingInfo && ratingInfo.rating) {
      this.ratingCache.set(cacheKey, ratingInfo.rating);
      return ratingInfo.rating;
    }

    return null;
  }

  /**
   * Calculate optimal budget distribution based on preferences and ratings
   */
  async calculateOptimalBudget(params) {
    const {
      totalBudget,
      preferences = {},
      businesses = {},
      duration = 1,
      travelers = 1
    } = params;

    const budgetPerDay = totalBudget / duration;
    const distributions = {};
    let totalScore = 0;

    // Calculate scores for each category and tier
    for (const [category, categoryBusinesses] of Object.entries(businesses)) {
      distributions[category] = {
        budget: 0,
        medium: 0,
        premium: 0
      };

      for (const [tier, tierBusinesses] of Object.entries(categoryBusinesses)) {
        let tierScore = 0;
        
        for (const business of tierBusinesses) {
          const score = await this.calculateBusinessScore(business, category, tier);
          tierScore += score;
        }

        // Adjust score based on user preferences
        if (preferences[category] === tier) {
          tierScore *= 1.5;
        }

        distributions[category][tier] = tierScore;
        totalScore += tierScore;
      }
    }

    // Calculate budget allocations based on scores
    const budgetAllocations = {};
    for (const category of Object.keys(distributions)) {
      budgetAllocations[category] = {
        budget: 0,
        medium: 0,
        premium: 0
      };

      const categoryTotal = distributions[category].budget +
                          distributions[category].medium +
                          distributions[category].premium;

      if (categoryTotal > 0) {
        for (const tier of ['budget', 'medium', 'premium']) {
          const tierPercentage = distributions[category][tier] / categoryTotal;
          budgetAllocations[category][tier] = Math.round(
            (budgetPerDay * tierPercentage) * duration * travelers
          );
        }
      }
    }

    return {
      allocations: budgetAllocations,
      metrics: {
        totalScore,
        scoreDistribution: distributions,
        perDay: budgetPerDay,
        perPerson: totalBudget / travelers
      }
    };
  }

  /**
   * Validate if a business fits within budget constraints
   */
  async validateBudgetFit(business, category, tier, allocation) {
    const rating = await this.getBusinessRating(business.name, category);
    if (!rating || rating < MINIMUM_ACCEPTABLE_RATING) {
      return false;
    }

    const categoryConfig = CATEGORY_WEIGHTS[category][tier];
    if (!categoryConfig) return false;

    // Check if business price fits within allocation
    if (business.price > allocation) {
      return false;
    }

    // Additional validation for premium experiences
    if (tier === 'premium' && rating < categoryConfig.minRating) {
      return false;
    }

    return true;
  }

  /**
   * Get recommended businesses within budget constraints
   */
  async getRecommendedBusinesses(params) {
    const {
      businesses,
      budgetAllocations,
      category,
      tier,
      maxResults = 5
    } = params;

    const allocation = budgetAllocations[category][tier];
    const validBusinesses = [];

    for (const business of businesses) {
      if (await this.validateBudgetFit(business, category, tier, allocation)) {
        const score = await this.calculateBusinessScore(business, category, tier);
        validBusinesses.push({
          ...business,
          score
        });
      }
    }

    // Sort by score and return top results
    return validBusinesses
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }
}

module.exports = {
  BudgetUtility,
  CATEGORY_WEIGHTS
};