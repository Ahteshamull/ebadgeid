import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Next.js 16 removed `next lint` (which had these excluded by default) --
  // `eslint .` needs them declared explicitly, or it lints its own build
  // output (.next/server/**) and reports hundreds of errors from
  // React's own bundled internals, not this app's code. Same fix already
  // applied in frontend/eslint.config.mjs when that app made this same move.
  { ignores: [".next/**", "node_modules/**", "coverage/**"] },
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
