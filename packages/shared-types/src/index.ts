/**
 * Shared TypeScript types for the Rivvon ecosystem
 */

// Texture-related types
export interface TextureMetadata {
  id: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TextureSet {
  id: string;
  name: string;
  description?: string;
  textures: TextureMetadata[];
  isPublic: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// User-related types
export interface User {
  id: string;
  email: string;
  name?: string;
}
