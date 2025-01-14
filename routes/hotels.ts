import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// Get hotels endpoint
router.get('/', async (req, res) => {
  try {
    res.json({ message: 'Hotels endpoint' });
  } catch (error) {
    console.error('Error in hotels route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 