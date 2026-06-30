import type { LandingScenery } from '../../types';
import {
  getNotionClient,
  isNotionConfigured,
  readDate,
  readFirstFileUrl,
  readSelect,
  readText,
  readTitle,
  readUrl,
  wDate,
  wSelect,
  wText,
  wTitle,
  wUrl,
} from './client';
import { resolveLandscapeDbId } from './ensure-landscape-db';
import { uploadImageToNotion, wFileUpload } from './notion-file-upload';
import { getLandscapePropertyNames, pickExistingProperties } from './schema-introspect';

const mem: LandingScenery[] = [];

function foodEntryId(flightId: string): string {
  return `FOOD-${flightId}`;
}

function resolveImageUrl(props: Record<string, unknown>): string {
  return readFirstFileUrl(props, 'Image') || readUrl(props, 'Image URL');
}

function parseFoodImage(page: Record<string, unknown>): LandingScenery {
  const props = page.properties as Record<string, unknown>;
  return {
    notionId: page.id as string,
    entryId: readTitle(props, 'Entry ID'),
    flightId: readText(props, 'Flight ID'),
    passengerId: readText(props, 'Passenger ID'),
    passengerName: readText(props, 'Name'),
    groupId: readSelect(props, 'Group ID') ?? '',
    arrivalLocation: readText(props, 'Arrival Location'),
    country: readText(props, 'Country'),
    imageUrl: resolveImageUrl(props),
    imagePrompt: readText(props, 'Image Prompt'),
    landingTime: readDate(props, 'Landing Time'),
    createdAt: readDate(props, 'Created At') ?? new Date().toISOString(),
  };
}

export async function saveLandingFoodImage(params: {
  flightId: string;
  passengerId: string;
  passengerName: string;
  groupId: string;
  arrivalLocation: string;
  country: string;
  imageBuffer: Buffer;
  filename: string;
  contentType: string;
  imagePrompt: string;
  landingTime: string;
}): Promise<LandingScenery | null> {
  const now = new Date().toISOString();
  const entryId = foodEntryId(params.flightId);

  if (!isNotionConfigured()) {
    const dataUrl = `data:${params.contentType};base64,${params.imageBuffer.toString('base64')}`;
    const record: LandingScenery = {
      notionId: `mem_food_${params.flightId}`,
      entryId,
      flightId: params.flightId,
      passengerId: params.passengerId,
      passengerName: params.passengerName,
      groupId: params.groupId,
      arrivalLocation: params.arrivalLocation,
      country: params.country,
      imageUrl: dataUrl,
      imagePrompt: params.imagePrompt,
      landingTime: params.landingTime,
      createdAt: now,
    };
    mem.push(record);
    return record;
  }

  const fileUploadId = await uploadImageToNotion(
    params.imageBuffer,
    params.filename,
    params.contentType
  );

  const client = getNotionClient();
  const dbId = await resolveLandscapeDbId();
  const allowed = await getLandscapePropertyNames();

  const fullProperties = {
    'Entry ID': wTitle(entryId),
    'Flight ID': wText(params.flightId),
    'Passenger ID': wText(params.passengerId),
    'Name': wText(params.passengerName),
    'Group ID': wSelect(params.groupId),
    'Arrival Location': wText(params.arrivalLocation),
    'Country': wText(params.country),
    'Image': wFileUpload(fileUploadId, params.filename),
    'Image Prompt': wText(params.imagePrompt),
    'Landing Time': wDate(params.landingTime),
    'Created At': wDate(now),
  };

  const page = await client.pages.create({
    parent: { database_id: dbId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: pickExistingProperties(fullProperties, allowed) as any,
  });

  const fresh = await client.pages.retrieve({ page_id: page.id });
  const props = (fresh as { properties: Record<string, unknown> }).properties;
  const imageUrl = resolveImageUrl(props);

  if (imageUrl && allowed.has('Image URL')) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.pages.update({
      page_id: page.id,
      properties: { 'Image URL': wUrl(imageUrl) } as any,
    });
  }

  return parseFoodImage(fresh as unknown as Record<string, unknown>);
}

export async function getLandingFoodByFlightId(flightId: string): Promise<LandingScenery | null> {
  if (!flightId) return null;

  if (!isNotionConfigured()) {
    return mem.find((r) => r.entryId === foodEntryId(flightId)) ?? null;
  }

  const client = getNotionClient();
  const dbId = await resolveLandscapeDbId();

  const result = await client.databases.query({
    database_id: dbId,
    filter: { property: 'Entry ID', title: { equals: foodEntryId(flightId) } },
    sorts: [{ property: 'Created At', direction: 'descending' }],
    page_size: 1,
  });

  if (result.results.length === 0) return null;

  const pageId = result.results[0].id;
  const fresh = await client.pages.retrieve({ page_id: pageId });
  return parseFoodImage(fresh as unknown as Record<string, unknown>);
}
