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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AcceleratorTool, AcceleratorToolProps } from '../lib/classes/accelerator-tool';
import { OrganizationsClient } from '@aws-sdk/client-organizations';

// Mock CloudFormation client for stack detection and config extraction tests
vi.mock('@aws-sdk/client-cloudformation', async importOriginal => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-cloudformation')>();
  return {
    ...actual,
    CloudFormationClient: vi.fn().mockImplementation(function () {
      return {
        send: vi.fn(),
      };
    }),
  };
});

// Mock STS client for AcceleratorTool methods that call GetCallerIdentity
vi.mock('@aws-sdk/client-sts', async importOriginal => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-sts')>();
  return {
    ...actual,
    STSClient: vi.fn().mockImplementation(function () {
      return {
        send: vi.fn().mockResolvedValue({
          Account: '111122223333',
        }),
      };
    }),
  };
});

/**
 * Helper to build minimal valid AcceleratorToolProps
 */
function makeProps(overrides: Partial<AcceleratorToolProps> = {}): AcceleratorToolProps {
  return {
    installerStackName: 'AWSAccelerator-InstallerContainerStack',
    partition: 'aws',
    fullDestroy: true,
    deleteAccelerator: false,
    keepBootstraps: false,
    keepData: false,
    keepPipelineAndConfig: false,
    stageName: 'all',
    actionName: 'all',
    debug: false,
    ignoreTerminationProtection: true,
    ...overrides,
  };
}

describe('AcceleratorTool construction', () => {
  it('should create instance with valid props', () => {
    // Given
    const props = makeProps();

    // When
    const tool = new AcceleratorTool(props);

    // Then
    expect(tool).toBeDefined();
  });

  it('should accept optional configPath prop', () => {
    // Given
    const props = makeProps({ configPath: '/tmp/config' });

    // When
    const tool = new AcceleratorTool(props);

    // Then
    expect(tool).toBeDefined();
  });
});

describe('resetCredentialEnvironment', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'AWS_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY',
    'AWS_SECRET_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('should clear credential env vars and restore AWS_PROFILE', () => {
    // Given
    process.env['AWS_ACCESS_KEY_ID'] = 'ASIAIOSFODNN7EXAMPLE';
    process.env['AWS_ACCESS_KEY'] = 'ASIAIOSFODNN7EXAMPLE';
    process.env['AWS_SECRET_KEY'] = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env['AWS_SESSION_TOKEN'] = 'test-session-token';
    delete process.env['AWS_PROFILE'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new AcceleratorTool(makeProps()) as any;
    tool.savedAwsProfile = 'test-profile';

    // When
    tool.resetCredentialEnvironment();

    // Then
    expect(process.env['AWS_ACCESS_KEY_ID']).toBeUndefined();
    expect(process.env['AWS_ACCESS_KEY']).toBeUndefined();
    expect(process.env['AWS_SECRET_KEY']).toBeUndefined();
    expect(process.env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(process.env['AWS_SESSION_TOKEN']).toBeUndefined();
    expect(process.env['AWS_PROFILE']).toBe('test-profile');
  });

  it('should not set AWS_PROFILE when savedAwsProfile is undefined', () => {
    // Given
    process.env['AWS_ACCESS_KEY_ID'] = 'ASIAIOSFODNN7EXAMPLE';
    delete process.env['AWS_PROFILE'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new AcceleratorTool(makeProps()) as any;

    // When
    tool.resetCredentialEnvironment();

    // Then
    expect(process.env['AWS_ACCESS_KEY_ID']).toBeUndefined();
    expect(process.env['AWS_PROFILE']).toBeUndefined();
  });
});

describe('getOrganizationAccountList lifecycle filtering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers State and only cleans up ACTIVE and PENDING_CLOSURE accounts', async () => {
    vi.spyOn(OrganizationsClient.prototype, 'send').mockResolvedValue({
      Accounts: [
        {
          Id: '111111111111',
          Name: 'StateActive',
          Email: 'state-active@example.com',
          State: 'ACTIVE',
          Status: 'SUSPENDED',
        },
        {
          Id: '222222222222',
          Name: 'LegacyActive',
          Email: 'legacy-active@example.com',
          Status: 'ACTIVE',
        },
        {
          Id: '333333333333',
          Name: 'StateSuspended',
          Email: 'state-suspended@example.com',
          State: 'SUSPENDED',
          Status: 'ACTIVE',
        },
        {
          Id: '444444444444',
          Name: 'LegacySuspended',
          Email: 'legacy-suspended@example.com',
          Status: 'SUSPENDED',
        },
        {
          Id: '555555555555',
          Name: 'Closed',
          Email: 'closed@example.com',
          State: 'CLOSED',
          Status: 'ACTIVE',
        },
        {
          Id: '666666666666',
          Name: 'PendingActivation',
          Email: 'pending-activation@example.com',
          State: 'PENDING_ACTIVATION',
        },
        {
          Id: '777777777777',
          Name: 'PendingClosure',
          Email: 'pending-closure@example.com',
          State: 'PENDING_CLOSURE',
        },
        {
          Id: '888888888888',
          Name: 'MissingState',
          Email: 'missing-state@example.com',
        },
        {
          Id: '999999999999',
          Name: 'UnknownState',
          Email: 'unknown-state@example.com',
          State: 'UNKNOWN_STATE',
        },
      ],
      NextToken: undefined,
    } as never);
    const tool = new AcceleratorTool(makeProps());
    tool['pipelineManagementAccount'] = {
      accountId: '111111111111',
      assumeRoleName: undefined,
      credentials: undefined,
    };
    const warnSpy = vi.spyOn(tool['logger'], 'warn');

    const result = await tool['getOrganizationAccountList']();

    expect(result).toEqual([
      { accountName: 'StateActive', accountId: '111111111111' },
      { accountName: 'LegacyActive', accountId: '222222222222' },
      { accountName: 'PendingClosure', accountId: '777777777777' },
    ]);
    expect(warnSpy.mock.calls.filter(([message]) => String(message).includes('lifecycle state'))).toHaveLength(6);
    expect(warnSpy).toHaveBeenCalledWith(
      'Account StateSuspended (state-suspended@example.com) has lifecycle state SUSPENDED and will not be cleaned up',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Account LegacySuspended (legacy-suspended@example.com) has lifecycle state SUSPENDED and will not be cleaned up',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Account Closed (closed@example.com) has lifecycle state CLOSED and will not be cleaned up',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Account PendingActivation (pending-activation@example.com) has lifecycle state PENDING_ACTIVATION and will not be cleaned up',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Account MissingState (missing-state@example.com) has lifecycle state UNKNOWN and will not be cleaned up',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Account UnknownState (unknown-state@example.com) has lifecycle state UNKNOWN_STATE and will not be cleaned up',
    );
  });
});

describe('detectInstallerStackType', () => {
  it('should return CONTAINER when stack has AWS::ECS::Cluster resource', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi.fn().mockResolvedValue({
      StackResourceSummaries: [
        { ResourceType: 'AWS::ECS::Cluster', PhysicalResourceId: 'arn:aws:ecs:us-east-1:111122223333:cluster/test' },
        { ResourceType: 'AWS::S3::Bucket', PhysicalResourceId: 'amzn-s3-demo-bucket' },
      ],
      NextToken: undefined,
    });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // When
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (AcceleratorTool as any).detectInstallerStackType('AWSAccelerator-InstallerContainerStack');

    // Then
    expect(result).toBe('container');
  });

  it('should return CODEPIPELINE when stack has AWS::CodePipeline::Pipeline resource', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi.fn().mockResolvedValue({
      StackResourceSummaries: [{ ResourceType: 'AWS::CodePipeline::Pipeline', PhysicalResourceId: 'test-pipeline' }],
      NextToken: undefined,
    });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // When
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (AcceleratorTool as any).detectInstallerStackType('AWSAccelerator-InstallerStack');

    // Then
    expect(result).toBe('codepipeline');
  });

  it('should throw when stack has neither ECS nor CodePipeline resources', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi.fn().mockResolvedValue({
      StackResourceSummaries: [{ ResourceType: 'AWS::S3::Bucket', PhysicalResourceId: 'amzn-s3-demo-bucket' }],
      NextToken: undefined,
    });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // When / Then
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AcceleratorTool as any).detectInstallerStackType('SomeUnknownStack'),
    ).rejects.toThrow('Unable to determine installer stack type');
  });

  it('should throw when stack does not exist', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi.fn().mockRejectedValue(new Error('Stack not found'));

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // When / Then
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AcceleratorTool as any).detectInstallerStackType('NonExistentStack'),
    ).rejects.toThrow('Failed to detect installer stack type');
  });
});

describe('getContainerDeploymentConfig', () => {
  it('should extract config from stack parameters for external pipeline deployment', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({
        Stacks: [
          {
            Parameters: [
              { ParameterKey: 'AcceleratorQualifier', ParameterValue: 'myqualifier' },
              { ParameterKey: 'AcceleratorPrefix', ParameterValue: 'AWSAccelerator' },
              { ParameterKey: 'ManagementAccountId', ParameterValue: '444455556666' },
              { ParameterKey: 'ManagementAccountRoleName', ParameterValue: 'AWSAccelerator-ContainerDeploymentRole' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        StackResourceSummaries: [
          { ResourceType: 'AWS::ECS::Cluster', PhysicalResourceId: 'arn:aws:ecs:us-east-1:111122223333:cluster/lza' },
          {
            ResourceType: 'AWS::ECS::TaskDefinition',
            PhysicalResourceId: 'arn:aws:ecs:us-east-1:111122223333:task-definition/lza:1',
          },
        ],
        NextToken: undefined,
      });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new AcceleratorTool(makeProps()) as any;

    // When
    const config = await tool.getContainerDeploymentConfig('AWSAccelerator-InstallerContainerStack');

    // Then
    expect(config.acceleratorQualifier).toBe('myqualifier');
    expect(config.acceleratorPrefix).toBe('AWSAccelerator');
    expect(config.oneWordPrefix).toBe('accelerator');
    expect(config.managementAccountId).toBe('444455556666');
    expect(config.managementAccountRoleName).toBe('AWSAccelerator-ContainerDeploymentRole');
    expect(config.isExternalPipeline).toBe(true);
    expect(config.ecsClusterArn).toContain('cluster/lza');
    expect(config.taskDefinitionArn).toContain('task-definition/lza');
  });

  it('should set isExternalPipeline false when qualifier is empty', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({
        Stacks: [
          {
            Parameters: [
              { ParameterKey: 'AcceleratorQualifier', ParameterValue: '' },
              { ParameterKey: 'AcceleratorPrefix', ParameterValue: 'AWSAccelerator' },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        StackResourceSummaries: [],
        NextToken: undefined,
      });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new AcceleratorTool(makeProps()) as any;

    // When
    const config = await tool.getContainerDeploymentConfig('AWSAccelerator-InstallerContainerStack');

    // Then
    expect(config.isExternalPipeline).toBe(false);
    expect(config.oneWordPrefix).toBe('accelerator');
  });

  it('should derive oneWordPrefix as-is for custom prefix', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({
        Stacks: [
          {
            Parameters: [{ ParameterKey: 'AcceleratorPrefix', ParameterValue: 'MyCustomPrefix' }],
          },
        ],
      })
      .mockResolvedValueOnce({
        StackResourceSummaries: [],
        NextToken: undefined,
      });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new AcceleratorTool(makeProps()) as any;

    // When
    const config = await tool.getContainerDeploymentConfig('test-stack');

    // Then
    expect(config.oneWordPrefix).toBe('MyCustomPrefix');
  });

  it('should throw when stack is not found', async () => {
    // Given
    const { CloudFormationClient } = await import('@aws-sdk/client-cloudformation');
    const mockSend = vi.fn().mockResolvedValue({ Stacks: [] });

    vi.mocked(CloudFormationClient).mockImplementation(function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { send: mockSend } as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = new AcceleratorTool(makeProps()) as any;

    // When / Then
    await expect(tool.getContainerDeploymentConfig('NonExistentStack')).rejects.toThrow(
      'Container installer stack NonExistentStack not found',
    );
  });
});
