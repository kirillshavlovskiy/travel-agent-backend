import express from 'express'
import prisma from '../lib/prisma.js'

const router = express.Router()

router.get('/estimates/:category', async (req, res) => {
  try {
    const estimates = await prisma.estimate_history.findMany({
      where: {
        category: req.params.category.toLowerCase(),
        estimates: { not: null }
      },
      orderBy: { updatedAt: 'desc' },
      take: 5
    })
    res.json(estimates)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router 