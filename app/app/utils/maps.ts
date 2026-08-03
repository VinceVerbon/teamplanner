// F27: build a Google Maps search URL for a location. Address gives the most
// precise hit; the name is prepended so the map pin is labeled recognizably.
export function mapsSearchUrl(name: string, address?: string | null): string {
  const query = address?.trim() ? `${name.trim()}, ${address.trim()}` : name.trim()
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
