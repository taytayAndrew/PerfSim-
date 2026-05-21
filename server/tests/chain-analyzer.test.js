import { describe, it, expect } from 'vitest'
import { findSerialChains } from '../src/chain-analyzer.js'

describe('findSerialChains()', () => {
  it('returns empty array when no requests', () => {
    expect(findSerialChains([])).toEqual([])
  })

  it('identifies a simple serial chain where B starts after A ends', () => {
    const requests = [
      { url: 'https://api.example.com/a', startTime: 0, endTime: 100, cacheKey: 'GET:a:x' },
      { url: 'https://api.example.com/b', startTime: 110, endTime: 200, cacheKey: 'GET:b:x' },
    ]
    const chains = findSerialChains(requests)
    expect(chains).toHaveLength(1)
    expect(chains[0]).toHaveLength(2)
    expect(chains[0][0].url).toBe('https://api.example.com/a')
    expect(chains[0][1].url).toBe('https://api.example.com/b')
  })

  it('does not chain requests that overlap in time', () => {
    const requests = [
      { url: 'https://api.example.com/a', startTime: 0, endTime: 100, cacheKey: 'GET:a:x' },
      { url: 'https://api.example.com/b', startTime: 50, endTime: 200, cacheKey: 'GET:b:x' },
    ]
    const chains = findSerialChains(requests)
    expect(chains).toHaveLength(0)
  })

  it('identifies a chain of 3 serial requests', () => {
    const requests = [
      { url: 'https://api.example.com/a', startTime: 0, endTime: 100, cacheKey: 'GET:a:x' },
      { url: 'https://api.example.com/b', startTime: 110, endTime: 200, cacheKey: 'GET:b:x' },
      { url: 'https://api.example.com/c', startTime: 210, endTime: 300, cacheKey: 'GET:c:x' },
    ]
    const chains = findSerialChains(requests)
    expect(chains).toHaveLength(1)
    expect(chains[0]).toHaveLength(3)
  })

  it('returns separate chains for independent serial sequences', () => {
    const requests = [
      { url: 'https://api.example.com/a', startTime: 0, endTime: 100, cacheKey: 'GET:a:x' },
      { url: 'https://api.example.com/b', startTime: 110, endTime: 200, cacheKey: 'GET:b:x' },
      { url: 'https://api.example.com/c', startTime: 500, endTime: 600, cacheKey: 'GET:c:x' },
      { url: 'https://api.example.com/d', startTime: 610, endTime: 700, cacheKey: 'GET:d:x' },
    ]
    const chains = findSerialChains(requests)
    expect(chains).toHaveLength(2)
  })

  it('only returns chains of length >= 2', () => {
    const requests = [
      { url: 'https://api.example.com/a', startTime: 0, endTime: 100, cacheKey: 'GET:a:x' },
    ]
    expect(findSerialChains(requests)).toHaveLength(0)
  })
})
