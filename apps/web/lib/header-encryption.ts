/**
 * Encryption utility for custom headers.
 *
 * Uses AES-256-GCM for authenticated encryption.
 * Header values are encrypted at rest in the database.
 * API responses return masked values (key: ***last4).
 *
 * Security:
 *   - HEADER_ENCRYPTION_KEY env var required (32 bytes hex)
 *   - Random IV for each encryption operation
 *   - Auth tag prevents tampering
 *   - No plaintext in API responses or logs
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits for GCM
const TAG_LENGTH = 16 // 128 bits for GCM
const KEY_LENGTH = 32 // 256 bits

// ─── Key Management ────────────────────────────────────────────────────────────

/**
 * HEADER_ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars).
 * Used for encrypting/decrypting custom header values.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.HEADER_ENCRYPTION_KEY
  if (!keyHex) {
    throw new Error('HEADER_ENCRYPTION_KEY environment variable is required')
  }

  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== KEY_LENGTH) {
    throw new Error(`HEADER_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`)
  }

  return key
}

// ─── Encryption ────────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The value to encrypt
 * @returns Encrypted value as base64 string (IV:TAG:CIPHERTEXT)
 */
export function encryptValue(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  // Format: base64(IV):base64(TAG):base64(CIPHERTEXT)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

/**
 * Decrypts an encrypted string using AES-256-GCM.
 *
 * @param encryptedValue - The encrypted value (base64 IV:TAG:CIPHERTEXT)
 * @returns Decrypted plaintext string
 */
export function decryptValue(encryptedValue: string): string {
  const key = getEncryptionKey()
  const parts = encryptedValue.split(':')

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format')
  }

  const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string]
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

// ─── Masking ───────────────────────────────────────────────────────────────────

/**
 * Masks a header value for API responses.
 * Shows only the last 4 characters for debugging.
 *
 * Example: "Bearer abc123xyz" → "***xyz"
 *
 * @param value - The plaintext value to mask
 * @returns Masked value
 */
export function maskValue(value: string): string {
  if (value.length <= 4) {
    return '****'
  }
  return `***${value.slice(-4)}`
}

/**
 * Masks a custom header for API responses.
 * Returns { key, valueMasked } with value masked.
 *
 * @param header - The custom header with encrypted value
 * @returns Masked header safe for API responses
 */
export interface CustomHeader {
  key: string
  valueEncrypted: string
}

export interface MaskedHeader {
  key: string
  valueMasked: string
}

export function maskHeader(header: CustomHeader): MaskedHeader {
  try {
    const plaintext = decryptValue(header.valueEncrypted)
    return {
      key: header.key,
      valueMasked: maskValue(plaintext),
    }
  } catch {
    // If decryption fails, show generic mask
    return {
      key: header.key,
      valueMasked: '***invalid',
    }
  }
}

/**
 * Masks an array of custom headers for API responses.
 *
 * @param headers - Array of custom headers with encrypted values
 * @returns Array of masked headers safe for API responses
 */
export function maskHeaders(headers: CustomHeader[]): MaskedHeader[] {
  return headers.map(maskHeader)
}

// ─── Header Preparation ────────────────────────────────────────────────────────

/**
 * Decrypts custom headers and returns them as a plain object for safeFetch.
 *
 * @param headers - Array of custom headers with encrypted values
 * @returns Decrypted headers as Record<string, string>
 */
export function prepareHeaders(headers: CustomHeader[]): Record<string, string> {
  const result: Record<string, string> = {}

  for (const header of headers) {
    try {
      result[header.key] = decryptValue(header.valueEncrypted)
    } catch {
      // Skip headers that fail to decrypt
      // This prevents crashes from corrupted data
    }
  }

  return result
}
