/**
 * 🎨 HSC Slides - HTML to PNG Renderer
 * Fixed version with proper timeout handling
 */

const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  
  console.log('Launching browser via @sparticuz/chromium...');
  
  const executablePath = await chromium.executablePath();
  console.log('Chromium path:', executablePath);
  
  browserInstance = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true
  });
  
  console.log('Browser launched successfully');
  return browserInstance;
}

app.get('/', (req, res) => {
  res.send('HSC Renderer is running. POST /render with {html, width, scale}.');
});

app.get('/health', async (req, res) => {
  try {
    const browser = await getBrowser();
    const version = await browser.version();
    res.json({ ok: true, browser: version });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

app.post('/render', async (req, res) => {
  const startTime = Date.now();
  const { html, width = 800, scale = 2 } = req.body;
  
  if (!html) {
    return res.status(400).send('Missing html field');
  }
  
  let page;
  try {
    console.log('[Render] Starting...');
    const browser = await getBrowser();
    page = await browser.newPage();
    
    // Block fonts and other slow resources we can wait for separately
    // Allow them but with strict timeout
    await page.setDefaultNavigationTimeout(8000);
    await page.setDefaultTimeout(8000);
    
    await page.setViewport({
      width: parseInt(width),
      height: 200,
      deviceScaleFactor: parseInt(scale)
    });
    
    console.log('[Render] Setting content...');
    
    // Use 'domcontentloaded' instead of 'networkidle0' - much faster, doesn't wait for fonts/CDN
    try {
      await page.setContent(html, { 
        waitUntil: 'domcontentloaded', 
        timeout: 8000 
      });
    } catch (navErr) {
      console.log('[Render] Nav timeout, continuing anyway:', navErr.message);
    }
    
    console.log('[Render] Waiting for render...');
    
    // Give KaTeX and fonts time to render (but with hard limit)
    await new Promise(r => setTimeout(r, 2000));
    
    // Try to wait for KaTeX rendering signal, but don't block forever
    try {
      await page.waitForFunction(
        () => document.body.getAttribute('data-rendered') === 'true',
        { timeout: 3000 }
      );
    } catch (e) {
      console.log('[Render] KaTeX render signal not received, continuing');
    }
    
    console.log('[Render] Measuring dimensions...');
    
    const dims = await page.evaluate(() => {
      const el = document.getElementById('content') || document.body;
      const rect = el.getBoundingClientRect();
      return {
        width: Math.ceil(rect.width) + 20,
        height: Math.ceil(rect.height) + 10
      };
    });
    
    await page.setViewport({
      width: Math.max(dims.width, 100),
      height: Math.max(dims.height, 50),
      deviceScaleFactor: parseInt(scale)
    });
    
    console.log('[Render] Taking screenshot...');
    
    const png = await page.screenshot({
      type: 'png',
      omitBackground: true,
      clip: {
        x: 0, y: 0,
        width: Math.max(dims.width, 100),
        height: Math.max(dims.height, 50)
      }
    });
    
    await page.close();
    
    const elapsed = Date.now() - startTime;
    console.log(`[Render] Done in ${elapsed}ms`);
    
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (e) {
    console.error('[Render] Error:', e.message);
    if (page) {
      try { await page.close(); } catch {}
    }
    res.status(500).json({
      error: e.message,
      stack: e.stack
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HSC Renderer running on port ${PORT}`);
});
