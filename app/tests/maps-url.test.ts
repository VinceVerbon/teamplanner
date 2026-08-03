// Test-set for the F27 'Toon op kaart' action: Google Maps search URL helper.
import { describe, it, expect } from 'vitest'
import { mapsSearchUrl } from '../app/utils/maps'

describe('F27 mapsSearchUrl - main flow', () => {
  it('combines name and address into one query', () => {
    const url = mapsSearchUrl('FC Aalsmeer', 'Beethovenlaan 120, 1431 WZ Aalsmeer')
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=FC%20Aalsmeer%2C%20Beethovenlaan%20120%2C%201431%20WZ%20Aalsmeer')
  })

  it('falls back to the name alone when there is no address', () => {
    expect(mapsSearchUrl('Sporthal De Bloemhof')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Sporthal%20De%20Bloemhof')
  })
})

describe('F27 mapsSearchUrl - edge cases', () => {
  it('treats an empty or whitespace-only address as absent', () => {
    expect(mapsSearchUrl('Sporthal De Bloemhof', '')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Sporthal%20De%20Bloemhof')
    expect(mapsSearchUrl('Sporthal De Bloemhof', '   ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Sporthal%20De%20Bloemhof')
    expect(mapsSearchUrl('Sporthal De Bloemhof', null)).toBe(
      'https://www.google.com/maps/search/?api=1&query=Sporthal%20De%20Bloemhof')
  })

  it('percent-encodes characters that would break the URL', () => {
    const url = mapsSearchUrl('Café "De Kuip" & Zn', 'Straatweg 1/3')
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%22De%20Kuip%22%20%26%20Zn%2C%20Straatweg%201%2F3')
  })

  it('trims stray whitespace from name and address', () => {
    expect(mapsSearchUrl('  FC Aalsmeer ', ' Beethovenlaan 120 ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=FC%20Aalsmeer%2C%20Beethovenlaan%20120')
  })
})
