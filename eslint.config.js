import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const coreFiles = [
  'packages/bootstrap/**/*.ts',
  'packages/config/**/*.ts',
  'packages/domain/**/*.ts',
  'packages/contracts/**/*.ts',
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
