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

import { describe, beforeEach, expect, it, vi } from 'vitest';
import type { ModuleParams } from '../../../../lib/types';

// Mock node:path
vi.mock('node:path', () => ({
  default: {
    parse: vi.fn(function () {
      return { name: 'resource-ownership-state' };
    }),
    basename: vi.fn(function () {
      return 'resource-ownership-state.ts';
    }),
  },
}));

// Mock aws-lza module
vi.mock('aws-lza', () => ({
  createLogger: vi.fn(function () {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }),
}));

// Mock module-state utility (shared state reader)
vi.mock('../../../../lib/actions/utils/module-state.js', () => ({
  getModuleExecutionState: vi.fn(),
}));

describe('resource-ownership-state', () => {
  const mockParams: ModuleParams = {
    runnerParameters: {
      sessionContext: {
        invokingAccountId: '111111111111',
        region: 'us-east-1',
        globalRegion: 'us-east-1',
        partition: 'aws',
      },
      solutionId: 'AwsSolution/SO0199/v1.0.0',
      dryRun: false,
    },
    moduleRunnerParameters: {
      configs: {},
      managementAccountCredentials: undefined,
      globalRegion: 'us-east-1',
      resourcePrefixes: { ssmParamName: '/accelerator' },
    },
    moduleItem: {
      name: 'tgw-associations-and-propagations',
      description: 'TGW module',
      stage: 'network-associations',
      handler: vi.fn(),
    },
  } as unknown as ModuleParams;

  let moduleState: typeof import('../../../../lib/actions/utils/module-state');
  let resourceOwnership: typeof import('../../../../lib/actions/utils/resource-ownership-state');

  beforeEach(async () => {
    vi.clearAllMocks();
    moduleState = await import('../../../../lib/actions/utils/module-state');
    resourceOwnership = await import('../../../../lib/actions/utils/resource-ownership-state');
  });

  describe('loadOwnedResources', () => {
    it('should return empty array when no execution state exists', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue(undefined);

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when lastResponse is missing', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: '',
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when last execution failed (create-only mode)', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'failed',
        lastResponse: JSON.stringify({
          status: 'failed',
          response: { ownedResources: ['assoc:rtb-1:att-1', 'prop:rtb-1:att-2'] },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when lastResponse has no ownedResources', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: JSON.stringify({
          status: 'completed',
          response: { associations: [], propagations: [] },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual([]);
    });

    it('should return owned resources from lastResponse', async () => {
      const storedResources = ['assoc:tgw-rtb-aaa:tgw-attach-111', 'prop:tgw-rtb-aaa:tgw-attach-222'];

      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: JSON.stringify({
          status: 'completed',
          response: { associations: [], propagations: [], ownedResources: storedResources },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual(storedResources);
      expect(result).toHaveLength(2);
    });

    it('should delegate to getModuleExecutionState with correct params', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue(undefined);

      await resourceOwnership.loadOwnedResources(mockParams, 'tgw-associations-and-propagations', 'test-prefix');

      expect(moduleState.getModuleExecutionState).toHaveBeenCalledWith(
        'tgw-associations-and-propagations',
        mockParams,
        'test-prefix',
      );
    });

    it('should throw when lastResponse is invalid JSON (corrupt state)', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: 'not-valid-json',
      });

      await expect(
        resourceOwnership.loadOwnedResources(mockParams, 'tgw-associations-and-propagations', 'test-prefix'),
      ).rejects.toThrow('Failed to parse owned resources state');
    });

    it('should return empty array when ownedResources is empty array', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: JSON.stringify({
          status: 'completed',
          response: { associations: [], propagations: [], ownedResources: [] },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual([]);
    });

    it('should decompress gzip-compressed ownedResources', async () => {
      const { gzipSync } = await import('node:zlib');
      const resources = ['assoc:tgw-rtb-aaa:tgw-attach-111', 'prop:tgw-rtb-aaa:tgw-attach-222'];
      const compressed = 'gz:' + gzipSync(Buffer.from(JSON.stringify(resources), 'utf-8')).toString('base64');

      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: JSON.stringify({
          status: 'completed',
          response: { ownedResources: compressed },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual(resources);
    });

    it('should filter out non-string entries from ownedResources', async () => {
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: JSON.stringify({
          status: 'completed',
          response: { ownedResources: ['assoc:rtb-1:att-1', 42, null, 'prop:rtb-1:att-2', { resourceId: 'stale' }] },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual(['assoc:rtb-1:att-1', 'prop:rtb-1:att-2']);
    });
  });

  describe('compressOwnedResources', () => {
    it('should return empty array for empty input', () => {
      const result = resourceOwnership.compressOwnedResources([]);
      expect(result).toEqual([]);
    });

    it('should return a gz:-prefixed string for non-empty input', () => {
      const resources = ['assoc:tgw-rtb-core:tgw-attach-111', 'prop:tgw-rtb-core:tgw-attach-222'];
      const result = resourceOwnership.compressOwnedResources(resources);
      expect(typeof result).toBe('string');
      expect((result as string).startsWith('gz:')).toBe(true);
    });

    it('should round-trip: compress then decompress returns original array', async () => {
      const resources = [
        'assoc:tgw-rtb-aaa:tgw-attach-111',
        'prop:tgw-rtb-bbb:tgw-attach-222',
        'prop:tgw-rtb-ccc:tgw-attach-333',
      ];
      const compressed = resourceOwnership.compressOwnedResources(resources);

      // Feed compressed value through loadOwnedResources
      vi.mocked(moduleState.getModuleExecutionState).mockResolvedValue({
        serviceName: 'tgw-associations-and-propagations',
        lastExecutionTime: '2026-08-01T00:00:00Z',
        lastConfig: '{}',
        configHash: 'abc',
        lastStatus: 'completed',
        lastResponse: JSON.stringify({
          status: 'completed',
          response: { ownedResources: compressed },
        }),
      });

      const result = await resourceOwnership.loadOwnedResources(
        mockParams,
        'tgw-associations-and-propagations',
        'test-prefix',
      );

      expect(result).toEqual(resources);
    });
  });
});
