import type { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  clearMocks: true,
  coverageProvider: "v8",
  preset: "ts-jest",
  transform: {
    '^.+\\.tsx?$': [
      "ts-jest",
        {
          "compiler": "typescript",
          "isolatedModules": false,
          "diagnostics": true,
          "useESM": true,
        }
    ]
  },
};

export default jestConfig;
