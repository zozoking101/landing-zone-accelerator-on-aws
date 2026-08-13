/**
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

/**
 * @fileoverview Resource ownership state management for LZA modules.
 *
 * @description
 * Provides generic resource-level ownership tracking for modules that need to
 * distinguish between resources they created vs resources created externally.
 *
 * This enables safe reconciliation: modules only delete resources they previously
 * created (tracked in state), leaving externally-created resources untouched.
 *
 * Owned resources are stored in the module's lastResponse field (part of the
 * EXECUTION#latest DDB item) — no separate DDB item is needed. The module
 * returns ownedResources in its response, which saveModuleExecutionState
 * persists as lastResponse. On the next run, loadOwnedResources reads it back.
 *
 * Use cases:
 * - TGW associations/propagations (don't delete customer-managed resources)
 * - Any future module that coexists with external resource management
 *
 * @example
 * ```typescript
 * // Load previously owned resources (from lastResponse in EXECUTION#latest)
 * const owned = await loadOwnedResources(params, 'tgw-associations-and-propagations', logPrefix);
 *
 * // Pass to module — deletion filters use ownedResourceIds.has() inline
 * // No separate save needed — ownedResources in the module response flows
 * // into lastResponse via saveModuleExecutionState automatically.
 * ```
 */

import { createLogger } from 'aws-lza';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { ModuleParams } from '../../types';
import { getModuleExecutionState } from './module-state';

const logger = createLogger([path.parse(path.basename(__filename)).name]);

/** Prefix marker to identify compressed owned resources in DDB */
const COMPRESSED_PREFIX = 'gz:';

/**
 * Loads previously owned resource IDs for a module from the EXECUTION#latest DDB item.
 * Delegates DDB access to the shared {@link getModuleExecutionState} utility, then
 * extracts ownedResources from the serialized lastResponse field.
 *
 * @param params - Module parameters for DDB access
 * @param serviceName - Service name (e.g., 'tgw-associations-and-propagations')
 * @param logPrefix - Prefix for logging messages
 * @returns Array of owned resource ID strings, or empty array if no state exists
 */
export async function loadOwnedResources(
  params: ModuleParams,
  serviceName: string,
  logPrefix: string,
): Promise<string[]> {
  const state = await getModuleExecutionState(serviceName, params, logPrefix);

  if (!state) {
    logger.info(
      `No previous execution state found for ${serviceName}, treating as first run (no owned resources)`,
      logPrefix,
    );
    return [];
  }

  // If last execution failed, return empty to trigger create-only mode (no deletions).
  // This is the safest behavior: we don't know what partially succeeded, so we avoid
  // any deletions on retry. The module re-creates from config and seeds owned state on success.
  if (state.lastStatus === 'failed') {
    logger.info(`Previous execution failed for ${serviceName}, using create-only mode (no deletions)`, logPrefix);
    return [];
  }

  // Parse lastResponse to extract ownedResources
  if (!state.lastResponse) {
    logger.info(`No lastResponse found for ${serviceName}, treating as no owned resources`, logPrefix);
    return [];
  }

  try {
    const lastResponse = JSON.parse(state.lastResponse);
    const ownedResources = lastResponse?.response?.ownedResources;

    // Handle compressed format: single string with 'gz:' prefix containing base64-encoded gzip
    if (typeof ownedResources === 'string' && ownedResources.startsWith(COMPRESSED_PREFIX)) {
      const compressed = Buffer.from(ownedResources.slice(COMPRESSED_PREFIX.length), 'base64');
      const decompressed = gunzipSync(compressed).toString('utf-8');
      const resourceIds: string[] = JSON.parse(decompressed);
      logger.info(
        `Loaded ${resourceIds.length} owned resources for ${serviceName} from lastResponse (compressed)`,
        logPrefix,
      );
      return resourceIds;
    }

    // Handle uncompressed format: plain string array
    // Note: absent ownedResources (upgrade from 1.16.0) is handled identically to empty.
    // This is by-design: we cannot distinguish LZA-created from external resources without
    // historical ownership data. Create-only mode is the safe default on first post-upgrade run.
    // The owned set is seeded from current config on this run; subsequent runs delete normally.
    if (!Array.isArray(ownedResources) || ownedResources.length === 0) {
      logger.info(`No owned resources in lastResponse for ${serviceName}`, logPrefix);
      return [];
    }
    // Only accept string entries — filter out any unexpected formats
    const resourceIds: string[] = ownedResources.filter((r: unknown): r is string => typeof r === 'string');
    logger.info(`Loaded ${resourceIds.length} owned resources for ${serviceName} from lastResponse`, logPrefix);
    return resourceIds;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to parse owned resources state for ${serviceName} — DDB state may be corrupt: ${errorMessage}`,
      logPrefix,
    );
    throw new Error(
      `Failed to parse owned resources state for ${serviceName}. ` +
        `The module state in DynamoDB may be corrupt. Verify the lastResponse field in the Module-State table. ` +
        `Original error: ${errorMessage}`,
    );
  }
}

/**
 * Compresses an owned resources array for efficient DDB storage.
 * Returns an empty array for empty input; otherwise a 'gz:'-prefixed base64 compressed string.
 *
 * @param ownedResources - Array of resource ID strings to compress
 * @returns Compressed `gz:`-prefixed base64 string for non-empty input, or empty array `[]` for empty input
 */
export function compressOwnedResources(ownedResources: string[]): string | string[] {
  if (ownedResources.length === 0) {
    return [];
  }
  const json = JSON.stringify(ownedResources);
  const compressed = gzipSync(Buffer.from(json, 'utf-8'));
  return `${COMPRESSED_PREFIX}${compressed.toString('base64')}`;
}
