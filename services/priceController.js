const { BudgetUtility } = require('./budgetUtility');

class PriceController {
    constructor() {
      this.budgetUtil = new BudgetUtility();
    }
  
    calculateMedian(min, max) {
      return (min + max) / 2;
    }
  
    validatePriceRange(tier, totalBudget) {
      // Ensure prices stay within reasonable ranges
      const ranges = {
        budget: { percent: 0.3 },
        standard: { percent: 0.5 },
        premium: { percent: 0.8 }
      };
      return this.adjustRange(tier, totalBudget, ranges[tier.level]);
    }

    async calculateTripBudget(params) {
      const budgetPlan = await this.budgetUtil.calculateOptimalBudget({
        totalBudget: params.budget,
        preferences: params.preferences,
        businesses: {
          flight: params.flights,
          hotel: params.hotels,
          restaurant: params.restaurants,
          activity: params.activities
        },
        duration: params.duration,
        travelers: params.travelers
      });

      // Get recommended businesses for each category
      const recommendations = {};
      for (const category of Object.keys(budgetPlan.allocations)) {
        recommendations[category] = {};
        for (const tier of ['budget', 'medium', 'premium']) {
          recommendations[category][tier] = await this.budgetUtil.getRecommendedBusinesses({
            businesses: params.businesses[category],
            budgetAllocations: budgetPlan.allocations,
            category,
            tier
          });
        }
      }

      return {
        budget: budgetPlan,
        recommendations,
        metrics: budgetPlan.metrics
      };
    }
  }
  
export default PriceController;