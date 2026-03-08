import { toolManifests, type ToolManifest } from '../generated/tool-manifests';

export const RESERVED_SLUGS = new Set(['api', 'assets', 'static', 'favicon.ico', 'colorcard']);

export function getAllTools(): ToolManifest[] {
  return toolManifests;
}

export function getToolBySlug(slug?: string): ToolManifest | undefined {
  if (!slug || RESERVED_SLUGS.has(slug)) {
    return undefined;
  }

  return toolManifests.find((item) => item.slug === slug);
}
