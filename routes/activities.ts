import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// Get activities endpoint
router.get('/', async (req, res) => {
  try {
    res.json({ message: 'Activities endpoint' });
  } catch (error) {
    console.error('Error in activities route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 