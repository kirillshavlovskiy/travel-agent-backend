import express from 'express';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const router = express.Router();

// Create cache directory if it doesn't exist
const CACHE_DIR = path.join(__dirname, '../../cache/images');
fsPromises.mkdir(CACHE_DIR, { recursive: true }).catch(console.error);

// Helper to generate cache key from URL
const getCacheKey = (url: string, width?: number, quality?: number) => {
  const hash = createHash('md5').update(`${url}:${width}:${quality}`).digest('hex');
  return path.join(CACHE_DIR, `${hash}.webp`);
};

router.get('/proxy/*', async (req, res) => {
  try {
    // Get the original URL from the path
    const originalUrl = decodeURIComponent(req.params[0]);
    const width = parseInt(req.query.w as string) || undefined;
    const quality = parseInt(req.query.q as string) || undefined;

    // Generate cache key
    const cacheKey = getCacheKey(originalUrl, width, quality);

    try {
      // Try to serve from cache first
      const cacheStats = await fsPromises.stat(cacheKey);
      if (cacheStats.isFile()) {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
        return fs.createReadStream(cacheKey).pipe(res);
      }
    } catch (e) {
      // Cache miss, continue to fetch
    }

    // Fetch the original image
    const response = await fetch(originalUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    // Get the image buffer
    const buffer = await response.buffer();

    // Process image with sharp
    let sharpInstance = sharp(buffer);

    // Resize if width is specified
    if (width) {
      sharpInstance = sharpInstance.resize(width, null, {
        withoutEnlargement: true,
        fit: 'inside'
      });
    }

    // Convert to WebP with quality setting
    const processedBuffer = await sharpInstance
      .webp({ quality: quality || 80 })
      .toBuffer();

    // Save to cache
    await fsPromises.writeFile(cacheKey, processedBuffer);

    // Send response
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
    res.send(processedBuffer);

  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

export default router; 