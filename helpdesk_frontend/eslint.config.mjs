import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "coverage/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // Apostrophes in user-facing JSX text are safe and render correctly.
      "react/no-unescaped-entities": "off",
    },
  },
];

export default eslintConfig;
