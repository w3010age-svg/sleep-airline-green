import OpenAI from 'openai';

export interface SceneryGenerationResult {
  imageBuffer: Buffer;
  imagePrompt: string;
  contentType: string;
  filename: string;
  isFallback?: boolean;
}

export function buildSceneryPrompt(city: string, country: string, displayName: string): string {
  const place = displayName || `${city}, ${country}`;
  return [
    `View through an airplane cabin window on a quiet night flight,`,
    `gazing at the landscape near ${place}.`,
    `Outside the airplane window, include a small original caped flying hero silhouette in the distance,`,
    `not Superman, not a recognizable copyrighted character, no logos or chest symbols.`,
    `The hero emits thin red glowing eye beams angled toward the airplane window,`,
    `creating dramatic reflections on the glass without cracking or damaging it.`,
    `Dreamy and poetic mood: deep midnight navy sky, soft starlight,`,
    `gentle moonlit mist over terrain typical of ${country},`,
    `rolling hills, coastline, or valley silhouettes, not a tourist postcard or famous monument.`,
    `Cinematic, half-awake memory feel; subtle amber reflection on the window glass,`,
    `cool blue-teal atmosphere like a long night journey before dawn.`,
    `Soft atmospheric perspective, no other people, no text, no watermark, no logos.`,
  ].join(' ');
}
export function buildFoodPrompt(city: string, country: string, displayName: string): string {
  const place = displayName || `${city}, ${country}`;
  return [
    `A delicious local food recommendation for a traveler who has just landed near ${place}.`,
    `Show one inviting signature dish or snack that feels authentic to ${country},`,
    `served beautifully on a clean ceramic plate or small tray with fresh green accents.`,
    `Bright airy natural daylight, fresh white and pale green styling, editorial food photography.`,
    `No brand logos, no packaging, no text, no watermark, no people, no menus.`,
  ].join(' ');
}

export function createLandingFoodFallback(
  city: string,
  country: string,
  displayName: string,
  flightId: string
): SceneryGenerationResult {
  const place = displayName || `${city}, ${country}` || 'your landing city';
  const title = escapeXml(place);
  const subtitle = escapeXml('Local food recommendation');
  const prompt = buildFoodPrompt(city, country, displayName);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f7fff3"/>
      <stop offset="0.52" stop-color="#e3f4d8"/>
      <stop offset="1" stop-color="#fffaf0"/>
    </linearGradient>
    <radialGradient id="plate" cx="50%" cy="46%" r="54%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.72" stop-color="#f6fbf0"/>
      <stop offset="1" stop-color="#d7ead0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#5b8a50" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="185" cy="160" r="74" fill="#ffffff" opacity="0.52"/>
  <circle cx="838" cy="236" r="118" fill="#ffffff" opacity="0.34"/>
  <ellipse cx="512" cy="562" rx="342" ry="236" fill="url(#plate)" filter="url(#shadow)"/>
  <ellipse cx="512" cy="562" rx="265" ry="168" fill="#ffffff" stroke="#c9e3c1" stroke-width="8"/>
  <circle cx="418" cy="528" r="82" fill="#7fbd58"/>
  <circle cx="516" cy="500" r="96" fill="#f3ca62"/>
  <circle cx="608" cy="548" r="86" fill="#e8785d"/>
  <path d="M326 626c92 62 281 69 386 5" fill="none" stroke="#4f8f51" stroke-width="28" stroke-linecap="round"/>
  <path d="M626 388c-54 20-84 57-93 109 54-18 88-53 93-109z" fill="#5fa35c"/>
  <path d="M395 386c61 13 102 49 122 109-61-10-101-46-122-109z" fill="#8bc36f"/>
  <text x="512" y="164" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#26563a">${subtitle}</text>
  <text x="512" y="222" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#477253">${title}</text>
  <text x="512" y="846" text-anchor="middle" font-family="Arial, sans-serif" font-size="31" fill="#315b3e">AI image is temporarily unavailable.</text>
  <text x="512" y="892" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#6b7c63">Try a fresh local specialty after landing.</text>
</svg>`;

  return {
    imageBuffer: Buffer.from(svg, 'utf8'),
    imagePrompt: prompt,
    contentType: 'image/svg+xml',
    filename: `food-fallback-${safeFilename(city, flightId).replace(/\.png$/, '.svg')}`,
    isFallback: true,
  };
}

export async function generateLandingFood(
  city: string,
  country: string,
  displayName: string,
  flightId: string
): Promise<SceneryGenerationResult | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const imagePrompt = buildFoodPrompt(city, country, displayName);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1-mini';

  const response = await client.images.generate(
    isGptImageModel(model)
      ? {
          model,
          prompt: imagePrompt,
          size: FOOD_IMAGE_SIZE,
          quality: 'medium',
          output_format: 'png',
          n: 1,
        }
      : {
          model,
          prompt: imagePrompt,
          size: FOOD_IMAGE_SIZE,
          quality: 'standard',
          n: 1,
        }
  );

  const b64 = response.data[0]?.b64_json;
  if (b64) {
    return {
      imageBuffer: Buffer.from(b64, 'base64'),
      imagePrompt,
      contentType: 'image/png',
      filename: `food-${safeFilename(city, flightId)}`,
    };
  }

  const imageUrl = response.data[0]?.url;
  if (!imageUrl) return null;

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return null;
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  return {
    imageBuffer,
    imagePrompt,
    contentType: imageRes.headers.get('content-type') ?? 'image/png',
    filename: `food-${safeFilename(city, flightId)}`,
  };
}


/** Landscape aspect ratio suits the night-window composition. */
export const SCENERY_IMAGE_SIZE = '1536x1024';
export const FOOD_IMAGE_SIZE = '1024x1024';

function safeFilename(city: string, flightId: string): string {
  const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'landing';
  return `landing-${slug}-${flightId.slice(-8)}.png`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isGptImageModel(model: string): boolean {
  return model.startsWith('gpt-image') || model.startsWith('chatgpt-image');
}

export async function generateLandingScenery(
  city: string,
  country: string,
  displayName: string,
  flightId: string
): Promise<SceneryGenerationResult | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const imagePrompt = buildSceneryPrompt(city, country, displayName);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1-mini';

  const response = await client.images.generate(
    isGptImageModel(model)
      ? {
          model,
          prompt: imagePrompt,
          size: SCENERY_IMAGE_SIZE,
          quality: 'medium',
          output_format: 'png',
          n: 1,
        }
      : {
          model,
          prompt: imagePrompt,
          size: SCENERY_IMAGE_SIZE,
          quality: 'standard',
          n: 1,
        }
  );

  const b64 = response.data[0]?.b64_json;
  if (b64) {
    return {
      imageBuffer: Buffer.from(b64, 'base64'),
      imagePrompt,
      contentType: 'image/png',
      filename: safeFilename(city, flightId),
    };
  }

  const imageUrl = response.data[0]?.url;
  if (!imageUrl) return null;

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return null;
  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

  return {
    imageBuffer,
    imagePrompt,
    contentType: imageRes.headers.get('content-type') ?? 'image/png',
    filename: safeFilename(city, flightId),
  };
}
