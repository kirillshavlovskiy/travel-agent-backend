import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// Get all airports
router.get('/airports', async (req, res) => {
  try {
    const airports = await prisma.airport.findMany();
    res.json(airports);
  } catch (error) {
    console.error('Error fetching airports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get routes between airports
router.get('/routes', async (req, res) => {
  const { from, to } = req.query;
  
  try {
    const routes = await prisma.route.findMany({
      where: {
        fromCode: from as string,
        toCode: to as string,
      }
    });
    
    res.json(routes);
  } catch (error) {
    console.error('Error fetching routes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 