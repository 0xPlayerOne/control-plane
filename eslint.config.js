import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const coreFiles = [
  'packages/bootstrap/**/*.ts',
  'packages/config/**/*.ts',
  'packages/domain/**/*.ts',
  'packages/contracts/**/*.ts',
  'packages/control-sdk/**/*.ts',
  'packages/events/**/*.ts',
  'packages/execution-plan/**/*.ts',
  'packages/runtime-sdk/**/*.ts',
  'packages/tool-sdk/**/*.ts',
  'packages/policy/**/*.ts',
  'packages/context/**/*.ts',
]

const prohibitedAdapters = [
  '@langchain/langgraph',
  '@langchain/langgraph/*',
  '@modelcontextprotocol/*',
  '@temporalio/*',
  '@e2b/*',
  'e2b',
  'e2b/*',
  'litellm',
  'litellm/*',
  'pi-ai',
  'pi-ai/*',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-ai/*',
  'acp',
  'acp/*',
  '@agentclientprotocol/*',
  '@control-plane/adapter-*',
  '@control-plane/database',
  '@control-plane/database/*',
]

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/control-api/src/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@control-plane/database',
                '@control-plane/database/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'postgres',
              ],
              message:
                'Controllers must use purpose-built service contracts, never persistence rows.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/control-api/src/**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    files: ['packages/control-sdk/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...prohibitedAdapters,
            '@control-plane/bootstrap',
            '@control-plane/bootstrap/*',
            '@control-plane/config',
            '@control-plane/config/*',
            '@control-plane/context',
            '@control-plane/context/*',
            '@control-plane/domain',
            '@control-plane/domain/*',
            '@control-plane/execution-plan',
            '@control-plane/execution-plan/*',
            '@control-plane/policy',
            '@control-plane/policy/*',
            '@control-plane/runtime-sdk',
            '@control-plane/runtime-sdk/*',
            '@control-plane/telemetry',
            '@control-plane/telemetry/*',
          ].map((group) => ({
            group: [group],
            message: 'The public SDK may depend only on the public contract boundary.',
          })),
        },
      ],
    },
  },
  {
    files: coreFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: prohibitedAdapters.map((group) => ({
            group: [group],
            message: 'Core packages must depend on stable ports, not concrete vendor adapters.',
          })),
        },
      ],
    },
  }
)
