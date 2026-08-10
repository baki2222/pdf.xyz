import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * Flat ESLint config.
 *
 * `eslint-config-next@16` ships native flat-config arrays at
 * `eslint-config-next/core-web-vitals` and `/typescript`, so we spread them
 * directly. (Wrapping them through `FlatCompat` under ESLint 10 triggers a
 * "Converting circular structure to JSON" crash in the eslintrc validator.)
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      // pdfjs's own decoder assets, copied verbatim out of the package by
      // scripts/copy-pdfjs-wasm.ts. Vendor bundles we neither wrote nor edit —
      // linting them reported 83 errors that no one could act on.
      "public/pdfjs-wasm/**",
      "out/**",
      "build/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Pin the React version. eslint-plugin-react's "detect" path calls the
    // `context.getFilename()` API that ESLint 10 removed, which crashes the
    // run; a concrete version skips detection entirely.
    settings: { react: { version: "19.2" } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
