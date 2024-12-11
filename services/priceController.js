class PriceController {
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
  }
  
export default PriceController;