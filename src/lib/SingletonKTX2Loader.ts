import * as THREE from 'three';
import { KTX2Loader } from 'three-stdlib';

let globalInstance: KTX2Loader | null = null;
let isInitialized = false;

/**
 * Singleton factory for KTX2Loader.
 * Ensures only one KTX2Loader (and its associated Web Workers) is created.
 */
export const getSharedKTX2Loader = (gl?: THREE.WebGLRenderer): KTX2Loader => {
  if (!globalInstance) {
    globalInstance = new KTX2Loader();
  }

  if (gl && !isInitialized) {
    globalInstance.setTranscoderPath('/basis/');
    globalInstance.detectSupport(gl);
    isInitialized = true;
  }

  return globalInstance;
};

export class BasisTranscoderError extends Error {
  constructor(cause: unknown) {
    super('Could not initialize the shared Basis texture transcoder', { cause });
    this.name = 'BasisTranscoderError';
  }
}

/** Identify shared initialization failures separately from one texture's failure. */
export async function loadOptionalKTX2Texture(gl: THREE.WebGLRenderer, url: string): Promise<THREE.Texture> {
  // three-stdlib 2.36.1 implements init(), but omits it from its declarations.
  const loader = getSharedKTX2Loader(gl) as KTX2Loader & { init(): Promise<void> };
  try {
    await loader.init();
  } catch (error) {
    throw new BasisTranscoderError(error);
  }
  return loader.loadAsync(url);
}

/**
 * A wrapper class for useLoader compatibility.
 * When React Three Fiber calls `new SingletonKTX2Loader()`, it returns the shared instance.
 */
export class SingletonKTX2Loader extends KTX2Loader {
  constructor() {
    // If an instance already exists, we return it instead of creating a new one.
    // This is a classic JS singleton pattern for classes.
    if (globalInstance) {
      return globalInstance;
    }
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    globalInstance = this;
  }
}
