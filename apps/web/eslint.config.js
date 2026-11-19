import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.strict, {
  plugins: { "react-hooks": reactHooks },
  rules: { ...reactHooks.configs.recommended.rules, "@typescript-eslint/no-non-null-assertion": "off" },
});
